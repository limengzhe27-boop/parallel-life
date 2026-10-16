import { createHash } from 'node:crypto';
import { detectPublisherPreparationScope } from '../domain/publication-preparation-scope.ts';
import { Id } from '../../../contracts/api.ts';
import {
  PublisherPreparationInputSchema,
  PublisherPreparationOutputSchema,
  PublisherPreparationRecordSchema,
  type PublisherPreparationInput,
  type PublisherPreparationRecord,
} from '../../../contracts/publisher-preparation.ts';
import type { PublisherPreparationStore } from '../application/publisher-preparation.ts';
import type { PostgresDatabase, SqlClient } from '../../storage/infrastructure/postgres.ts';
import { TaskError } from '../../tasks/infrastructure/task-repository.ts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
function record(row: Record<string, any>): PublisherPreparationRecord {
  return PublisherPreparationRecordSchema.parse({
    commandId: row.command_id,
    workId: row.work_id,
    draftVersion: Number(row.draft_version),
    material: row.material,
    status: row.status,
    result: row.result,
    errorCode: row.error_code,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}
export class PublisherPreparationRepository implements PublisherPreparationStore {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  private async tx<T>(principal: string, run: (sql: SqlClient) => Promise<T>): Promise<T> {
    if (!Id.safeParse(principal).success) throw new TaskError('INVALID_INPUT');
    try {
      return await this.db.transaction(principal, async (sql) => {
        await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [principal]);
        await sql.query("SELECT parallel_life.publisher_lock_permission('edit')");
        return run(sql);
      });
    } catch (e) {
      if (e instanceof TaskError) throw e;
      throw new TaskError((e as { code?: string })?.code === '42501' ? 'FORBIDDEN' : 'UNAVAILABLE');
    }
  }
  private expire(sql: SqlClient, principal: string) {
    return sql.query(
      "UPDATE parallel_life.publisher_preparations SET status='unknown',error_code='TIMEOUT',updated_at=now() WHERE principal_id=$1 AND status='running' AND created_at<now()-interval '3 minutes'",
      [principal],
    );
  }
  async begin(principal: string, workId: string, raw: PublisherPreparationInput) {
    const parsed = PublisherPreparationInputSchema.safeParse(raw);
    if (!parsed.success || !Id.safeParse(workId).success) throw new TaskError('INVALID_INPUT');
    const input = parsed.data;
    const hash = createHash('sha256')
      .update(JSON.stringify(canonical({ workId, ...input })))
      .digest('hex');
    const material = {
      currentContent: input.currentContent,
      sources: input.sources,
      scope: input.scope ?? detectPublisherPreparationScope(input.sources).scope,
      ...(input.socialFocus ? { socialFocus: input.socialFocus } : {}),
      ...(input.socialActorKey ? { socialActorKey: input.socialActorKey } : {}),
    };
    return this.tx(principal, async (sql) => {
      // Serialize admission and per-principal cost limits across every server instance.
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('publisher-preparation:' || $1,0))",
        [principal],
      );
      await this.expire(sql, principal);
      const existing = (
        await sql.query(
          'SELECT * FROM parallel_life.publisher_preparations WHERE principal_id=$1 AND command_id=$2',
          [principal, input.commandId],
        )
      ).rows[0];
      if (existing) {
        if (existing.request_hash !== hash) throw new TaskError('IDEMPOTENCY_CONFLICT');
        return { record: record(existing), claimed: false };
      }
      const work = (
        await sql.query(
          'SELECT draft_version FROM parallel_life.publication_works WHERE id=$1 FOR SHARE',
          [workId],
        )
      ).rows[0];
      if (!work) throw new TaskError('NOT_FOUND');
      if (Number(work.draft_version) !== input.expectedDraftVersion)
        throw new TaskError('VERSION_CONFLICT');
      const counts = (
        await sql.query(
          "SELECT count(*) FILTER (WHERE status='running')::int active, count(*) FILTER (WHERE created_at>now()-interval '1 hour')::int recent FROM parallel_life.publisher_preparations WHERE principal_id=$1",
          [principal],
        )
      ).rows[0];
      if (counts.active > 0) throw new TaskError('INVALID_STATE');
      if (counts.recent >= 10) throw new TaskError('RATE_LIMITED');
      const row = (
        await sql.query(
          "INSERT INTO parallel_life.publisher_preparations(principal_id,command_id,work_id,draft_version,request_hash,material,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,'running') RETURNING *",
          [
            principal,
            input.commandId,
            workId,
            input.expectedDraftVersion,
            hash,
            JSON.stringify(material),
          ],
        )
      ).rows[0];
      return { record: record(row), claimed: true };
    });
  }
  async read(principal: string, workId: string, commandId?: string) {
    if (
      !Id.safeParse(workId).success ||
      (commandId !== undefined && !Id.safeParse(commandId).success)
    )
      throw new TaskError('INVALID_INPUT');
    return this.tx(principal, async (sql) => {
      await this.expire(sql, principal);
      const row = (
        await sql.query(
          'SELECT * FROM parallel_life.publisher_preparations WHERE principal_id=$1 AND work_id=$2' +
            (commandId ? ' AND command_id=$3' : '') +
            ' ORDER BY created_at DESC LIMIT 1',
          commandId ? [principal, workId, commandId] : [principal, workId],
        )
      ).rows[0];
      return row ? record(row) : null;
    });
  }
  async finish(
    principal: string,
    workId: string,
    commandId: string,
    outcome: Parameters<PublisherPreparationStore['finish']>[3],
  ) {
    if (!Id.safeParse(workId).success || !Id.safeParse(commandId).success)
      throw new TaskError('INVALID_INPUT');
    if (outcome.status === 'succeeded') PublisherPreparationOutputSchema.parse(outcome.result);
    return this.tx(principal, async (sql) => {
      const row = (
        await sql.query(
          'SELECT * FROM parallel_life.publisher_preparations WHERE principal_id=$1 AND work_id=$2 AND command_id=$3 FOR UPDATE',
          [principal, workId, commandId],
        )
      ).rows[0];
      if (!row) throw new TaskError('NOT_FOUND');
      if (row.status !== 'running') return record(row);
      const saved = (
        await sql.query(
          'UPDATE parallel_life.publisher_preparations SET status=$4,result=$5::jsonb,error_code=$6,updated_at=now() WHERE principal_id=$1 AND work_id=$2 AND command_id=$3 RETURNING *',
          [
            principal,
            workId,
            commandId,
            outcome.status,
            outcome.result ? JSON.stringify(outcome.result) : null,
            outcome.errorCode,
          ],
        )
      ).rows[0];
      return record(saved);
    });
  }
}
