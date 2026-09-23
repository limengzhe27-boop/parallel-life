import { z } from 'zod';
import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import { deriveMemory } from '../application/derive-memory.ts';
import { correctMemory, forgetMemory } from '../application/edit-memory.ts';
import {
  MemoryKindSchema,
  MemoryRecordSchema,
  MemoryScopeSchema,
  MemorySourceTypeSchema,
  type MemoryRecord,
} from '../../../contracts/memory.ts';

const MemoryTaskInputSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('derive'),
    scopeType: MemoryScopeSchema,
    scopeId: z.string(),
    branchId: z.string().optional(),
    characterId: z.string().optional(),
    text: z.string(),
    key: z.string().optional(),
    kind: MemoryKindSchema,
    sourceType: MemorySourceTypeSchema,
    sourceIds: z.array(z.string()),
    importance: z.number().optional(),
    evidence: z.record(
      z.string(),
      z.strictObject({
        id: z.string(),
        role: z.enum(['user', 'assistant']).optional(),
        requestId: z.string().optional(),
        text: z.string(),
      }),
    ),
  }),
  z.strictObject({
    action: z.literal('correct'),
    key: z.string(),
    newText: z.string(),
    scopeType: MemoryScopeSchema,
    scopeId: z.string(),
    branchId: z.string().optional(),
    characterId: z.string().optional(),
    sourceMessageIds: z.array(z.string()),
  }),
  z.strictObject({
    action: z.literal('forget'),
    targetMemoryId: z.string(),
    evidence: z.record(
      z.string(),
      z.strictObject({
        id: z.string(),
        role: z.enum(['user', 'assistant']).optional(),
        requestId: z.string().optional(),
        text: z.string(),
      }),
    ),
  }),
]);

export function memoryHandler(queue: PostgresTaskQueue) {
  return async (lease: TaskLease, signal: AbortSignal) => {
    const started = Date.now();
    try {
      if (signal.aborted) {
        await queue.finish(lease, {
          status: 'unknown',
          errorCode: 'TIMEOUT',
          durationMs: Date.now() - started,
        });
        return;
      }

      const input = MemoryTaskInputSchema.parse(lease.input);

      if (input.action === 'derive') {
        const derived = deriveMemory({
          ownerId: lease.ownerId,
          ...input,
        });

        await queue.commit(lease, async (sql) => {
          await sql.query(
            `INSERT INTO parallel_life.memory_records
              (id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status,importance,created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              derived.id,
              derived.ownerId,
              derived.scopeType,
              derived.scopeId,
              derived.branchId ?? null,
              derived.characterId ?? null,
              derived.kind,
              derived.text,
              derived.key ?? null,
              derived.sourceType,
              JSON.stringify(derived.sourceIds),
              derived.status,
              derived.importance,
              derived.createdAt,
            ],
          );
          for (const sId of derived.sourceIds) {
            await sql.query(
              `INSERT INTO parallel_life.memory_source_refs(memory_id,owner_id,source_type,source_id)
               VALUES($1,$2,'world_message',$3) ON CONFLICT DO NOTHING`,
              [derived.id, derived.ownerId, sId],
            );
          }
          return {
            value: undefined,
            outcome: {
              status: 'succeeded',
              durationMs: Date.now() - started,
            },
          };
        });
      } else if (input.action === 'correct') {
        await queue.commit(lease, async (sql) => {
          const rows = (
            await sql.query(
              'SELECT * FROM parallel_life.memory_records WHERE owner_id=$1 FOR UPDATE',
              [lease.ownerId],
            )
          ).rows;
          const existingRecords = rows.map((r) =>
            MemoryRecordSchema.parse({
              id: r.id,
              ownerId: r.owner_id,
              scopeType: r.scope_type,
              scopeId: r.scope_id,
              branchId: r.branch_id ?? undefined,
              characterId: r.character_id ?? undefined,
              kind: r.kind,
              text: r.text,
              key: r.key ?? undefined,
              sourceType: r.source_type,
              sourceIds: Array.isArray(r.source_ids) ? r.source_ids : [],
              status: r.status,
              importance: Number(r.importance),
              createdAt: new Date(String(r.created_at)).toISOString(),
            }),
          );

          const { newRecord, supersededRecords } = correctMemory({
            ownerId: lease.ownerId,
            key: input.key,
            newText: input.newText,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            branchId: input.branchId,
            characterId: input.characterId,
            sourceMessageIds: input.sourceMessageIds,
            existingRecords,
          });

          for (const superseded of supersededRecords) {
            await sql.query(
              "UPDATE parallel_life.memory_records SET status='superseded' WHERE owner_id=$1 AND id=$2",
              [lease.ownerId, superseded.id],
            );
          }

          await sql.query(
            `INSERT INTO parallel_life.memory_records
              (id,owner_id,scope_type,scope_id,branch_id,character_id,kind,text,key,source_type,source_ids,status,importance,created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              newRecord.id,
              newRecord.ownerId,
              newRecord.scopeType,
              newRecord.scopeId,
              newRecord.branchId ?? null,
              newRecord.characterId ?? null,
              newRecord.kind,
              newRecord.text,
              newRecord.key ?? null,
              newRecord.sourceType,
              JSON.stringify(newRecord.sourceIds),
              newRecord.status,
              newRecord.importance,
              newRecord.createdAt,
            ],
          );

          return {
            value: undefined,
            outcome: {
              status: 'succeeded',
              durationMs: Date.now() - started,
            },
          };
        });
      } else if (input.action === 'forget') {
        await queue.commit(lease, async (sql) => {
          const rows = (
            await sql.query(
              'SELECT * FROM parallel_life.memory_records WHERE owner_id=$1 FOR UPDATE',
              [lease.ownerId],
            )
          ).rows;
          const existingRecords = rows.map((r) =>
            MemoryRecordSchema.parse({
              id: r.id,
              ownerId: r.owner_id,
              scopeType: r.scope_type,
              scopeId: r.scope_id,
              branchId: r.branch_id ?? undefined,
              characterId: r.character_id ?? undefined,
              kind: r.kind,
              text: r.text,
              key: r.key ?? undefined,
              sourceType: r.source_type,
              sourceIds: Array.isArray(r.source_ids) ? r.source_ids : [],
              status: r.status,
              importance: Number(r.importance),
              createdAt: new Date(String(r.created_at)).toISOString(),
            }),
          );

          const { forgottenRecord } = forgetMemory({
            ownerId: lease.ownerId,
            targetMemoryId: input.targetMemoryId,
            existingRecords,
            evidence: input.evidence,
          });

          await sql.query(
            "UPDATE parallel_life.memory_records SET status='forgotten' WHERE owner_id=$1 AND id=$2",
            [lease.ownerId, forgottenRecord.id],
          );

          return {
            value: undefined,
            outcome: {
              status: 'succeeded',
              durationMs: Date.now() - started,
            },
          };
        });
      }
    } catch (err: unknown) {
      if (signal.aborted) {
        await queue.finish(lease, {
          status: 'unknown',
          errorCode: 'TIMEOUT',
          durationMs: Date.now() - started,
        });
      } else {
        await queue.finish(lease, {
          status: 'failed',
          errorCode: err instanceof Error ? err.name : 'MEMORY_TASK_FAILED',
          durationMs: Date.now() - started,
        });
      }
    }
  };
}
