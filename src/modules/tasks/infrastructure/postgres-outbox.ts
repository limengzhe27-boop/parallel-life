import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { OutboxPort, OutboxTaskPort } from '../application/dispatch-outbox.ts';
import { OUTBOX_EXECUTORS, type OutboxJob, type OutboxPayload } from '../domain/outbox.ts';
import { enqueue, TaskError } from './task-repository.ts';

/** Persisted payload shape; parsed at the storage boundary, never trusted raw. */
const OutboxPayloadSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  worldId: z.string(),
  type: z.string(),
  requestId: z.string().optional(),
  prompt: z.string().optional(),
});
const LEASE_SECONDS = 60;
const MAX_BATCH = 20;
/** Bounded attempts: a job that keeps failing must not be retried forever. */
export const MAX_OUTBOX_ATTEMPTS = 5;

/** Deterministic uuid from an outbox job id, so the task is idempotent across restarts. */
export function taskCommandId(jobId: string): string {
  const hex = createHash('sha256').update(`outbox:${jobId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function outboxRequestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
function toJob(row: Record<string, unknown>): OutboxJob {
  const payload: OutboxPayload = OutboxPayloadSchema.parse(row.payload);
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    worldId: String(row.world_id),
    eventId: String(row.event_id),
    status: String(row.status),
    attempts: Number(row.attempts ?? 0),
    payload,
  };
}

/**
 * Owner-scoped outbox consumer. Dispatch runs as the application role because the
 * worker deliberately has no INSERT right on the task queue.
 */
export class PostgresOutbox {
  private db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  ports(ownerId: string): { outbox: OutboxPort; tasks: OutboxTaskPort } {
    return {
      outbox: {
        claim: async (limit) =>
          this.db.transaction(ownerId, async (sql) =>
            (
              await sql.query('SELECT * FROM parallel_life.claim_outbox_jobs($1,$2,$3)', [
                ownerId,
                Math.min(limit, MAX_BATCH),
                LEASE_SECONDS,
              ])
            ).rows.map(toJob),
          ),
        submitted: async (job, taskId) => {
          await this.db.transaction(ownerId, (sql) =>
            sql.query("SELECT parallel_life.finish_outbox_job($1,'submitted',NULL,$2)", [
              job.id,
              taskId,
            ]),
          );
        },
        requeued: async (job, reason) => {
          await this.db.transaction(ownerId, (sql) =>
            sql.query("SELECT parallel_life.finish_outbox_job($1,'queued',$2,NULL)", [
              job.id,
              reason,
            ]),
          );
        },
        rejected: async (job, reason) => {
          await this.db.transaction(ownerId, (sql) =>
            sql.query("SELECT parallel_life.finish_outbox_job($1,'failed',$2,NULL)", [
              job.id,
              reason,
            ]),
          );
        },
      },
      tasks: {
        submit: async (job) => {
          const executor = OUTBOX_EXECUTORS[job.payload.type];
          if (!executor) throw new TaskError('NO_EXECUTOR');
          const scopeId = executor.scopeOf(job.payload);
          const input = { assetRequestId: scopeId, prompt: job.payload.prompt ?? '' };
          try {
            const task = await this.db.transaction(ownerId, (sql) =>
              enqueue(
                sql,
                ownerId,
                executor.kind,
                scopeId,
                taskCommandId(job.id),
                input,
                outboxRequestHash(job.payload),
              ),
            );
            return { taskId: task.id, duplicate: task.status !== 'queued' };
          } catch (error) {
            /*
             * An active task already exists for this media request: the work is
             * already queued, so the job is dispatched rather than failed.
             */
            if ((error as { code?: string }).code === 'BUSY') {
              const existing = await this.db.transaction(
                ownerId,
                async (sql) =>
                  (
                    await sql.query(
                      "SELECT id FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind=$2 AND scope_id=$3 AND status IN ('queued','running')",
                      [ownerId, executor.kind, scopeId],
                    )
                  ).rows[0],
              );
              if (existing) return { taskId: String(existing.id), duplicate: true };
            }
            throw error;
          }
        },
      },
    };
  }
}
