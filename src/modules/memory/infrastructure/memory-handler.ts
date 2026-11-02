import type { TextModel } from '../../ai/application/ports.ts';
import { summarizeConversation } from './conversation-summary.ts';
import { z } from 'zod';
import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import {
  deriveAndStoreMemories,
  correctMemoryInStore,
  forgetMemoryInStore,
} from './memory-store.ts';
import {
  MemoryKindSchema,
  MemoryScopeSchema,
  MemorySourceTypeSchema,
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

export function memoryHandler(queue: PostgresTaskQueue, model?: () => TextModel) {
  return async (lease: TaskLease, signal: AbortSignal) => {
    if ((lease.input as { action?: string })?.action === 'summarize') {
      if (!model) throw Error('SUMMARY_MODEL_UNAVAILABLE');
      return summarizeConversation(queue, lease, signal, model);
    }
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

      await queue.commit(lease, async (sql) => {
        if (input.action === 'derive') {
          await deriveAndStoreMemories(sql, [{ ownerId: lease.ownerId, ...input }]);
        } else if (input.action === 'correct') {
          await correctMemoryInStore(sql, {
            ownerId: lease.ownerId,
            ...input,
            playerVisibleOnly: false,
          });
        } else {
          await forgetMemoryInStore(sql, {
            ownerId: lease.ownerId,
            ...input,
            playerVisibleOnly: false,
          });
        }
        return {
          value: undefined,
          outcome: { status: 'succeeded', durationMs: Date.now() - started },
        };
      });
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
