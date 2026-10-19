import { createHash } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';
import { worldDateTimeInput } from '../domain/display-time.ts';

export type OwnAgendaBudgetDimension = 'owner' | 'world' | 'actor';
export type OwnAgendaBudgetPolicy = Readonly<
  Record<
    OwnAgendaBudgetDimension,
    {
      limit: number;
      windowSeconds: number;
    }
  >
>;
export type OwnAgendaBudgetSnapshot = Record<
  OwnAgendaBudgetDimension,
  {
    remaining: number;
    nextWindowRealAt: string;
  }
>;
export type OwnAgendaBudgetReservation =
  | { status: 'reserved'; attemptId: string; budgets: OwnAgendaBudgetSnapshot }
  | {
      status: 'budget_wait';
      code: 'OWN_AGENDA_BUDGET_WAIT';
      exhausted: OwnAgendaBudgetDimension[];
      nextCheckRealAt: string;
      budgets: OwnAgendaBudgetSnapshot;
    };
export class OwnAgendaBudgetError extends Error {
  readonly code:
    | 'INVALID_OWN_AGENDA_BUDGET_POLICY'
    | 'INVALID_OWN_AGENDA_BUDGET_SCOPE'
    | 'INVALID_OWN_AGENDA_BUDGET_TIME'
    | 'OWN_AGENDA_BUDGET_ATTEMPT_NOT_RESERVED';
  constructor(code: OwnAgendaBudgetError['code']) {
    super(code);
    this.code = code;
  }
}
const dimensions = ['owner', 'world', 'actor'] as const;
const savepoint = 'npc_own_agenda_budget_v1';
const key = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(v);
const fail = (code: OwnAgendaBudgetError['code']): never => {
  throw new OwnAgendaBudgetError(code);
};
const hash = (v: string[]) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Bucket = {
  dimension: OwnAgendaBudgetDimension;
  key: string;
  limit: number;
  windowMs: number;
  windowStart: string;
};
type CounterRow = { bucket: string; window_start: Date | string; count: number };
function dateMillis(value: Date | string): number {
  const str = value instanceof Date ? value.toISOString() : value;
  if (!worldDateTimeInput(str)) fail('INVALID_OWN_AGENDA_BUDGET_TIME');
  return Date.parse(str);
}
function iso(ms: number) {
  if (!Number.isSafeInteger(ms) || !Number.isFinite(new Date(ms).getTime()))
    fail('INVALID_OWN_AGENDA_BUDGET_TIME');
  const value = new Date(ms).toISOString();
  if (!worldDateTimeInput(value)) fail('INVALID_OWN_AGENDA_BUDGET_TIME');
  return value;
}
function buckets(
  worldId: string,
  actorId: string,
  policy: OwnAgendaBudgetPolicy,
  realNow: string,
): Bucket[] {
  if (!policy || Object.keys(policy).sort().join(',') !== 'actor,owner,world')
    fail('INVALID_OWN_AGENDA_BUDGET_POLICY');
  const realMs = dateMillis(realNow);
  return dimensions.map((dimension) => {
    const spec = policy[dimension];
    if (
      !spec ||
      Object.keys(spec).sort().join(',') !== 'limit,windowSeconds' ||
      !Number.isSafeInteger(spec.limit) ||
      spec.limit < 1 ||
      spec.limit > 2147483647 ||
      !Number.isSafeInteger(spec.windowSeconds) ||
      spec.windowSeconds < 1 ||
      spec.windowSeconds > 2147483647
    )
      fail('INVALID_OWN_AGENDA_BUDGET_POLICY');
    const windowMs = spec.windowSeconds * 1000;
    const windowStart = iso(Math.floor(realMs / windowMs) * windowMs);
    iso(Date.parse(windowStart) + windowMs);
    return {
      dimension,
      limit: spec.limit,
      windowMs,
      windowStart,
      // This namespace is a storage schema identity, not a configurable story/policy version.
      key:
        dimension === 'owner'
          ? 'npc-own-agenda:owner:v1'
          : dimension === 'world'
            ? `npc-own-agenda:world:v1:${hash([worldId])}`
            : `npc-own-agenda:actor:v1:${hash([worldId, actorId])}`,
    };
  });
}
function project(definitions: Bucket[], rows: CounterRow[]): OwnAgendaBudgetSnapshot {
  const out = {} as OwnAgendaBudgetSnapshot;
  for (const b of definitions) {
    const row = rows.find((r) => r.bucket === b.key);
    if (row && (!Number.isSafeInteger(row.count) || row.count < 1))
      fail('INVALID_OWN_AGENDA_BUDGET_POLICY');
    const proposedStart = Date.parse(b.windowStart),
      storedStart = row ? dateMillis(row.window_start) : null;
    const active = storedStart !== null && storedStart >= proposedStart;
    const start = active ? storedStart : proposedStart;
    out[b.dimension] = {
      remaining: Math.max(0, b.limit - (active ? row!.count : 0)),
      nextWindowRealAt: iso(start + b.windowMs),
    };
  }
  return out;
}
async function requireScope(
  sql: SqlClient,
  owner: string,
  worldId: string,
  actorId: string,
  lock = false,
) {
  if (!key(owner) || !key(worldId) || !key(actorId)) fail('INVALID_OWN_AGENDA_BUDGET_SCOPE');
  const row = (
    await sql.query(
      `SELECT w.version,c.engine_epoch,s.revision,
      s.document->>'worldId' state_world,s.document->>'actorId' state_actor,
      current_setting('app.user_id',true) identity,
      pg_has_role(current_user,'pl_app','MEMBER') is_app,
      pg_has_role(current_user,'pl_worker','MEMBER') is_worker,
      (SELECT count(*) FROM jsonb_array_elements(w.state->'actors') a WHERE a->>'id'=$3)::integer actor_count
    FROM parallel_life.worlds w
    LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
    LEFT JOIN parallel_life.actor_agent_states s ON s.world_id=w.id AND s.owner_id=w.owner_id AND s.actor_id=$3
    WHERE w.id=$1 AND w.owner_id=$2${lock ? ' FOR UPDATE OF w' : ''}`,
      [worldId, owner, actorId],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND');
  if (
    row.identity !== owner ||
    !row.is_app ||
    row.is_worker ||
    row.actor_count !== 1 ||
    !Number.isSafeInteger(row.engine_epoch) ||
    row.engine_epoch < 2 ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    row.state_world !== worldId ||
    row.state_actor !== actorId
  )
    fail('INVALID_OWN_AGENDA_BUDGET_SCOPE');
  return row;
}
async function readCounters(sql: SqlClient, owner: string, definitions: Bucket[]) {
  return (
    await sql.query<CounterRow>(
      'SELECT bucket,window_start,count FROM parallel_life.rate_limits WHERE owner_id=$1 AND bucket=ANY($2::text[])',
      [owner, definitions.map((b) => b.key)],
    )
  ).rows;
}

/** Read-only; realNow must be sampled by trusted server code, not from a player clock. */
export async function readOwnAgendaBudgetInTransaction(
  sql: SqlClient,
  owner: string,
  worldId: string,
  actorId: string,
  policy: OwnAgendaBudgetPolicy,
  realNow: string,
): Promise<OwnAgendaBudgetSnapshot> {
  await requireScope(sql, owner, worldId, actorId);
  const definitions = buckets(worldId, actorId, policy, realNow);
  return project(definitions, await readCounters(sql, owner, definitions));
}

/**
 * Caller authenticates the exact current token/holder and calls ONCE inside the ORIGINAL
 * reserved -> request_sent transaction. This helper never changes attempts or sends a model.
 * An actual non-reserved/sent/raw attempt is rejected before any counter write. A successful
 * return alone is NOT an idempotent send permit; commit the original send transition in this TX.
 */
export async function reserveOwnAgendaBudgetInTransaction(
  sql: SqlClient,
  owner: string,
  worldId: string,
  actorId: string,
  policy: OwnAgendaBudgetPolicy,
  realNow: string,
  attemptId: string,
): Promise<OwnAgendaBudgetReservation> {
  const frame = await requireScope(sql, owner, worldId, actorId, true);
  const definitions = buckets(worldId, actorId, policy, realNow);
  if (!key(attemptId)) fail('OWN_AGENDA_BUDGET_ATTEMPT_NOT_RESERVED');
  const attempt = (
    await sql.query(
      `SELECT status,sent_at IS NOT NULL sent,response IS NOT NULL has_response,
    response_hash IS NOT NULL has_response_hash,event_id IS NOT NULL has_event,
    engine_epoch,expected_world_version,expected_actor_revision,lease_until>clock_timestamp() live
    FROM parallel_life.agent_attempts WHERE id=$1 AND owner_id=$2 AND world_id=$3 AND actor_id=$4 FOR UPDATE`,
      [attemptId, owner, worldId, actorId],
    )
  ).rows[0];
  if (
    !attempt ||
    attempt.status !== 'reserved' ||
    !attempt.live ||
    attempt.sent ||
    attempt.has_response ||
    attempt.has_response_hash ||
    attempt.has_event ||
    attempt.engine_epoch !== frame.engine_epoch ||
    attempt.expected_world_version !== frame.version ||
    attempt.expected_actor_revision !== frame.revision
  )
    fail('OWN_AGENDA_BUDGET_ATTEMPT_NOT_RESERVED');
  await sql.query(`SAVEPOINT ${savepoint}`);
  const updated: CounterRow[] = [];
  let failed: OwnAgendaBudgetDimension | null = null;
  let success: OwnAgendaBudgetSnapshot | null = null;
  try {
    for (const b of definitions) {
      const result = await sql.query<CounterRow>(
        `INSERT INTO parallel_life.rate_limits(owner_id,bucket,window_start,count)
        VALUES($1,$2,$3::timestamptz,1)
        ON CONFLICT(owner_id,bucket) DO UPDATE SET
          count=CASE WHEN rate_limits.window_start<EXCLUDED.window_start THEN 1 ELSE rate_limits.count+1 END,
          window_start=GREATEST(rate_limits.window_start,EXCLUDED.window_start)
        WHERE rate_limits.window_start<EXCLUDED.window_start OR rate_limits.count<$4
        RETURNING bucket,window_start,count`,
        [owner, b.key, b.windowStart, b.limit],
      );
      if (result.rowCount !== 1) {
        failed = b.dimension;
        break;
      }
      updated.push(result.rows[0]!);
    }
    if (failed) await sql.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    else success = project(definitions, updated);
    await sql.query(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    try {
      await sql.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await sql.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'OWN_AGENDA_BUDGET_ROLLBACK_FAILED', {
        cause: error,
      });
    }
    throw error;
  }
  if (!failed) return { status: 'reserved', attemptId, budgets: success! };
  const budgets = project(definitions, await readCounters(sql, owner, definitions));
  const exhausted = dimensions.filter((d) => budgets[d].remaining === 0);
  if (!exhausted.includes(failed)) exhausted.push(failed);
  return {
    status: 'budget_wait',
    code: 'OWN_AGENDA_BUDGET_WAIT',
    exhausted,
    nextCheckRealAt: new Date(
      Math.max(...exhausted.map((d) => Date.parse(budgets[d].nextWindowRealAt))),
    ).toISOString(),
    budgets,
  };
}
