import { z } from 'zod';
import { Id, Version } from '../../../contracts/api.ts';
import type { TaskLease } from '../../tasks/domain/types.ts';
import type { PostgresTaskQueue } from '../../tasks/infrastructure/postgres-task-queue.ts';
import type { GroupPlanner } from '../application/group-ports.ts';
import { planGroupTurn } from '../application/group-turn.ts';
import { loadGroupRead, persistGroupEvent, groupReplyEvent } from './group-repository.ts';
import { requestHash } from '../../tasks/infrastructure/task-repository.ts';
import { DomainError } from '../domain/errors.ts';
import { GROUP_PROMPT_VERSION } from './group-planner.ts';
const Input = z.strictObject({
  channel: z.literal('group'),
  worldId: Id,
  groupId: Id,
  expectedVersion: Version,
  inputEventId: Id,
  text: z.string().min(1).max(4000),
});
/** Register as the group branch of the existing world-scope worker dispatcher. */
export function groupTaskHandler(
  queue: PostgresTaskQueue,
  planner: GroupPlanner,
  model: string,
  options: { maxReplies?: number; now?: () => string } = {},
) {
  return async (lease: TaskLease, signal: AbortSignal) => {
    const started = Date.now();
    const input = Input.parse(lease.input);
    if (lease.kind !== 'world' || lease.scopeId !== input.worldId)
      throw new DomainError('INVALID_COMMAND');
    const now = options.now ?? (() => new Date().toISOString());
    const read = await queue.read(lease, async (sql) => {
      const read = await loadGroupRead(sql, input.worldId, input.groupId, now());
      if (read.world.ownerId !== lease.ownerId || read.world.version !== input.expectedVersion)
        throw new DomainError('VERSION_CONFLICT');
      if (
        (
          await sql.query('SELECT paused FROM parallel_life.world_clock WHERE world_id=$1', [
            input.worldId,
          ])
        ).rows[0]?.paused
      )
        throw new DomainError('INVALID_COMMAND', 'WORLD_PAUSED');
      const source = (
        await sql.query(
          'SELECT payload,version FROM parallel_life.world_events WHERE id=$1 AND world_id=$2',
          [input.inputEventId, input.worldId],
        )
      ).rows[0];
      if (
        !source ||
        source.version !== input.expectedVersion ||
        source.payload.type !== 'group.message_sent' ||
        source.payload.data.groupId !== input.groupId ||
        source.payload.data.text !== input.text
      )
        throw new DomainError('INVALID_COMMAND');
      return read;
    });
    const replies = await planGroupTurn(read, input.text, planner, signal, options.maxReplies ?? 1);
    await queue.commit(lease, async (sql) => {
      const current = await loadGroupRead(sql, input.worldId, input.groupId, now(), true);
      if (
        current.world.ownerId !== lease.ownerId ||
        current.world.version !== input.expectedVersion
      )
        throw new DomainError('VERSION_CONFLICT');
      if (
        (
          await sql.query('SELECT paused FROM parallel_life.world_clock WHERE world_id=$1', [
            input.worldId,
          ])
        ).rows[0]?.paused
      )
        throw new DomainError('INVALID_COMMAND', 'WORLD_PAUSED');
      const event = groupReplyEvent(
        lease.ownerId,
        current.world,
        lease.id,
        input.groupId,
        replies,
        now(),
      );
      const receipt = await persistGroupEvent(
        sql,
        current.world,
        event,
        requestHash(['group.reply', lease.id, input]),
      );
      return {
        value: receipt,
        outcome: {
          status: 'succeeded' as const,
          resultVersion: receipt.version,
          model,
          promptVersion: GROUP_PROMPT_VERSION,
          durationMs: Date.now() - started,
        },
      };
    });
  };
}
