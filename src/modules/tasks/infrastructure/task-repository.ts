import { consumeLimit } from '../../storage/infrastructure/limits.ts';
import { randomUUID, createHash } from 'node:crypto';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskSchema, type Task } from '../../../contracts/api.ts';
export class TaskError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export function publicTask(row: Record<string, unknown>): Task {
  const key: Record<string, string> = {
    interview: 'interviewId',
    profile: 'profileId',
    'world-build': 'proposalId',
    world: 'worldId',
    media: 'assetRequestId',
  };
  return TaskSchema.parse({
    id: row.id,
    scope: { kind: row.scope_kind, [key[String(row.scope_kind)]!]: row.scope_id },
    status: row.status,
    errorCode: row.error_code ?? null,
    resultVersion: row.result_version ?? null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}
export const requestHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function enqueue(
  sql: SqlClient,
  ownerId: string,
  kind: string,
  scopeId: string,
  commandId: string,
  input: unknown,
  hash: string,
): Promise<Task> {
  const existing = (
    await sql.query('SELECT * FROM parallel_life.tasks WHERE owner_id=$1 AND command_id=$2', [
      ownerId,
      commandId,
    ])
  ).rows[0];
  if (existing) {
    if (existing.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
    return publicTask(existing);
  }
  if (
    (
      await sql.query(
        "SELECT 1 FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind=$2 AND scope_id=$3 AND status IN ('queued','running')",
        [ownerId, kind, scopeId],
      )
    ).rowCount
  )
    throw new TaskError('BUSY');
  await consumeLimit(sql, ownerId, 'generation-day', 120, 86400);
  const row = (
    await sql.query(
      'INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [randomUUID(), ownerId, kind, scopeId, commandId, hash, input],
    )
  ).rows[0];
  return publicTask(row);
}
export class TaskRepository {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async get(ownerId: string, id: string) {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (await sql.query('SELECT * FROM parallel_life.tasks WHERE id=$1', [id])).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      return publicTask(row);
    });
  }
  async cancel(ownerId: string, id: string) {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          "UPDATE parallel_life.tasks SET status='cancelled',error_code='CANCELLED',updated_at=now() WHERE id=$1 AND status IN ('queued','running') RETURNING *",
          [id],
        )
      ).rows[0];
      if (row) return publicTask(row);
      const saved = (await sql.query('SELECT * FROM parallel_life.tasks WHERE id=$1', [id]))
        .rows[0];
      if (!saved) throw new TaskError('NOT_FOUND');
      return publicTask(saved);
    });
  }
  async retry(ownerId: string, id: string, commandId: string) {
    return this.db.transaction(ownerId, async (sql) => {
      await sql.query('SELECT id FROM parallel_life.accounts WHERE id=$1 FOR UPDATE', [ownerId]);
      const old = (await sql.query('SELECT * FROM parallel_life.tasks WHERE id=$1', [id])).rows[0];
      if (!old) throw new TaskError('NOT_FOUND');
      const hash = requestHash(['retry', id]);
      const existing = (
        await sql.query('SELECT * FROM parallel_life.tasks WHERE owner_id=$1 AND command_id=$2', [
          ownerId,
          commandId,
        ])
      ).rows[0];
      if (existing) {
        if (existing.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
        return publicTask(existing);
      }
      if (!['failed', 'unknown', 'cancelled'].includes(old.status))
        throw new TaskError('VERSION_CONFLICT');
      const newest = (
        await sql.query(
          'SELECT id FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind=$2 AND scope_id=$3 ORDER BY created_at DESC LIMIT 1',
          [ownerId, old.scope_kind, old.scope_id],
        )
      ).rows[0];
      if (newest?.id !== id) throw new TaskError('VERSION_CONFLICT');
      const task = await enqueue(
        sql,
        ownerId,
        old.scope_kind,
        old.scope_id,
        commandId,
        old.input,
        hash,
      );
      if (old.scope_kind === 'interview')
        await sql.query(
          "UPDATE parallel_life.interview_messages SET task_id=$2 WHERE task_id=$1 AND role='user'",
          [id, task.id],
        );
      return task;
    });
  }
}
