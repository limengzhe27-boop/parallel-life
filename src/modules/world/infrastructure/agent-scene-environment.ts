import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { TaskLease } from '../../tasks/domain/types.ts';
import { requestHash } from '../../tasks/infrastructure/task-repository.ts';
import { DomainError } from '../domain/errors.ts';
import type { WorldState } from '../domain/types.ts';
import {
  assertSceneEntry,
  type ExperienceContext,
  type SceneSession,
  type SceneEntry,
} from '../domain/experience-rules.ts';
import { applyWorldHistoryEvent } from '../domain/world-history.ts';
import { SceneReceiptSchema, SceneRuntimeSessionSchema } from '../../../contracts/scenes.ts';
import { ParticipantSchema } from '../../../contracts/world-experiences.ts';
import { SceneTaskInputSchema, loadScene, sceneWorld } from './scene-repository.ts';
import { withLeasedAgentDatabase } from './leased-agent-database.ts';
import { compactWorldState } from './postgres-world-repository.ts';
import { projectAgentWorldChange } from './world-awareness-commit.ts';

const Id = z.string().uuid();
const Place = z.string().regex(/^[a-z0-9_]{1,64}$/);
const Version = z.number().int().nonnegative();
const Time = z.iso.datetime({ offset: true });
const Position = z.strictObject({
  worldId: Id,
  subject: ParticipantSchema,
  status: z.literal('at'),
  placeId: Place,
  sourceEventId: Id,
  worldVersion: Version.positive(),
  occurredAt: Time,
});
const Environment = z.strictObject({
  schemaVersion: z.literal(1),
  producer: z.literal('deterministic'),
  taskId: Id,
  engineEpoch: z.number().int().min(2),
  enteredEventId: Id,
  placeId: Place,
  presenceProofs: z.array(Position).min(1).max(101),
  entries: z.array(z.unknown()).length(1),
});
const Opened = z.strictObject({
  schemaVersion: z.literal(1),
  id: Id,
  worldId: Id,
  commandId: Id,
  version: Version.positive(),
  occurredAt: Time,
  storyAt: Time,
  type: z.literal('scene.opened'),
  data: z.strictObject({ sceneId: Id, environment: Environment }),
});
export type NativeSceneEnvironmentEvent = z.infer<typeof Opened>;

