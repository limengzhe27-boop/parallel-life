import { actorDefinitionRef } from './actor-definition-ref.ts';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuthoredLifeModulesSchema } from '../../../contracts/authored-social.ts';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { WorldState } from '../domain/types.ts';
import type { ActorAgentState } from '../domain/agent-runtime.ts';
import {
  applyActorDefinitionRevision,
  type ActorDefinitionRevisedEvent,
} from '../domain/actor-definition-revision.ts';
import { compactWorldState } from './postgres-world-repository.ts';
import { projectAgentWorldChange } from './world-awareness-commit.ts';
import { DomainError } from '../domain/errors.ts';
const Input = z.strictObject({
  worldId: z.string().min(1),
  actorId: z.string().min(1),
  commandId: z.uuid(),
  expectedWorldVersion: z.number().int().min(0),
  expectedDefinitionRef: z.string().regex(/^[a-f0-9]{64}$/),
  modules: AuthoredLifeModulesSchema.refine((v) => Object.keys(v).length > 0),
  reason: z.string().trim().min(1).max(2000),
});
export type ReviseActorDefinitionInput = z.infer<typeof Input>;
/** Owner-authorized correction, never an NPC action or a mutation of the published edition. */
export class PostgresActorDefinitionRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async revise(
    owner: string,
    raw: ReviseActorDefinitionInput,
  ): Promise<ActorDefinitionRevisedEvent> {
    const input = Input.parse(raw),
      requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.db.transaction(owner, async (sql) => {
      const auth = (
        await sql.query(
          "SELECT current_setting('app.user_id',true) owner,pg_has_role(current_user,'pl_app','MEMBER') app,pg_has_role(current_user,'pl_worker','MEMBER') worker",
        )
      ).rows[0];
      if (auth.owner !== owner || !auth.app || auth.worker) throw new DomainError('NOT_FOUND');
      const row = (
        await sql.query(
          'SELECT state,version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
          [input.worldId, owner],
        )
      ).rows[0];
      if (!row) throw new DomainError('NOT_FOUND');
      const prior = (
        await sql.query(
          'SELECT request_hash,status,result_event_id FROM parallel_life.commands WHERE world_id=$1 AND owner_id=$2 AND id=$3',
          [input.worldId, owner, input.commandId],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash || prior.status !== 'succeeded')
          throw new DomainError('IDEMPOTENCY_CONFLICT');
        return (
          await sql.query(
            'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3',
            [input.worldId, owner, prior.result_event_id],
          )
        ).rows[0].payload;
      }
      const world = { ...row.state, version: Number(row.version) } as WorldState;
      if (world.version !== input.expectedWorldVersion) throw new DomainError('VERSION_CONFLICT');
      const actor = world.actors.find((a) => a.id === input.actorId);
      if (!actor || actorDefinitionRef(world, actor.id) !== input.expectedDefinitionRef)
        throw new DomainError('VERSION_CONFLICT');
      const epoch = Number(
        (
          await sql.query(
            'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
            [world.id, owner],
          )
        ).rows[0]?.engine_epoch ?? 1,
      );
      if (epoch < 2) throw new DomainError('INVALID_COMMAND');
      const old = (
        await sql.query(
          'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 FOR UPDATE',
          [world.id, owner, actor.id],
        )
      ).rows[0]?.document as ActorAgentState | undefined;
      if (!old || old.definitionRef !== input.expectedDefinitionRef)
        throw new DomainError('VERSION_CONFLICT');
      let base: Record<string, unknown>;
      try {
        const p = JSON.parse(actor.persona);
        base = p && typeof p === 'object' && !Array.isArray(p) ? p : { persona: actor.persona };
      } catch {
        base = { persona: actor.persona };
      }
      const persona = JSON.stringify({ ...base, modules: input.modules });
      const ref = actorDefinitionRef({ id: world.id, actors: [{ ...actor, persona }] }, actor.id);
      if (ref === old.definitionRef) throw new DomainError('INVALID_COMMAND', '人物资料没有变化。');
      const event: ActorDefinitionRevisedEvent = {
        schemaVersion: 1,
        id: randomUUID(),
        worldId: world.id,
        commandId: input.commandId,
        version: world.version + 1,
        occurredAt: new Date().toISOString(),
        storyAt: world.time,
        type: 'actor.definition_revised',
        data: {
          actorId: actor.id,
          previousDefinitionRef: old.definitionRef,
          definitionRef: ref,
          persona,
          reason: input.reason,
          actorRevisionBefore: old.revision,
          actorRevisionAfter: old.revision + 1,
        },
      };
      const next = compactWorldState(applyActorDefinitionRevision(world, event));
      await sql.query(
        "SELECT set_config('app.agent_world_id',$1,true),set_config('app.agent_engine_epoch',$2,true)",
        [world.id, String(epoch)],
      );
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'running')",
        [input.commandId, world.id, owner, world.version, requestHash, input],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [event.id, world.id, owner, event.version, input.commandId, event, event.occurredAt],
      );
      await sql.query(
        'UPDATE parallel_life.worlds SET version=$3,state=$4,updated_at=now() WHERE id=$1 AND owner_id=$2',
        [world.id, owner, event.version, next],
      );
      const state = {
        ...old,
        definitionRef: ref,
        revision: old.revision + 1,
        projectedWorldVersion: event.version,
      };
      await sql.query(
        'UPDATE parallel_life.actor_agent_states SET revision=$4,projected_world_version=$5,document=$6,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND revision=$7',
        [world.id, owner, actor.id, state.revision, event.version, state, old.revision],
      );
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND id=$5",
        [world.id, owner, event.id, next, input.commandId],
      );
      await projectAgentWorldChange(sql, owner, world.id, event.id);
      return event;
    });
  }
}
