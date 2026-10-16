import { canReadGroupMessage } from '../modules/world/domain/experience-rules.ts';
import { coordinateNativeResponder } from './npc-agent-native-coordination.ts';
import { readLocationReportAudience } from '../modules/world/infrastructure/location-report-audience.ts';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { nativeAgentCommandId } from '../modules/world/infrastructure/agent-native-ids.ts';
export { nativeAgentCommandId } from '../modules/world/infrastructure/agent-native-ids.ts';
import type { TextModel } from '../modules/ai/application/ports.ts';
import type { PostgresDatabase, SqlClient } from '../modules/storage/infrastructure/postgres.ts';
import type { TaskLease } from '../modules/tasks/domain/types.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
import type {
  AgentAttempt,
  AgentInputReceipt,
  ActorAgentState,
} from '../modules/world/domain/agent-runtime.ts';
import { PostgresAgentRuntimeRepository } from '../modules/world/infrastructure/agent-runtime-repository.ts';
import { PostgresWorldRepository } from '../modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../modules/world/infrastructure/clock-repository.ts';
import { readNativeAgentSnapshot } from '../modules/world/infrastructure/agent-channel-snapshot.ts';
import { withLeasedAgentDatabase } from '../modules/world/infrastructure/leased-agent-database.ts';
import { loadGroupRead } from '../modules/world/infrastructure/group-repository.ts';
import {
  loadScene,
  SceneTaskInputSchema,
} from '../modules/world/infrastructure/scene-repository.ts';
import { forgottenAgentSourceIds } from '../modules/world/infrastructure/agent-source-authorization.ts';
import {
  selectQuestionResponder,
  type ProvenPendingQuestion,
} from '../modules/world/domain/agent-questions.ts';
import { groupHistory } from '../modules/world/domain/group-runtime.ts';
import { currentGroupMember } from '../modules/world/domain/group-runtime.ts';
import { scenePresent } from '../modules/world/domain/scene-runtime.ts';
import { projectStoryTime } from '../modules/world/domain/clock.ts';
import { runNpcAgent } from '../modules/world/application/run-agent.ts';
import { NpcAgentModel } from '../modules/world/infrastructure/npc-agent-model.ts';
import { PostgresNpcAgentKernel } from '../modules/world/infrastructure/npc-agent-kernel.ts';

/** No persona keywords or array-order fallback. Ambiguity goes to global coordination. */
export function nativeResponder(input: {
  actorIds: string[];
  names: ReadonlyMap<string, string>;
  text: string;
  states: ActorAgentState[];
  channel: 'group' | 'scene';
  threadId: string;
  questions: ProvenPendingQuestion[];
  relatedMatterIds: string[];
}) {
  const unique = (ids: string[]) => [...new Set(ids)].filter((id) => input.actorIds.includes(id));
  const mentions = unique(
    input.actorIds.filter((id) => {
      const name = input.names.get(id);
      if (!name) return false;
      return (
        input.text.includes('@' + name) &&
        new RegExp(
          '@' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[\\s，,。！？!?：:]|$)',
        ).test(input.text)
      );
    }),
  );
  if (mentions.length === 1) return mentions[0]!;
  if (mentions.length > 1)
    throw new DomainError('INVALID_COMMAND', 'DIRECTOR_COORDINATION_REQUIRED');
  const question = selectQuestionResponder({
    channel: input.channel,
    threadId: input.threadId,
    questions: input.questions,
  });
  if (question.kind === 'ambiguous')
    throw new DomainError('INVALID_COMMAND', 'DIRECTOR_COORDINATION_REQUIRED');
  if (question.kind === 'selected') {
    if (!input.actorIds.includes(question.actorId)) throw new DomainError('INVALID_COMMAND');
    return question.actorId;
  }
  const responsible = unique(
    input.states
      .filter((state) =>
        state.responsibilities.some(
          (r) =>
            !['fulfilled', 'withdrawn', 'expired'].includes(r.status) &&
            r.subject.kind === 'matter' &&
            input.relatedMatterIds.includes(r.subject.id),
        ),
      )
      .map((state) => state.actorId),
  );
  if (responsible.length === 1) return responsible[0]!;
  const actors = unique(input.actorIds);
  if (actors.length === 1) return actors[0]!;
  throw new DomainError('INVALID_COMMAND', 'DIRECTOR_COORDINATION_REQUIRED');
}

