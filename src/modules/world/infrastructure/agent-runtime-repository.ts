import { createHash } from 'node:crypto';
import type {
  AgentAttemptStore,
  AgentInputStore,
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

export class AgentRuntimePersistenceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
const fail = (code: string): never => {
  throw new AgentRuntimePersistenceError(code);
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function key(value: string) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_:-]{1,160}$/.test(value)) fail('INVALID_INPUT');
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
    !Number.isFinite(Date.parse(input.receivedAt))
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
  await sql.query(
    'INSERT INTO parallel_life.agent_input_receipts(id,world_id,owner_id,command_id,input_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
    [input.id, input.worldId, ownerId, input.commandId, input.inputHash, json(input, 60000)],
  );
  return { receipt: input, replay: false };
}
export class PostgresAgentRuntimeRepository
  implements AgentAttemptStore, AgentInputStore, AgentStateReader
{
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
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
        r.expectedWorldVersion !== input.expectedWorldVersion ||
        (r.recipientActorId !== null && r.recipientActorId !== input.actorId)
      )
        fail('INVALID_INPUT');
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
  mark(ownerId: string, expected: AgentAttempt, status: AgentAttemptStatus): Promise<AgentAttempt> {
    return this.db.transaction(ownerId, async (sql) => {
      const w = await world(sql, ownerId, expected.worldId),
        row = await loadAttempt(sql, ownerId, expected);
      if (status === 'committed' || status === 'response_received') fail('ATOMIC_COMMIT_REQUIRED');
      transitionAgentAttempt(row.status, status);
      if (status === 'request_sent') {
        if (!row.live) fail('ATTEMPT_STALE');
        if ((await epoch(sql, ownerId, expected.worldId)) !== expected.engineEpoch)
          fail('ENGINE_EPOCH_CONFLICT');
        if (w.version !== expected.expectedWorldVersion) fail('VERSION_CONFLICT');
        const state = (
          await sql.query(
            'SELECT revision FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3',
            [expected.worldId, ownerId, expected.actorId],
          )
        ).rows[0];
        if (state?.revision !== expected.expectedActorRevision) fail('AGENT_REVISION_CONFLICT');
      }
      if (row.status === status) return attempt(row);
      return attempt(
        (
          await sql.query(
            "UPDATE parallel_life.agent_attempts SET status=$2,sent_at=CASE WHEN $2='request_sent' THEN COALESCE(sent_at,clock_timestamp()) ELSE sent_at END,updated_at=now() WHERE id=$1 RETURNING *",
            [expected.id, status],
          )
        ).rows[0],
      );
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