function reject(reason: string): never {
  throw new DomainError('INVALID_COMMAND', reason);
}
function stableId(...parts: string[]) {
  const hex = createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function sceneEnvironmentCommandId(taskId: string, worldId: string, sceneId: string) {
  return stableId('scene-environment-command-v1', taskId, worldId, sceneId);
}

/** Pure projection rebuild. The caller supplies committed history, never re-executes tasks. */
export function replaySceneEnvironment(
  world: WorldState,
  before: SceneSession,
  raw: unknown,
  sources: ExperienceContext['events'],
): { scene: SceneSession; entries: SceneEntry[] } {
  const event = Opened.parse(raw),
    environment = event.data.environment;
  const place = world.space?.places.find((p) => p.id === environment.placeId);
  if (
    event.worldId !== world.id ||
    event.version !== world.version + 1 ||
    event.storyAt !== world.time ||
    event.data.sceneId !== before.id ||
    before.worldId !== world.id ||
    before.ownerId !== world.ownerId ||
    before.sourceEventId !== environment.enteredEventId ||
    before.sourceVersion !== world.version ||
    before.status !== 'active' ||
    before.placeId !== environment.placeId ||
    world.space?.currentPlaceId !== environment.placeId ||
    !place ||
    before.presence.length !== 1 ||
    before.presence[0]!.participant.kind !== 'player' ||
    before.presence[0]!.leftVersion !== undefined ||
    before.presence[0]!.sourceEventId !== before.sourceEventId ||
    before.presence[0]!.joinedVersion !== before.sourceVersion ||
    event.commandId !== sceneEnvironmentCommandId(environment.taskId, world.id, before.id)
  )
    reject('SCENE_ENVIRONMENT_SOURCE_MISMATCH');
  const keys = new Set<string>();
  let hasPlayer = false;
  const scene = structuredClone(before);
  for (const proof of environment.presenceProofs) {
    const key = proof.subject.kind === 'player' ? 'player' : `actor:${proof.subject.actorId}`;
    const source = sources.find((s) => s.id === proof.sourceEventId);
    if (
      keys.has(key) ||
      proof.worldId !== world.id ||
      proof.placeId !== place.id ||
      !source ||
      source.worldId !== world.id ||
      source.ownerId !== world.ownerId ||
      source.version !== proof.worldVersion ||
      proof.worldVersion > world.version ||
      Date.parse(proof.occurredAt) > Date.parse(event.storyAt)
    )
      reject('SCENE_ENVIRONMENT_POSITION_PROOF');
    keys.add(key);
    if (proof.subject.kind === 'player') {
      hasPlayer = true;
      if (
        proof.sourceEventId !== environment.enteredEventId ||
        proof.worldVersion !== before.sourceVersion
      )
        reject('SCENE_ENVIRONMENT_PLAYER_POSITION');
    } else {
      const actorId = proof.subject.actorId;
      if (proof.worldVersion >= before.sourceVersion || !world.actors.some((a) => a.id === actorId))
        reject('SCENE_ENVIRONMENT_INDEPENDENT_POSITION_REQUIRED');
      scene.presence.push({
        participant: proof.subject,
        sourceEventId: event.id,
        sourceVersion: event.version,
        joinedVersion: event.version,
      });
    }
  }
  if (!hasPlayer) reject('SCENE_ENVIRONMENT_PLAYER_POSITION');
  const entry: SceneEntry = {
    id: stableId('scene-environment-time-place-v1', event.id),
    ownerId: world.ownerId,
    worldId: world.id,
    sceneId: before.id,
    sourceEventId: event.id,
    sourceVersion: event.version,
    observableTo: scene.presence.map((p) => p.participant),
    kind: 'time_place',
    storyAt: event.storyAt,
    location: place.name,
  };
  if (!isDeepStrictEqual(environment.entries, [entry])) reject('SCENE_ENVIRONMENT_ENTRY_MISMATCH');
  assertSceneEntry({ world: { ...world, version: event.version }, events: sources }, scene, entry);
  return { scene, entries: [entry] };
}

async function appIdentity(sql: SqlClient, owner: string) {
  const row = (
    await sql.query(`SELECT current_setting('app.user_id',true) AS owner_id,
      pg_has_role(current_user,'pl_app','MEMBER') AS app,
      pg_has_role(current_user,'pl_worker','MEMBER') AS worker,
      current_setting('app.agent_commit_attempt_id',true) AS npc_attempt`)
  ).rows[0];
  if (!row?.app || row.worker || row.owner_id !== owner) throw new DomainError('NOT_FOUND');
  if (row.npc_attempt) reject('SCENE_ENVIRONMENT_CANNOT_MIX_NPC_COMMIT');
}

/** Root-approved system boundary: only a proven live opening task, never NPC/player impersonation. */
async function authorizeEnvironmentWrite(sql: SqlClient, lease: TaskLease, epoch: number) {
  await appIdentity(sql, lease.ownerId);
  const row = (
    await sql.query(
      `SELECT t.id FROM parallel_life.tasks t JOIN parallel_life.worlds w ON w.id=t.scope_id AND w.owner_id=t.owner_id
       JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
       WHERE t.id=$1 AND t.owner_id=$2 AND t.scope_id=$3 AND t.scope_kind='world'
       AND t.status='running' AND t.lease_token=$4 AND t.lease_until>clock_timestamp()
       AND t.input=$5::jsonb AND c.engine_epoch=$6 AND t.input->>'type'='scene'
       AND t.input->'actionId'='null'::jsonb AND w.version=(t.input->>'expectedVersion')::integer`,
      [lease.id, lease.ownerId, lease.scopeId, lease.token, JSON.stringify(lease.input), epoch],
    )
  ).rows[0];
  if (!row) reject('SCENE_ENVIRONMENT_AUTHORIZATION_LOST');
  await sql.query(
    "SELECT set_config('app.agent_world_id',$1,true),set_config('app.agent_engine_epoch',$2,true)",
    [lease.scopeId, String(epoch)],
  );
}

/** Deterministic epoch-2 scene opening. Caller composes this before the NPC channel handler. */
export function sceneEnvironmentTaskHandler(db: PostgresDatabase) {
  return async (lease: TaskLease, signal: AbortSignal): Promise<boolean> => {
    if (lease.kind !== 'world') return false;
    const raw = lease.input as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || raw.type !== 'scene') return false;
    const input = SceneTaskInputSchema.parse(raw);
    if (input.actionId !== null) return false;
    if (signal.aborted) throw signal.reason ?? Error('CANCELLED');
    // Captures genuine JSON/lease identity before any SQL; it never grants an NPC marker.
    const scoped = withLeasedAgentDatabase(db, lease);
    const control = await db.transaction(lease.ownerId, async (sql) => {
      await appIdentity(sql, lease.ownerId);
      return (
        await sql.query(
          `SELECT COALESCE(c.engine_epoch,1) AS epoch FROM parallel_life.tasks t
           JOIN parallel_life.worlds w ON w.id=t.scope_id AND w.owner_id=t.owner_id
           LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
           WHERE t.id=$1 AND t.owner_id=$2 AND t.scope_id=$3 AND t.scope_kind='world'
           AND t.lease_token=$4 AND t.status='running' AND t.lease_until>clock_timestamp() AND t.input=$5::jsonb`,
          [lease.id, lease.ownerId, lease.scopeId, lease.token, JSON.stringify(input)],
        )
      ).rows[0];
    });
    if (!control) throw new DomainError('NOT_FOUND');
    const epoch = Number(control.epoch);
    if (epoch < 2) return false;
    return scoped.transaction(lease.ownerId, async (sql) => {
      const { world, paused } = await sceneWorld(sql, lease.ownerId, lease.scopeId, true);
      if (world.version !== input.expectedVersion) throw new DomainError('VERSION_CONFLICT');
      if (paused) reject('WORLD_PAUSED');
      const current = await loadScene(sql, world.id, input.sceneId);
      const experience = (
        await sql.query(
          'SELECT current_scene_id FROM parallel_life.player_experiences WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
          [world.id, lease.ownerId],
        )
      ).rows[0];
      if (experience?.current_scene_id !== input.sceneId) reject('SCENE_ENVIRONMENT_NOT_CURRENT');
      if (current.entries.length || current.actions.length || current.matters.length)
        reject('SCENE_ENVIRONMENT_ALREADY_STARTED');
      const original = (
        await sql.query(
          `SELECT e.payload,e.id,e.version,e.command_id,r.document FROM parallel_life.tasks t
           JOIN parallel_life.commands c ON c.world_id=t.scope_id AND c.owner_id=t.owner_id AND c.id=t.command_id::text AND c.status='succeeded' AND c.request_hash=t.request_hash
           JOIN parallel_life.world_events e ON e.world_id=c.world_id AND e.owner_id=c.owner_id AND e.id=c.result_event_id AND e.command_id=c.id
           JOIN parallel_life.scene_receipts r ON r.world_id=c.world_id AND r.owner_id=c.owner_id AND r.command_id=c.id
           WHERE t.id=$1 AND t.owner_id=$2 AND t.scope_id=$3`,
          [lease.id, lease.ownerId, world.id],
        )
      ).rows[0];
      if (
        !original ||
        original.payload.schemaVersion !== 1 ||
        original.payload.id !== original.id ||
        original.payload.type !== 'scene.entered' ||
        original.payload.worldId !== world.id ||
        original.payload.data?.sceneId !== input.sceneId ||
        original.payload.version !== original.version ||
        original.version !== input.expectedVersion ||
        original.id !== current.scene.sourceEventId ||
        original.payload.commandId !== original.command_id ||
        original.payload.storyAt !== world.time ||
        (original.payload.data.placeId !== undefined &&
          original.payload.data.placeId !== current.scene.placeId) ||
        (original.payload.data.appointmentId !== undefined &&
          original.payload.data.appointmentId !== current.scene.appointmentId)
      )
        reject('SCENE_ENVIRONMENT_ENTRY_NOT_COMMITTED');
      const receipt = SceneReceiptSchema.parse(original.document);
      if (
        receipt.commandId !== original.command_id ||
        receipt.worldId !== world.id ||
        receipt.sceneId !== input.sceneId ||
        receipt.version !== original.version ||
        receipt.task?.id !== lease.id ||
        receipt.task.scope.kind !== 'world' ||
        receipt.task.scope.worldId !== world.id
      )
        reject('SCENE_ENVIRONMENT_ENTRY_RECEIPT');
      const rows = (
        await sql.query(
          `SELECT p.document FROM parallel_life.world_authoritative_positions p JOIN parallel_life.world_events e
           ON e.world_id=p.world_id AND e.owner_id=p.owner_id AND e.id=p.source_event_id AND e.version=p.source_version
           JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
           AND c.status='succeeded' AND c.result_event_id=e.id
           WHERE p.world_id=$1 AND p.owner_id=$2 AND p.source_version<=$3
           AND p.document->>'status'='at' AND p.document->>'placeId'=$4 ORDER BY p.subject_key FOR UPDATE OF p`,
          [world.id, lease.ownerId, world.version, current.scene.placeId ?? null],
        )
      ).rows;
      const proofs = rows
        .map((r) => Position.parse(r.document))
        .filter(
          (p) =>
            p.subject.kind === 'player' ||
            world.actors.some((a) => p.subject.kind === 'actor' && a.id === p.subject.actorId),
        );
      // Stable ordering makes event bytes and replay deterministic across DB query plans.
      proofs.sort((a, b) =>
        a.subject.kind === 'player'
          ? -1
          : b.subject.kind === 'player'
            ? 1
            : a.subject.actorId.localeCompare(b.subject.actorId),
      );
      // Only the entry and actual position proofs are needed, not an ever-growing world history.
      const sources = (
        await sql.query(
          `SELECT e.id,e.version,e.world_id AS "worldId",e.owner_id AS "ownerId" FROM parallel_life.world_events e
           JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
           AND c.status='succeeded' AND c.result_event_id=e.id WHERE e.world_id=$1 AND e.owner_id=$2
           AND e.version<=$3 AND e.id=ANY($4::text[]) ORDER BY e.version`,
          [
            world.id,
            lease.ownerId,
            world.version,
            [...new Set([original.id, ...proofs.map((p) => p.sourceEventId)])],
          ],
        )
      ).rows as ExperienceContext['events'];
      const eventId = stableId('scene-environment-event-v1', lease.id, world.id, input.sceneId);
      const commandId = sceneEnvironmentCommandId(lease.id, world.id, input.sceneId);
      const participants = proofs.map((p) => p.subject);
      const place = world.space?.places.find((p) => p.id === current.scene.placeId);
      if (!place) reject('SCENE_ENVIRONMENT_PLACE_NOT_KNOWN');
      const entry: SceneEntry = {
        id: stableId('scene-environment-time-place-v1', eventId),
        ownerId: lease.ownerId,
        worldId: world.id,
        sceneId: input.sceneId,
        sourceEventId: eventId,
        sourceVersion: world.version + 1,
        observableTo: participants,
        kind: 'time_place',
        storyAt: world.time,
        location: place.name,
      };
      const event: NativeSceneEnvironmentEvent = {
        schemaVersion: 1,
        id: eventId,
        worldId: world.id,
        commandId,
        version: world.version + 1,
        occurredAt: new Date().toISOString(),
        storyAt: world.time,
        type: 'scene.opened',
        data: {
          sceneId: input.sceneId,
          environment: {
            schemaVersion: 1,
            producer: 'deterministic',
            taskId: lease.id,
            engineEpoch: epoch,
            enteredEventId: original.id,
            placeId: place.id,
            presenceProofs: proofs,
            entries: [entry],
          },
        },
      };
      const eventSources = [
        ...sources,
        { id: event.id, version: event.version, worldId: world.id, ownerId: lease.ownerId },
      ];
      const projection = replaySceneEnvironment(world, current.scene, event, eventSources);
      const { state, jobs } = applyWorldHistoryEvent(world, event);
      const compact = compactWorldState(state);
      if (signal.aborted) throw signal.reason ?? Error('CANCELLED');
      await authorizeEnvironmentWrite(sql, lease, epoch);
      await sql.query(
        "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
        [
          commandId,
          world.id,
          lease.ownerId,
          world.version,
          requestHash([lease.id, input, original.id]),
          { type: 'scene.environment', event },
        ],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [event.id, world.id, lease.ownerId, event.version, commandId, event, event.occurredAt],
      );
      await sql.query(
        'UPDATE parallel_life.scene_sessions SET document=$2 WHERE world_id=$1 AND owner_id=$3 AND id=$4',
        [world.id, SceneRuntimeSessionSchema.parse(projection.scene), lease.ownerId, input.sceneId],
      );
      for (const item of projection.entries)
        await sql.query(
          "INSERT INTO parallel_life.scene_items(id,world_id,owner_id,scene_id,source_event_id,kind,document) VALUES($1,$2,$3,$4,$5,'entry',$6)",
          [item.id, world.id, lease.ownerId, input.sceneId, event.id, item],
        );
      for (const job of jobs)
        await sql.query(
          'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
          [job.id, world.id, lease.ownerId, event.id, job],
        );
      const saved = await sql.query(
        'UPDATE parallel_life.worlds SET version=$2,state=$3,updated_at=now() WHERE id=$1 AND owner_id=$4 AND version=$5',
        [world.id, event.version, compact, lease.ownerId, world.version],
      );
      if (saved.rowCount !== 1) throw new DomainError('VERSION_CONFLICT');
      await sql.query(
        "UPDATE parallel_life.commands SET status='succeeded',result_event_id=$3,result_state=$4,updated_at=now() WHERE world_id=$1 AND id=$2 AND owner_id=$5",
        [world.id, commandId, event.id, compact, lease.ownerId],
      );
      const result = SceneReceiptSchema.parse({
        commandId,
        worldId: world.id,
        version: event.version,
        sceneId: input.sceneId,
        task: null,
      });
      await sql.query(
        'INSERT INTO parallel_life.scene_receipts(world_id,owner_id,command_id,document) VALUES($1,$2,$3,$4)',
        [world.id, lease.ownerId, commandId, result],
      );
      await projectAgentWorldChange(sql, lease.ownerId, world.id, event.id);
      if (signal.aborted) throw signal.reason ?? Error('CANCELLED');
      const finished = await sql.query(
        `UPDATE parallel_life.tasks t SET status='succeeded',result_version=$6,updated_at=now()
         FROM parallel_life.commands c JOIN parallel_life.world_events e ON e.world_id=c.world_id AND e.owner_id=c.owner_id AND e.id=c.result_event_id AND e.command_id=c.id
         JOIN parallel_life.scene_receipts r ON r.world_id=c.world_id AND r.owner_id=c.owner_id AND r.command_id=c.id
         WHERE t.id=$1 AND t.owner_id=$2 AND t.scope_kind='world' AND t.scope_id=$3 AND t.lease_token=$4
         AND t.status='running' AND t.lease_until>clock_timestamp() AND t.input=$5::jsonb
         AND c.world_id=t.scope_id AND c.owner_id=t.owner_id AND c.id=$7 AND c.status='succeeded' AND e.id=$8 AND e.version=$6
         AND e.payload->>'type'='scene.opened' AND e.payload->'data'->>'sceneId'=t.input->>'sceneId'
         AND e.payload->'data'->'environment'->>'taskId'=t.id::text`,
        [
          lease.id,
          lease.ownerId,
          world.id,
          lease.token,
          JSON.stringify(input),
          event.version,
          commandId,
          event.id,
        ],
      );
      if (finished.rowCount !== 1) reject('SCENE_ENVIRONMENT_TASK_FINISH_LOST');
      return true;
    });
  };
}
