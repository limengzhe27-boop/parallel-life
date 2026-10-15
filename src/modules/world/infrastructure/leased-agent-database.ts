import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { TaskLease } from '../../tasks/domain/types.ts';
import { LeaseLost } from '../../tasks/infrastructure/postgres-task-queue.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key = /^[a-zA-Z0-9_:-]{1,160}$/;

/** Capture actual JSON, without silently dropping JS-only values or invoking toJSON. */
function jsonInput(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || !value || ancestors.has(value)) throw new LeaseLost();
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    throw new LeaseLost();
  if (Object.getOwnPropertySymbols(value).length) throw new LeaseLost();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new LeaseLost();
      return Array.from(value, (item) => jsonInput(item, ancestors));
    }
    return Object.fromEntries(
      Object.keys(value).map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
        if (!('value' in descriptor)) throw new LeaseLost();
        return [name, jsonInput(descriptor.value, ancestors)];
      }),
    );
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Trusted modular-monolith adapter, NOT a SQL sandbox or worker-role grant.
 * The server must supply its existing pl_app database and an actually claimed
 * task lease. Every store/kernel transaction must use this facade's transaction;
 * the exposed shared pool is retained for type compatibility, not authorization.
 * Never retain a transaction across a model/network call.
 *
 * Task success inside the callback is allowed only as an integration hook. This
 * adapter proves lease continuity, not NPC business success: the kernel finalizer
 * must verify its committed AgentAttempt/native input/event/command/resultVersion
 * in this same SQL transaction before marking the parent task succeeded.
 */
export function withLeasedAgentDatabase(db: PostgresDatabase, lease: TaskLease): PostgresDatabase {
  if (
    !lease ||
    typeof lease !== 'object' ||
    typeof lease.id !== 'string' ||
    !uuid.test(lease.id) ||
    typeof lease.token !== 'string' ||
    !uuid.test(lease.token) ||
    typeof lease.ownerId !== 'string' ||
    !key.test(lease.ownerId) ||
    typeof lease.scopeId !== 'string' ||
    !key.test(lease.scopeId) ||
    lease.kind !== 'world'
  )
    throw new LeaseLost();
  const captured = {
    id: lease.id,
    ownerId: lease.ownerId,
    scopeId: lease.scopeId,
    token: lease.token,
    input: JSON.stringify(jsonInput(lease.input)),
  };
  // Match the existing task input capacity; never log the captured private input.
  if (Buffer.byteLength(captured.input, 'utf8') >= 131072) throw new LeaseLost();

  async function checkIdentity(sql: SqlClient) {
    const row = (
      await sql.query(`SELECT current_setting('app.user_id',true) AS owner_id,
      pg_has_role(current_user,'pl_app','MEMBER') AS app,
      pg_has_role(current_user,'pl_worker','MEMBER') AS worker`)
    ).rows[0];
    if (!row?.app || row.worker || row.owner_id !== captured.ownerId) throw new LeaseLost();
  }
  async function checkTask(sql: SqlClient, after = false) {
    const row = (
      await sql.query(
        `SELECT id FROM parallel_life.tasks
      WHERE id=$1 AND owner_id=$2 AND scope_kind='world' AND scope_id=$3
        AND lease_token=$4 AND input=$5::jsonb
        AND status=ANY($6::text[]) AND lease_until>clock_timestamp() FOR UPDATE`,
        [
          captured.id,
          captured.ownerId,
          captured.scopeId,
          captured.token,
          captured.input,
          after ? ['running', 'succeeded'] : ['running'],
        ],
      )
    ).rows[0];
    if (!row) throw new LeaseLost();
  }

  return Object.freeze({
    pool: db.pool,
    async transaction<T>(ownerId: string, run: (sql: SqlClient) => Promise<T>): Promise<T> {
      if (ownerId !== captured.ownerId) throw new LeaseLost();
      return db.transaction(ownerId, async (sql) => {
        await checkIdentity(sql);
        // Serialize the same lease before locking its world. Both locks are
        // UPDATE from the start, so a terminal callback never upgrades a SHARE
        // lock held by another transaction waiting on this world.
        await checkTask(sql);
        const world = (
          await sql.query(
            `SELECT id FROM parallel_life.worlds
          WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
            [captured.scopeId, ownerId],
          )
        ).rows[0];
        if (!world) throw new LeaseLost();
        const control = (
          await sql.query(
            `SELECT engine_epoch FROM parallel_life.agent_runtime_worlds
          WHERE world_id=$1 AND owner_id=$2 FOR SHARE`,
            [captured.scopeId, ownerId],
          )
        ).rows[0];
        const epoch = Number(control?.engine_epoch);
        if (!Number.isSafeInteger(epoch) || epoch < 2) throw new LeaseLost();
        const result = await run(sql);
        // A lease that expires during even a short callback cannot commit writes.
        await checkIdentity(sql);
        await checkTask(sql, true);
        const current = (
          await sql.query(
            `SELECT engine_epoch FROM parallel_life.agent_runtime_worlds
          WHERE world_id=$1 AND owner_id=$2`,
            [captured.scopeId, ownerId],
          )
        ).rows[0];
        if (Number(current?.engine_epoch) !== epoch) throw new LeaseLost();
        return result;
      });
    },
    // This facade borrows the original pool; only its owner controls shutdown.
    async close(): Promise<void> {},
  });
}
