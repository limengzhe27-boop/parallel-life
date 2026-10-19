import { requireAgendaInitializeInputInTransaction } from './actor-agenda-initialization-repository.ts';
import { isAgendaInitializeInput } from '../domain/actor-agenda-initialization.ts';
import { validateGroupObservationContext } from './group-observation-context-validation.ts';
import { validateActorObservationInbox } from './actor-observation-inbox.ts';
import { validateSceneObservationContext } from './scene-observation-context-validation.ts';
import { validateActorEpisodeResults } from './episode-result-context-repository.ts';
import { validateEpisodeLifecycleContext } from './episode-lifecycle-repository.ts';
import { bindPlayerEpisodeAttempt } from './player-episode-manifest-repository.ts';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  isEpisodeConsiderationInput,
  requireEpisodeDeliveryInTransaction,
} from './agent-episode-attention.ts';
import type {
  AgentAttemptStore,
  AgentInputStore,
  AgentSnapshot,
  AgentStateReader,
} from '../application/agent-runtime-ports.ts';
import type {
  ActorAgentState,
  AgentActionResult,
  AgentAttempt,
  AgentAttemptStatus,
  AgentIdentity,
  AgentInputReceipt,
} from '../domain/agent-runtime.ts';
import { transitionAgentAttempt } from '../domain/agent-runtime.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { validateActorEpisodeIntentSnapshotInTransaction } from './actor-episode-intent-repository.ts';
import { readActorStrategyBasis } from './agent-source-resolver.ts';
import { requireUnpaidEpisodeRequestInTransaction } from './agent-narrative-repository.ts';
import { requireActiveAgentDeliveryInTransaction } from './agent-delivery-activity.ts';
import { resumeCancelledAgentAttemptInTransaction } from './agent-zero-send-recovery.ts';