/** Completes the actual queue task with its native NPC result, inside the same kernel transaction. */
export async function finishNativeAgentTask(
  sql: SqlClient,
  ownerId: string,
  lease: TaskLease,
  attempt: AgentAttempt,
  eventId: string,
) {
  if (
    attempt.worldId !== lease.scopeId ||
    attempt.commandId !== nativeAgentCommandId(lease.id, attempt.actorId)
  )
    throw new DomainError('INVALID_COMMAND');
  const saved = await sql.query(
    `UPDATE parallel_life.tasks t SET status='succeeded',result_version=e.version,updated_at=now()
 FROM parallel_life.agent_attempts a JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
 JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
 JOIN parallel_life.agent_input_receipts r ON r.world_id=a.world_id AND r.id=a.input_receipt_id
 JOIN parallel_life.world_events original ON original.world_id=r.world_id AND original.command_id=r.command_id AND original.version=(r.document->>'expectedWorldVersion')::integer
 JOIN parallel_life.commands oc ON oc.world_id=original.world_id AND oc.id=original.command_id AND oc.status='succeeded' AND oc.result_event_id=original.id
 WHERE t.id=$1 AND t.owner_id=$2 AND t.scope_kind='world' AND t.scope_id=$3 AND t.lease_token=$4 AND t.status='running' AND t.lease_until>clock_timestamp()
 AND a.id=$5 AND a.token=$6 AND a.world_id=$3 AND a.owner_id=$2 AND a.status='committed' AND e.id=$7
 AND a.command_id=$8 AND e.payload->'data'->'agentRuntime'->>'inputReceiptId'=r.id
 AND ((e.payload->>'type'='group.turn_resolved' AND t.input->>'channel'='group' AND e.payload->'data'->>'groupId'=t.input->>'groupId' AND original.id=t.input->>'inputEventId')
 OR(e.payload->>'type'='scene.reaction_recorded' AND t.input->>'type'='scene' AND e.payload->'data'->>'sceneId'=t.input->>'sceneId' AND EXISTS(SELECT 1 FROM parallel_life.scene_items i WHERE i.world_id=$3 AND i.owner_id=$2 AND i.id=t.input->>'actionId' AND i.source_event_id=original.id)))`,
    [
      lease.id,
      ownerId,
      lease.scopeId,
      lease.token,
      attempt.id,
      attempt.token,
      eventId,
      attempt.commandId,
    ],
  );
  if (saved.rowCount !== 1) throw new DomainError('INVALID_COMMAND', 'NATIVE_TASK_RESULT_MISMATCH');
}