export class AgentRuntimePersistenceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
function fail(code: string): never {
  throw new AgentRuntimePersistenceError(code);
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function key(value: string) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_:-]{1,160}$/.test(value)) fail('INVALID_INPUT');
}
function validInstant(value: string) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const wall = new Date(value.slice(0, 19) + 'Z');
  return Number.isFinite(wall.getTime()) && wall.toISOString().slice(0, 19) === value.slice(0, 19);
}
function integer(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_INPUT');
}
function json(value: unknown, max: number): string {
  let result: string | undefined;
  try {
    result = JSON.stringify(value);
  } catch {
    fail('INVALID_INPUT');
  }
  if (result === undefined || Buffer.byteLength(result, 'utf8') > max) fail('INVALID_INPUT');
  return result!;
}
async function world(sql: SqlClient, ownerId: string, worldId: string, lock = true) {
  const row = (
    await sql.query(
      `SELECT version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [worldId, ownerId],
    )
  ).rows[0];
  if (!row) fail('NOT_FOUND');
  return row;
}
function actorExists(w: { state: { actors?: { id: string }[] } }, actorId: string) {
  if (!w.state.actors?.some((a) => a.id === actorId)) fail('NOT_FOUND');
}
async function epoch(sql: SqlClient, ownerId: string, worldId: string) {
  return (
    (
      await sql.query(
        'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
        [worldId, ownerId],
      )
    ).rows[0]?.engine_epoch ?? 1
  );
}
function attempt(row: any): AgentAttempt {
  return {
    id: row.id,
    worldId: row.world_id,
    actorId: row.actor_id,
    commandId: row.command_id,
    inputReceiptId: row.input_receipt_id,
    engineEpoch: row.engine_epoch,
    expectedWorldVersion: row.expected_world_version,
    expectedActorRevision: row.expected_actor_revision,
    inputHash: row.input_hash,
    token: row.token,
    leaseUntil: new Date(row.lease_until).toISOString(),
    status: row.status,
    ...(row.event_id ? { eventId: row.event_id } : {}),
  };
}
async function loadAttempt(sql: SqlClient, ownerId: string, expected: AgentAttempt, lock = true) {
  const row = (
    await sql.query(
      `SELECT *,lease_until>clock_timestamp() AS live FROM parallel_life.agent_attempts WHERE id=$1 AND world_id=$2 AND owner_id=$3${lock ? ' FOR UPDATE' : ''}`,
      [expected.id, expected.worldId, ownerId],
    )
  ).rows[0];
  if (!row) fail('NOT_FOUND');
  const actual = attempt(row);
  for (const field of [
    'worldId',
    'actorId',
    'commandId',
    'inputReceiptId',
    'inputHash',
    'engineEpoch',
    'expectedWorldVersion',
    'expectedActorRevision',
    'token',
    'leaseUntil',
  ] as const)
    if (actual[field] !== expected[field]) fail('ATTEMPT_STALE');
  return row;
}
function stateShape(state: ActorAgentState) {
  key(state.worldId);
  key(state.actorId);
  integer(state.revision);
  integer(state.projectedWorldVersion);
  if (
    state.schemaVersion !== 1 ||
    typeof state.definitionRef !== 'string' ||
    !state.definitionRef.trim() ||
    [
      'knowledgeSourceIds',
      'memoryIds',
      'relationshipIds',
      'goals',
      'plans',
      'actions',
      'responsibilities',
      'decisions',
    ].some((k) => !Array.isArray((state as any)[k]))
  )
    fail('INVALID_INPUT');
  return json(state, 240000);
}
/** Explicit initialization only; ordinary snapshot reads never create state. Caller owns the transaction. */
export async function initializeActorAgentStateInTransaction(
  sql: SqlClient,
  ownerId: string,
  state: ActorAgentState,
): Promise<ActorAgentState> {
  const document = stateShape(state),
    w = await world(sql, ownerId, state.worldId);
  actorExists(w, state.actorId);
  if (state.revision !== 0 || state.projectedWorldVersion > w.version)
    fail('AGENT_REVISION_CONFLICT');
  await sql.query(
    'INSERT INTO parallel_life.actor_agent_states(world_id,owner_id,actor_id,revision,projected_world_version,document) VALUES($1,$2,$3,0,$4,$5) ON CONFLICT(world_id,actor_id) DO NOTHING',
    [state.worldId, ownerId, state.actorId, state.projectedWorldVersion, document],
  );
  const stored = (
    await sql.query(
      'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3',
      [state.worldId, ownerId, state.actorId],
    )
  ).rows[0]?.document as ActorAgentState;
  if (!stored || stored.definitionRef !== state.definitionRef) fail('AGENT_DEFINITION_CONFLICT');
  return stored;
}
/** Quiescent, monotonic engine transition. Existing time, history and world version are untouched. */
export async function switchAgentEngineEpochInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: {
    worldId: string;
    expectedEpoch: number;
    nextEpoch: number;
    expectedWorldVersion: number;
  },
): Promise<void> {
  key(input.worldId);
  integer(input.expectedWorldVersion);
  integer(input.expectedEpoch);
  integer(input.nextEpoch);
  const w = await world(sql, ownerId, input.worldId);
  if (w.version !== input.expectedWorldVersion) fail('VERSION_CONFLICT');
  if (
    input.nextEpoch !== input.expectedEpoch + 1 ||
    input.expectedEpoch < 1 ||
    (await epoch(sql, ownerId, input.worldId)) !== input.expectedEpoch
  )
    fail('ENGINE_EPOCH_CONFLICT');
  const missing = (
    await sql.query(
      "SELECT EXISTS(SELECT 1 FROM parallel_life.worlds w CROSS JOIN LATERAL jsonb_array_elements(w.state->'actors') a WHERE w.id=$1 AND w.owner_id=$2 AND NOT EXISTS(SELECT 1 FROM parallel_life.actor_agent_states s WHERE s.world_id=w.id AND s.owner_id=w.owner_id AND s.actor_id=a->>'id')) AS missing",
      [input.worldId, ownerId],
    )
  ).rows[0].missing;
  if (missing) fail('AGENT_PROJECTION_INCOMPLETE');
  const busy = (
    await sql.query(
      `SELECT
    EXISTS(SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND status IN ('reserved','request_sent','response_received','unknown_after_send')) OR
    EXISTS(SELECT 1 FROM parallel_life.commands WHERE world_id=$1 AND owner_id=$2 AND status IN ('queued','running','unknown')) OR
    EXISTS(SELECT 1 FROM parallel_life.tasks WHERE owner_id=$2 AND (input->>'worldId'=$1 OR (scope_kind='world' AND scope_id=$1)) AND status IN ('queued','running','unknown')) OR
    EXISTS(SELECT 1 FROM parallel_life.director_runtime_attempts WHERE world_id=$1 AND owner_id=$2 AND status IN ('reserved','request_sent','response_received','unknown_after_send')) OR
    EXISTS(SELECT 1 FROM parallel_life.world_director_attempts WHERE world_id=$1 AND owner_id=$2 AND status IN ('started','unknown')) OR
    EXISTS(SELECT 1 FROM parallel_life.publication_opening_deliveries WHERE world_id=$1 AND owner_id=$2 AND status IN ('sending','unknown')) OR
    EXISTS(SELECT 1 FROM parallel_life.publication_story_nodes WHERE world_id=$1 AND owner_id=$2 AND status IN ('claimed','unknown')) AS busy`,
      [input.worldId, ownerId],
    )
  ).rows[0].busy;
  if (busy) fail('ATTEMPT_PENDING');
  await sql.query(
    'INSERT INTO parallel_life.agent_runtime_worlds(world_id,owner_id,engine_epoch) VALUES($1,$2,1) ON CONFLICT(world_id) DO NOTHING',
    [input.worldId, ownerId],
  );
  await sql.query(
    'UPDATE parallel_life.agent_runtime_worlds SET engine_epoch=$3,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$4',
    [input.worldId, ownerId, input.nextEpoch, input.expectedEpoch],
  );
}
function receiptBody(r: AgentInputReceipt) {
  return JSON.stringify([
    r.worldId,
    r.commandId,
    r.inputHash,
    r.channel,
    r.threadId,
    r.recipientActorId,
    r.expectedWorldVersion,
    r.origin,
    r.text,
  ]);
}
export async function acceptAgentInputInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: AgentInputReceipt,
): Promise<{ receipt: AgentInputReceipt; replay: boolean }> {
  key(input.id);
  key(input.worldId);
  key(input.commandId);
  key(input.threadId);
  integer(input.expectedWorldVersion);
  if (
    !/^[a-f0-9]{64}$/.test(input.inputHash) ||
    !['private', 'group', 'scene'].includes(input.channel) ||
    !['player', 'wake', 'coordination'].includes(input.origin) ||
    typeof input.text !== 'string' ||
    !input.text.trim() ||
    input.text.length > 16000 ||
    !validInstant(input.receivedAt) ||
    !validInstant(input.storyAt)
  )
    fail('INVALID_INPUT');
  const w = await world(sql, ownerId, input.worldId);
  const row = (
    await sql.query(
      'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
      [input.worldId, ownerId, input.commandId],
    )
  ).rows[0];
  if (row) {
    if (receiptBody(row.document) !== receiptBody(input)) fail('COMMAND_CONFLICT');
    return { receipt: row.document, replay: true };
  }
  if (w.version !== input.expectedWorldVersion) fail('VERSION_CONFLICT');
  if (input.recipientActorId !== null) actorExists(w, input.recipientActorId);
  await requireAgendaInitializeInputInTransaction(sql, ownerId, input);
  await sql.query(
    'INSERT INTO parallel_life.agent_input_receipts(id,world_id,owner_id,command_id,input_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
    [input.id, input.worldId, ownerId, input.commandId, input.inputHash, json(input, 60000)],
  );
  return { receipt: input, replay: false };
}
/** Receipt scope is authoritative; membership must cover both acceptance and execution. */
export async function requireInputAuthority(
  sql: SqlClient,
  ownerId: string,
  receipt: AgentInputReceipt,
  actorId: string,
  executionVersion: number,
) {
  if (
    !['player', 'wake', 'coordination'].includes(receipt.origin) ||
    !validInstant(receipt.storyAt)
  )
    fail('INPUT_SCOPE_FORBIDDEN');
  let sources: string[] = [receipt.id];
  if (receipt.channel === 'private') {
    if (receipt.recipientActorId !== actorId || receipt.threadId !== actorId)
      fail('INPUT_SCOPE_FORBIDDEN');
  } else if (receipt.channel === 'group') {
    const row = (
      await sql.query(
        `SELECT ARRAY[g.source_event_id,am.source_event_id,cm.source_event_id,pm.source_event_id,cp.source_event_id] AS sources
      FROM parallel_life.world_groups g
      JOIN parallel_life.world_events ge ON ge.world_id=g.world_id AND ge.owner_id=g.owner_id AND ge.id=g.source_event_id AND ge.version=g.source_version
      JOIN parallel_life.commands gc ON gc.world_id=ge.world_id AND gc.owner_id=ge.owner_id AND gc.id=ge.command_id AND gc.status='succeeded' AND gc.result_event_id=ge.id
      JOIN parallel_life.world_group_memberships am ON am.world_id=g.world_id AND am.owner_id=g.owner_id AND am.group_id=g.id AND am.member_key=$4
      JOIN parallel_life.world_events ae ON ae.world_id=am.world_id AND ae.owner_id=am.owner_id AND ae.id=am.source_event_id AND ae.version=am.joined_version
      JOIN parallel_life.commands ac ON ac.world_id=ae.world_id AND ac.owner_id=ae.owner_id AND ac.id=ae.command_id AND ac.status='succeeded' AND ac.result_event_id=ae.id
      JOIN parallel_life.world_group_memberships pm ON pm.world_id=g.world_id AND pm.owner_id=g.owner_id AND pm.group_id=g.id AND pm.member_key='player'
      JOIN parallel_life.world_events pe ON pe.world_id=pm.world_id AND pe.owner_id=pm.owner_id AND pe.id=pm.source_event_id AND pe.version=pm.joined_version
      JOIN parallel_life.commands pc ON pc.world_id=pe.world_id AND pc.owner_id=pe.owner_id AND pc.id=pe.command_id AND pc.status='succeeded' AND pc.result_event_id=pe.id
      JOIN parallel_life.world_group_memberships cm ON cm.world_id=g.world_id AND cm.owner_id=g.owner_id AND cm.group_id=g.id AND cm.member_key=$4
      JOIN parallel_life.world_events ce ON ce.world_id=cm.world_id AND ce.owner_id=cm.owner_id AND ce.id=cm.source_event_id AND ce.version=cm.joined_version
      JOIN parallel_life.commands cc ON cc.world_id=ce.world_id AND cc.owner_id=ce.owner_id AND cc.id=ce.command_id AND cc.status='succeeded' AND cc.result_event_id=ce.id
      JOIN parallel_life.world_group_memberships cp ON cp.world_id=g.world_id AND cp.owner_id=g.owner_id AND cp.group_id=g.id AND cp.member_key='player'
      JOIN parallel_life.world_events cpe ON cpe.world_id=cp.world_id AND cpe.owner_id=cp.owner_id AND cpe.id=cp.source_event_id AND cpe.version=cp.joined_version
      JOIN parallel_life.commands cpc ON cpc.world_id=cpe.world_id AND cpc.owner_id=cpe.owner_id AND cpc.id=cpe.command_id AND cpc.status='succeeded' AND cpc.result_event_id=cpe.id
      WHERE g.world_id=$1 AND g.owner_id=$2 AND g.id=$3 AND g.source_version<=$5
      AND ge.payload->>'type'='group.created' AND ge.payload->'data'->>'groupId'=g.id
      AND am.joined_version<=$5 AND (am.left_version IS NULL OR am.left_version>$5)
      AND pm.joined_version<=$5 AND (pm.left_version IS NULL OR pm.left_version>$5)
      AND cm.joined_version<=$6 AND (cm.left_version IS NULL OR cm.left_version>$6)
      AND cp.joined_version<=$6 AND (cp.left_version IS NULL OR cp.left_version>$6) LIMIT 1`,
        [
          receipt.worldId,
          ownerId,
          receipt.threadId,
          actorId,
          receipt.expectedWorldVersion,
          executionVersion,
        ],
      )
    ).rows[0];
    if (!row) fail('INPUT_SCOPE_FORBIDDEN');
    sources.push(...row.sources);
  } else if (receipt.channel === 'scene') {
    const row = (
      await sql.query(
        `SELECT ARRAY[s.source_event_id,ae.id,pe.id] AS sources
      FROM parallel_life.scene_sessions s
      JOIN parallel_life.player_experiences x ON x.world_id=s.world_id AND x.owner_id=s.owner_id AND x.current_scene_id=s.id
      JOIN parallel_life.world_events se ON se.world_id=s.world_id AND se.owner_id=s.owner_id AND se.id=s.source_event_id
      JOIN parallel_life.commands sc ON sc.world_id=se.world_id AND sc.owner_id=se.owner_id AND sc.id=se.command_id AND sc.status='succeeded' AND sc.result_event_id=se.id
      CROSS JOIN LATERAL jsonb_array_elements(s.document->'presence') a
      CROSS JOIN LATERAL jsonb_array_elements(s.document->'presence') p
      JOIN parallel_life.world_events ae ON ae.world_id=s.world_id AND ae.owner_id=s.owner_id AND ae.id=a->>'sourceEventId' AND ae.version=(a->>'sourceVersion')::int
      JOIN parallel_life.commands ac ON ac.world_id=ae.world_id AND ac.owner_id=ae.owner_id AND ac.id=ae.command_id AND ac.status='succeeded' AND ac.result_event_id=ae.id
      JOIN parallel_life.world_events pe ON pe.world_id=s.world_id AND pe.owner_id=s.owner_id AND pe.id=p->>'sourceEventId' AND pe.version=(p->>'sourceVersion')::int
      JOIN parallel_life.commands pc ON pc.world_id=pe.world_id AND pc.owner_id=pe.owner_id AND pc.id=pe.command_id AND pc.status='succeeded' AND pc.result_event_id=pe.id
      WHERE s.world_id=$1 AND s.owner_id=$2 AND s.id=$3 AND s.document->>'status'='active'
      AND se.payload->>'type'='scene.entered' AND se.payload->'data'->>'sceneId'=s.id AND se.version<=$5
      AND a->'participant'=jsonb_build_object('kind','actor','actorId',$4::text)
      AND p->'participant'=jsonb_build_object('kind','player')
      AND (a->>'joinedVersion')::int=ae.version AND ae.version<=$5 AND (NOT(a?'leftVersion') OR (a->>'leftVersion')::int>$6)
      AND (p->>'joinedVersion')::int=pe.version AND pe.version<=$5 AND (NOT(p?'leftVersion') OR (p->>'leftVersion')::int>$6)
      AND ae.payload->>'type' IN ('scene.opened','scene.action_resolved') AND ae.payload->'data'->>'sceneId'=s.id
      AND (ae.payload->'data'->'worldResults'->'scene'->'presence' @> jsonb_build_array(a-'leftVersion')
        OR (ae.payload->>'type'='scene.opened'
          AND ae.payload->'data'->'environment'->>'producer'='deterministic'
          AND ae.payload->'data'->'environment'->'schemaVersion'='1'::jsonb
          AND ae.payload->'data'->'environment'->>'enteredEventId'=se.id
          AND ae.payload->'data'->'environment'->>'placeId'=s.document->>'placeId'
          AND ae.version=se.version+1
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(ae.payload->'data'->'environment'->'presenceProofs') proof
            LEFT JOIN parallel_life.world_events prior ON prior.world_id=s.world_id AND prior.owner_id=s.owner_id
              AND prior.id=proof->>'sourceEventId' AND prior.version=(proof->>'worldVersion')::int
            LEFT JOIN parallel_life.commands prior_command ON prior_command.world_id=prior.world_id
              AND prior_command.owner_id=prior.owner_id AND prior_command.id=prior.command_id
              AND prior_command.status='succeeded' AND prior_command.result_event_id=prior.id
            JOIN parallel_life.world_authoritative_positions actual ON actual.world_id=s.world_id
              AND actual.owner_id=s.owner_id AND actual.subject_key='actor:'||$4
            JOIN parallel_life.tasks task ON task.id::text=ae.payload->'data'->'environment'->>'taskId'
              AND task.owner_id=s.owner_id AND task.scope_kind='world' AND task.scope_id=s.world_id
            WHERE proof->'subject'=jsonb_build_object('kind','actor','actorId',$4::text)
              AND proof->>'worldId'=s.world_id AND proof->>'status'='at'
              AND proof->>'placeId'=s.document->>'placeId'
              AND (
                ((proof->>'worldVersion')::int = 0 AND (proof->>'sourceEventId') IS NULL)
                OR (prior.version<se.version AND prior_command.status='succeeded' AND prior_command.result_event_id=prior.id)
              )
              AND (proof->>'occurredAt')::timestamptz<=(ae.payload->>'storyAt')::timestamptz
              AND actual.document->>'status'='at' AND actual.document->>'placeId'=s.document->>'placeId'
              AND task.status='succeeded' AND task.result_version=ae.version
              AND task.input->>'type'='scene' AND task.input->'actionId'='null'::jsonb
              AND task.input->>'sceneId'=s.id AND (task.input->>'expectedVersion')::int=se.version
          )))
      AND pe.payload->>'type'='scene.entered' AND pe.payload->'data'->>'sceneId'=s.id LIMIT 1`,
        [
          receipt.worldId,
          ownerId,
          receipt.threadId,
          actorId,
          receipt.expectedWorldVersion,
          executionVersion,
        ],
      )
    ).rows[0];
    if (!row) fail('INPUT_SCOPE_FORBIDDEN');
    sources.push(...row.sources);
  } else fail('INPUT_SCOPE_FORBIDDEN');
  if (receipt.recipientActorId !== null && receipt.recipientActorId !== actorId)
    fail('INPUT_SCOPE_FORBIDDEN');
  const forgotten = (
    await sql.query(
      `SELECT 1 FROM parallel_life.memory_records WHERE owner_id=$1 AND status='forgotten'
    AND ((scope_type='character' AND character_id=$2 AND branch_id=$3) OR (scope_type='branch' AND scope_id=$3 AND kind<>'episode')) AND source_ids ?| $4::text[] LIMIT 1`,
      [ownerId, actorId, receipt.worldId, sources],
    )
  ).rows[0];
  if (forgotten) fail('INPUT_SCOPE_FORBIDDEN');
}
export class PostgresAgentRuntimeRepository
  implements AgentAttemptStore, AgentInputStore, AgentStateReader
{
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  lookup(ownerId: string, worldId: string, commandId: string): Promise<AgentAttempt | null> {
    return this.db.transaction(ownerId, async (sql) => {
      await world(sql, ownerId, worldId, false);
      const row = (
        await sql.query(
          'SELECT * FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3',
          [worldId, ownerId, commandId],
        )
      ).rows[0];
      return row ? attempt(row) : null;
    });
  }
  accept(ownerId: string, input: AgentInputReceipt) {
    return this.db.transaction(ownerId, (sql) =>
      acceptAgentInputInTransaction(sql, ownerId, input),
    );
  }
  read(ownerId: string, identity: AgentIdentity): Promise<ActorAgentState | null> {
    return this.db.transaction(ownerId, async (sql) => {
      await world(sql, ownerId, identity.worldId, false);
      return (
        (
          await sql.query(
            'SELECT document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3',
            [identity.worldId, ownerId, identity.actorId],
          )
        ).rows[0]?.document ?? null
      );
    });
  }
  claim(ownerId: string, input: Parameters<AgentAttemptStore['claim']>[1]) {
    return this.db.transaction(ownerId, async (sql) => {
      key(input.id);
      key(input.commandId);
      key(input.worldId);
      key(input.actorId);
      key(input.token);
      key(input.inputReceiptId);
      integer(input.expectedWorldVersion);
      integer(input.expectedActorRevision);
      integer(input.engineEpoch);
      if (!/^[a-f0-9]{64}$/.test(input.inputHash) || !Number.isFinite(Date.parse(input.leaseUntil)))
        fail('INVALID_INPUT');
      const w = await world(sql, ownerId, input.worldId);
      actorExists(w, input.actorId);
      const old = (
        await sql.query(
          'SELECT * FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND command_id=$3 FOR UPDATE',
          [input.worldId, ownerId, input.commandId],
        )
      ).rows[0];
      if (old) {
        const a = attempt(old);
        for (const k of [
          'actorId',
          'inputReceiptId',
          'inputHash',
          'engineEpoch',
          'expectedWorldVersion',
          'expectedActorRevision',
        ] as const)
          if (a[k] !== input[k]) fail('COMMAND_CONFLICT');
        if (old.status === 'cancelled_before_send') {
          const resumed = await resumeCancelledAgentAttemptInTransaction(
            sql,
            ownerId,
            old,
            requireInputAuthority,
          );
          return { attempt: attempt(resumed), replay: false };
        }
        return { attempt: a, replay: true };
      }
      if ((await epoch(sql, ownerId, input.worldId)) !== input.engineEpoch || input.engineEpoch < 2)
        fail('ENGINE_EPOCH_CONFLICT');
      if (w.version !== input.expectedWorldVersion) fail('VERSION_CONFLICT');
      const state = (
        await sql.query(
          'SELECT revision FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 FOR UPDATE',
          [input.worldId, ownerId, input.actorId],
        )
      ).rows[0];
      if (!state || state.revision !== input.expectedActorRevision) fail('AGENT_REVISION_CONFLICT');
      const r = (
        await sql.query(
          'SELECT document FROM parallel_life.agent_input_receipts WHERE id=$1 AND world_id=$2 AND owner_id=$3',
          [input.inputReceiptId, input.worldId, ownerId],
        )
      ).rows[0]?.document as AgentInputReceipt | undefined;
      if (
        !r ||
        r.inputHash !== input.inputHash ||
        r.expectedWorldVersion > input.expectedWorldVersion ||
        (r.recipientActorId !== null && r.recipientActorId !== input.actorId)
      )
        fail('INVALID_INPUT');
      await requireInputAuthority(sql, ownerId, r, input.actorId, input.expectedWorldVersion);
      if (
        !(await sql.query('SELECT $1::timestamptz>clock_timestamp() AS live', [input.leaseUntil]))
          .rows[0].live
      )
        fail('ATTEMPT_STALE');
      const busy = (
        await sql.query(
          "SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND status IN ('reserved','request_sent','response_received','unknown_after_send')",
          [input.worldId, ownerId, input.actorId],
        )
      ).rowCount;
      if (busy) fail('ATTEMPT_PENDING');
      const row = (
        await sql.query(
          "INSERT INTO parallel_life.agent_attempts(id,world_id,owner_id,actor_id,command_id,input_receipt_id,input_hash,engine_epoch,expected_world_version,expected_actor_revision,token,lease_until,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'reserved') RETURNING *",
          [
            input.id,
            input.worldId,
            ownerId,
            input.actorId,
            input.commandId,
            input.inputReceiptId,
            input.inputHash,
            input.engineEpoch,
            input.expectedWorldVersion,
            input.expectedActorRevision,
            input.token,
            input.leaseUntil,
          ],
        )
      ).rows[0];
      return { attempt: attempt(row), replay: false };
    });
  }
  markRequestSentWithSources(ownerId: string, expected: AgentAttempt, snapshot: AgentSnapshot) {
    return this.mark(ownerId, expected, 'request_sent', snapshot);
  }
  mark(
    ownerId: string,
    expected: AgentAttempt,
    status: AgentAttemptStatus,
    snapshot?: AgentSnapshot,
  ): Promise<AgentAttempt> {
    return this.db.transaction(ownerId, async (sql) => {
      const w = await world(sql, ownerId, expected.worldId),
        row = await loadAttempt(sql, ownerId, expected);
      if (status === 'committed' || status === 'response_received') fail('ATOMIC_COMMIT_REQUIRED');
      transitionAgentAttempt(row.status, status);
      let episodeDelivery = false;
      if (status === 'request_sent') {
        const receipt = (
          await sql.query(
            'SELECT document FROM parallel_life.agent_input_receipts WHERE id=$1 AND world_id=$2 AND owner_id=$3',
            [expected.inputReceiptId, expected.worldId, ownerId],
          )
        ).rows[0]?.document as AgentInputReceipt | undefined;
        if (!receipt) fail('INPUT_SCOPE_FORBIDDEN');
        episodeDelivery = isEpisodeConsiderationInput(receipt);
        // The immutable accepted body, not a mutable prepared snapshot, decides
        // whether author-source validation is mandatory before any paid send.
        if ((isEpisodeConsiderationInput(receipt) || isAgendaInitializeInput(receipt)) && !snapshot)
          fail('INPUT_SCOPE_FORBIDDEN');
        await requireAgendaInitializeInputInTransaction(
          sql,
          ownerId,
          receipt,
          expected.engineEpoch,
        );
        if (snapshot) {
          if (
            snapshot.state.worldId !== expected.worldId ||
            snapshot.state.actorId !== expected.actorId ||
            snapshot.worldVersion !== expected.expectedWorldVersion ||
            snapshot.state.revision !== expected.expectedActorRevision ||
            snapshot.input.sourceId !== receipt.id ||
            snapshot.input.text !== receipt.text ||
            snapshot.input.origin !== receipt.origin
          )
            fail('INPUT_SCOPE_FORBIDDEN');
          if (isEpisodeConsiderationInput(receipt)) {
            try {
              await requireUnpaidEpisodeRequestInTransaction(
                sql,
                ownerId,
                receipt,
                snapshot.state.definitionRef,
                expected.id,
              );
            } catch {
              fail('INPUT_SCOPE_FORBIDDEN');
            }
          }
          await validateActorEpisodeIntentSnapshotInTransaction(sql, ownerId, snapshot);
          await validateEpisodeLifecycleContext(sql, ownerId, snapshot);
          await validateActorEpisodeResults(sql, ownerId, snapshot);
          await validateSceneObservationContext(sql, ownerId, snapshot);
          await validateGroupObservationContext(sql, ownerId, snapshot);
          await validateActorObservationInbox(sql, ownerId, snapshot);
        }
        await requireInputAuthority(
          sql,
          ownerId,
          receipt,
          expected.actorId,
          expected.expectedWorldVersion,
        );
        if (isEpisodeConsiderationInput(receipt))
          await requireEpisodeDeliveryInTransaction(sql, ownerId, {
            worldId: expected.worldId,
            worldVersion: expected.expectedWorldVersion,
            actorId: expected.actorId,
          });
        else
          await requireActiveAgentDeliveryInTransaction(
            sql,
            ownerId,
            expected.worldId,
            'NPC_DELIVERY_DEFERRED',
          );
        if (!row.live) fail('ATTEMPT_STALE');
        if ((await epoch(sql, ownerId, expected.worldId)) !== expected.engineEpoch)
          fail('ENGINE_EPOCH_CONFLICT');
        if (w.version !== expected.expectedWorldVersion) fail('VERSION_CONFLICT');
        const state = (
          await sql.query(
            'SELECT revision,document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3',
            [expected.worldId, ownerId, expected.actorId],
          )
        ).rows[0];
        if (state?.revision !== expected.expectedActorRevision) fail('AGENT_REVISION_CONFLICT');
        if (snapshot) {
          if (!isDeepStrictEqual(state.document, snapshot.state)) fail('AGENT_REVISION_CONFLICT');
          const strategy = snapshot.sources.filter(
            (source) =>
              source.usage === 'private_strategy' &&
              !snapshot.actorObservationInbox?.sourceIds.includes(source.id),
          );
          if (strategy.length) {
            const actual = await readActorStrategyBasis(
              sql,
              ownerId,
              state.document,
              snapshot.worldVersion,
              snapshot.storyAt,
            );
            if (strategy.some((source) => !actual.some((item) => isDeepStrictEqual(source, item))))
              fail('AGENT_REVISION_CONFLICT');
          }
        }
      }
      if (status === 'request_sent' && snapshot)
        await bindPlayerEpisodeAttempt(sql, ownerId, expected, snapshot);
      if (row.status === status) return attempt(row);
      const saved = (
        await sql.query(
          "UPDATE parallel_life.agent_attempts SET status=$2,sent_at=CASE WHEN $2='request_sent' THEN COALESCE(sent_at,clock_timestamp()) ELSE sent_at END,updated_at=now() WHERE id=$1 RETURNING *",
          [expected.id, status],
        )
      ).rows[0];
      if (status === 'request_sent') {
        if (episodeDelivery)
          await requireEpisodeDeliveryInTransaction(sql, ownerId, {
            worldId: expected.worldId,
            worldVersion: expected.expectedWorldVersion,
            actorId: expected.actorId,
          });
        else
          await requireActiveAgentDeliveryInTransaction(
            sql,
            ownerId,
            expected.worldId,
            'NPC_DELIVERY_DEFERRED',
          );
      }
      return attempt(saved);
    });
  }
  saveResponse(ownerId: string, expected: AgentAttempt, response: unknown): Promise<AgentAttempt> {
    let body: string,
      rejected = false;
    try {
      body = json(response, 1000000);
    } catch {
      rejected = true;
      let original: string | undefined;
      try {
        original = JSON.stringify(response);
      } catch {
        /* Not a JSON response. */
      }
      body = JSON.stringify({
        storageError: 'INVALID_OR_OVERSIZE_RESPONSE',
        ...(original ? { sha256: hash(original), bytes: Buffer.byteLength(original) } : {}),
      });
    }
    const digest = hash(body);
    return this.db.transaction(ownerId, async (sql) => {
      await world(sql, ownerId, expected.worldId);
      const row = await loadAttempt(sql, ownerId, expected);
      if (row.response_hash) {
        if (row.response_hash !== digest) fail('RESPONSE_CONFLICT');
        return attempt(row);
      }
      if (
        !row.sent_at ||
        !['request_sent', 'unknown_after_send', 'stale_discarded'].includes(row.status)
      )
        fail('INVALID_ATTEMPT_TRANSITION');
      const stale =
        !row.live ||
        (await epoch(sql, ownerId, expected.worldId)) !== expected.engineEpoch ||
        row.status === 'stale_discarded';
      return attempt(
        (
          await sql.query(
            'UPDATE parallel_life.agent_attempts SET response=$2,response_hash=$3,status=$4,updated_at=now() WHERE id=$1 RETURNING *',
            [
              expected.id,
              body,
              digest,
              stale ? 'stale_discarded' : rejected ? 'invalid_output' : 'response_received',
            ],
          )
        ).rows[0],
      );
    });
  }
  readResponse(
    ownerId: string,
    expected: AgentAttempt,
  ): Promise<{ found: true; response: unknown } | { found: false }> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = await loadAttempt(sql, ownerId, expected, false);
      return row.response_hash
        ? { found: true as const, response: row.response }
        : { found: false as const };
    });
  }
}

/** No BEGIN/COMMIT or external call. Root must use this SqlClient for every following world write. */
export async function beginAgentCommitInTransaction(
  sql: SqlClient,
  ownerId: string,
  expected: AgentAttempt,
): Promise<ActorAgentState> {
  const w = await world(sql, ownerId, expected.worldId),
    row = await loadAttempt(sql, ownerId, expected);
  if ((await epoch(sql, ownerId, expected.worldId)) !== expected.engineEpoch)
    fail('ENGINE_EPOCH_CONFLICT');
  if (!row.live || row.status !== 'response_received') fail('ATTEMPT_STALE');
  if (w.version !== expected.expectedWorldVersion) fail('VERSION_CONFLICT');
  const current = (
    await sql.query(
      'SELECT revision,document FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 FOR UPDATE',
      [expected.worldId, ownerId, expected.actorId],
    )
  ).rows[0];
  if (current?.revision !== expected.expectedActorRevision) fail('AGENT_REVISION_CONFLICT');
  const receipt = (
    await sql.query(
      'SELECT document FROM parallel_life.agent_input_receipts WHERE id=$1 AND world_id=$2 AND owner_id=$3',
      [expected.inputReceiptId, expected.worldId, ownerId],
    )
  ).rows[0]?.document as AgentInputReceipt | undefined;
  if (!receipt) fail('INPUT_SCOPE_FORBIDDEN');
  await requireInputAuthority(
    sql,
    ownerId,
    receipt,
    expected.actorId,
    expected.expectedWorldVersion,
  );
  await sql.query(
    "SELECT set_config('app.agent_engine_epoch',$1,true),set_config('app.agent_world_id',$2,true),set_config('app.agent_commit_attempt_id',$3,true)",
    [String(expected.engineEpoch), expected.worldId, expected.id],
  );
  return current.document;
}
/** Finish only after the actual world event, command receipt and all projections were written in this UoW. */
export async function finishAgentCommitInTransaction(
  sql: SqlClient,
  ownerId: string,
  input: {
    attempt: AgentAttempt;
    eventId: string;
    state: ActorAgentState;
    results: AgentActionResult[];
  },
): Promise<void> {
  const { attempt: expected, state, results, eventId } = input;
  if (
    (await sql.query("SELECT current_setting('app.agent_commit_attempt_id',true) AS id")).rows[0]
      .id !== expected.id
  )
    fail('ATOMIC_COMMIT_REQUIRED');
  const document = stateShape(state),
    w = await world(sql, ownerId, expected.worldId),
    row = await loadAttempt(sql, ownerId, expected);
  if ((await epoch(sql, ownerId, expected.worldId)) !== expected.engineEpoch)
    fail('ENGINE_EPOCH_CONFLICT');
  if (!row.live || row.status !== 'response_received') fail('ATTEMPT_STALE');
  if (
    w.version !== expected.expectedWorldVersion + 1 ||
    state.worldId !== expected.worldId ||
    state.actorId !== expected.actorId ||
    state.revision !== expected.expectedActorRevision + 1 ||
    state.projectedWorldVersion !== w.version
  )
    fail('AGENT_REVISION_CONFLICT');
  const evidence = (
    await sql.query(
      "SELECT e.id FROM parallel_life.world_events e JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id WHERE e.world_id=$1 AND e.owner_id=$2 AND e.id=$3 AND e.version=$4 AND e.command_id=$5 AND c.expected_version=$6 AND e.payload->'data'->>'actorId'=$7",
      [
        expected.worldId,
        ownerId,
        eventId,
        w.version,
        expected.commandId,
        expected.expectedWorldVersion,
        expected.actorId,
      ],
    )
  ).rows[0];
  if (!evidence) fail('INVALID_COMMIT_SOURCE');
  const saved = await sql.query(
    'UPDATE parallel_life.actor_agent_states SET revision=$4,projected_world_version=$5,document=$6,updated_at=now() WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND revision=$7',
    [
      state.worldId,
      ownerId,
      state.actorId,
      state.revision,
      state.projectedWorldVersion,
      document,
      expected.expectedActorRevision,
    ],
  );
  if (saved.rowCount !== 1) fail('AGENT_REVISION_CONFLICT');
  for (const r of results) {
    if (
      r.worldId !== state.worldId ||
      r.actorId !== state.actorId ||
      r.eventId !== eventId ||
      r.worldVersion !== w.version ||
      !state.actions.some(
        (a) => a.id === r.actionId && a.resultId === r.id && a.status === r.outcome,
      )
    )
      fail('INVALID_COMMIT_SOURCE');
    await sql.query(
      'INSERT INTO parallel_life.agent_action_results(world_id,owner_id,actor_id,id,action_id,source_event_id,world_version,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [r.worldId, ownerId, r.actorId, r.id, r.actionId, eventId, r.worldVersion, json(r, 30000)],
    );
  }
  await sql.query(
    "UPDATE parallel_life.agent_attempts SET status='committed',event_id=$2,updated_at=now() WHERE id=$1",
    [expected.id, eventId],
  );
}