/** Existing world-task lease, same NPC state/model/kernel; returns false only for an epoch-1 world. */
export function nativeNpcTaskHandler(db: PostgresDatabase, modelFactory: () => TextModel) {
  return async (lease: TaskLease, signal: AbortSignal): Promise<boolean> => {
    const control = await db.transaction(
      lease.ownerId,
      async (sql) =>
        (
          await sql.query(
            `SELECT COALESCE(c.engine_epoch,1) AS epoch FROM parallel_life.tasks t JOIN parallel_life.worlds w ON w.id=t.scope_id AND w.owner_id=t.owner_id
   LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
   WHERE t.id=$1 AND t.owner_id=$2 AND t.scope_kind='world' AND t.scope_id=$3 AND t.lease_token=$4 AND t.status='running' AND t.lease_until>clock_timestamp()`,
            [lease.id, lease.ownerId, lease.scopeId, lease.token],
          )
        ).rows[0],
    );
    if (!control) throw new DomainError('NOT_FOUND');
    if (Number(control.epoch) < 2) return false;
    const scoped = withLeasedAgentDatabase(db, lease),
      store = new PostgresAgentRuntimeRepository(scoped),
      worlds = new PostgresWorldRepository(scoped);
    const world = await worlds.get({ userId: lease.ownerId }, lease.scopeId);
    const now = new Date().toISOString(),
      clock = await new PostgresClockStore(scoped).read(lease.ownerId, world.id, now);
    if (clock.paused) throw new DomainError('INVALID_COMMAND', 'WORLD_PAUSED');
    const storyAt = new Date(
      Math.max(Date.parse(world.time), Date.parse(projectStoryTime(clock, now))),
    ).toISOString();
    const native = await scoped.transaction(lease.ownerId, async (sql) => {
      const input = lease.input as Record<string, unknown>;
      const nativeSources = new Map<
        string,
        { actorId: string; eventId: string; version: number }
      >();
      let channel: 'group' | 'scene',
        threadId: string,
        version: number,
        sourceId: string,
        relatedMatterIds: string[] = [],
        actorIds: string[] = [];
      if (
        input.channel === 'group' &&
        typeof input.groupId === 'string' &&
        Number.isSafeInteger(input.expectedVersion) &&
        typeof input.inputEventId === 'string'
      ) {
        channel = 'group';
        threadId = input.groupId;
        version = Number(input.expectedVersion);
        sourceId = input.inputEventId;
        const read = await loadGroupRead(sql, world.id, threadId, now);
        const original = read.messages.find(
          (m) =>
            m.sourceEventId === sourceId &&
            m.sourceVersion === version &&
            m.sender.kind === 'player',
        );
        if (!original) throw new DomainError('INVALID_COMMAND', 'NATIVE_INPUT_NOT_ACCEPTED');
        actorIds = world.actors
          .filter(
            (a) =>
              currentGroupMember(read.group, { kind: 'actor', actorId: a.id }) &&
              canReadGroupMessage(read.context, read.group, original, {
                kind: 'actor',
                actorId: a.id,
              }),
          )
          .map((a) => a.id);
        for (const m of groupHistory({ ...read.context, world }, read.group, read.messages, {
          kind: 'player',
        }))
          if (m.sourceVersion < version && m.sender.kind === 'actor')
            nativeSources.set('group:' + m.id, {
              actorId: m.sender.actorId,
              eventId: m.sourceEventId,
              version: m.sourceVersion,
            });
      } else {
        const parsed = SceneTaskInputSchema.parse(input);
        channel = 'scene';
        threadId = parsed.sceneId;
        version = parsed.expectedVersion;
        if (!parsed.actionId)
          throw new DomainError('INVALID_COMMAND', 'SCENE_ENVIRONMENT_MUST_BE_ESTABLISHED');
        const scene = await loadScene(sql, world.id, threadId);
        const action = scene.actions.find((a) => a.id === parsed.actionId);
        if (!action || action.sourceVersion !== version) throw new DomainError('INVALID_COMMAND');
        sourceId = action.sourceEventId;
        relatedMatterIds = action.relatedMatterIds;
        const original = scene.entries.find(
          (e) =>
            e.kind === 'user_action' &&
            e.actionId === action.id &&
            e.sourceEventId === sourceId &&
            e.sourceVersion === version,
        );
        if (!original) throw new DomainError('INVALID_COMMAND', 'NATIVE_INPUT_NOT_ACCEPTED');
        const present = scenePresent(scene.scene, version);
        actorIds = scenePresent(scene.scene, world.version).flatMap((p) =>
          p.kind === 'actor' &&
          present.some((v) => v.kind === 'actor' && v.actorId === p.actorId) &&
          original.observableTo.some((v) => v.kind === 'actor' && v.actorId === p.actorId)
            ? [p.actorId]
            : [],
        );
        for (const e of scene.entries)
          if (
            e.kind === 'dialogue' &&
            e.sourceVersion < version &&
            e.speaker.kind === 'actor' &&
            e.observableTo.some((p) => p.kind === 'player')
          )
            nativeSources.set('scene:' + e.id, {
              actorId: e.speaker.actorId,
              eventId: e.sourceEventId,
              version: e.sourceVersion,
            });
      }
      const source = (
        await sql.query(
          'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 AND id=$3 AND version=$4',
          [world.id, lease.ownerId, sourceId, version],
        )
      ).rows[0]?.payload;
      const receipt = (
        await sql.query(
          'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
          [world.id, lease.ownerId, source?.commandId ?? ''],
        )
      ).rows[0]?.document as AgentInputReceipt | undefined;
      if (
        !receipt ||
        receipt.channel !== channel ||
        receipt.threadId !== threadId ||
        receipt.expectedWorldVersion !== version
      )
        throw new DomainError('INVALID_COMMAND', 'NATIVE_INPUT_NOT_ACCEPTED');
      const states = (
        await sql.query(
          'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=ANY($3::text[])',
          [world.id, lease.ownerId, actorIds],
        )
      ).rows.map((r) => r.document as ActorAgentState);
      const questions: ProvenPendingQuestion[] = [];
      const events = (
        await sql.query(
          `SELECT e.id,e.version,a.actor_id,e.payload->'data'->'agentRuntime'->'stateAfter'->'questions' AS questions
         FROM parallel_life.world_events e
         JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
         JOIN parallel_life.agent_attempts a ON a.world_id=e.world_id AND a.owner_id=e.owner_id AND a.event_id=e.id AND a.status='committed'
         WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=ANY($3::text[]) AND e.version<$4`,
          [world.id, lease.ownerId, [...nativeSources.values()].map((v) => v.eventId), version],
        )
      ).rows;
      for (const state of states) {
        const forgotten = await forgottenAgentSourceIds(
          sql,
          lease.ownerId,
          world.id,
          state.actorId,
        );
        for (const q of state.questions ?? []) {
          if (
            q.status !== 'open' ||
            q.channel !== channel ||
            q.threadId !== threadId ||
            forgotten.has(q.sourceId)
          )
            continue;
          const actual = nativeSources.get(q.sourceId);
          const event =
            actual &&
            events.find(
              (e) =>
                e.id === actual.eventId &&
                Number(e.version) === actual.version &&
                e.actor_id === state.actorId,
            );
          if (actual?.actorId !== state.actorId || !event || !Array.isArray(event.questions))
            continue;
          const original = event.questions.find(
            (saved: import('../modules/world/domain/agent-questions.ts').AgentQuestion) =>
              saved.id === q.id,
          );
          if (!original || !isDeepStrictEqual(original, q)) continue;
          questions.push({
            actorId: state.actorId,
            question: q,
            sourceWorldVersion: actual.version,
          });
        }
      }
      const prior = (
        await sql.query(
          'SELECT actor_id,command_id FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND input_receipt_id=$3 AND command_id=ANY($4::text[])',
          [
            world.id,
            lease.ownerId,
            receipt.id,
            world.actors.map((actor) => nativeAgentCommandId(lease.id, actor.id)),
          ],
        )
      ).rows;
      if (prior.length > 1) throw new DomainError('INVALID_COMMAND');
      if (!actorIds.length) {
        if (prior.length) throw new DomainError('INVALID_COMMAND');
        return { receipt, actorId: null, actorIds, states };
      }
      const originalAudience = await readLocationReportAudience(
        sql,
        lease.ownerId,
        world,
        receipt,
        actorIds[0]!,
      );
      actorIds = actorIds.filter((id) => originalAudience?.actorIds.includes(id));
      let actorId: string | null = prior[0]?.actor_id ?? null;
      if (!actorId)
        try {
          actorId = nativeResponder({
            actorIds,
            names: new Map(world.actors.map((a) => [a.id, a.name])),
            text: receipt.text,
            states,
            channel,
            threadId,
            questions,
            relatedMatterIds,
          });
        } catch (error) {
          if (!(error instanceof DomainError) || error.message !== 'DIRECTOR_COORDINATION_REQUIRED')
            throw error;
        }
      if (actorId !== null && !actorIds.includes(actorId)) throw new DomainError('INVALID_COMMAND');
      return { receipt, actorId, actorIds, states };
    });
    if (!native.actorIds.length) return true;
    const selectedActorId =
      native.actorId ??
      (await coordinateNativeResponder(
        scoped,
        modelFactory,
        lease,
        { ...native, worldVersion: world.version, epoch: Number(control.epoch) },
        signal,
      ));
    if (selectedActorId === null) return true;
    native.actorId = selectedActorId;
    const commandId = nativeAgentCommandId(lease.id, native.actorId),
      previous = await store.lookup(lease.ownerId, world.id, commandId);
    const state = await store.read(lease.ownerId, { worldId: world.id, actorId: native.actorId });
    if (!state) throw new DomainError('INVALID_COMMAND', 'AGENT_NOT_MIGRATED');
    const snapshot =
      previous?.status === 'response_received' || previous?.status === 'committed'
        ? null
        : await readNativeAgentSnapshot(
            scoped,
            lease.ownerId,
            world,
            native.actorId,
            native.receipt,
            storyAt,
            state,
          );
    try {
      await runNpcAgent(
        {
          attempts: store,
          // A protected completion needs no gateway credentials or model construction.
          model: {
            validateInput: (s) => new NpcAgentModel(modelFactory()).validateInput(s),
            decide: (s, abort) => new NpcAgentModel(modelFactory()).decide(s, abort),
          },
          kernel: new PostgresNpcAgentKernel(scoped, worlds, (sql, result) =>
            finishNativeAgentTask(sql, lease.ownerId, lease, result.attempt, result.eventId),
          ),
        },
        lease.ownerId,
        previous ?? {
          id: randomUUID(),
          worldId: world.id,
          actorId: native.actorId,
          commandId,
          inputReceiptId: native.receipt.id,
          inputHash: native.receipt.inputHash,
          engineEpoch: Number(control.epoch),
          expectedWorldVersion: world.version,
          expectedActorRevision: state.revision,
          token: randomUUID(),
          leaseUntil: new Date(Date.now() + 240000).toISOString(),
        },
        snapshot,
        signal,
      );
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'NPC_DELIVERY_DEFERRED')
        throw Object.assign(Error('WORLD_PAUSED'), { code: 'INVALID_STATE' });
      const status = await store
        .lookup(lease.ownerId, world.id, commandId)
        .then((a) => a?.status)
        .catch(() => null);
      const code =
        status === 'unknown_after_send' || status === 'request_sent'
          ? 'UPSTREAM_FAILED'
          : status === 'invalid_output'
            ? 'INVALID_AI_OUTPUT'
            : status === 'stale_discarded'
              ? 'VERSION_CONFLICT'
              : undefined;
      if (code && error instanceof Error) Object.assign(error, { code });
      throw error;
    }
    return true;
  };
}
