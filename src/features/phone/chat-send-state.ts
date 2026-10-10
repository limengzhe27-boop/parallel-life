import { z } from 'zod';
import { Id } from '../../contracts/api.ts';
import type { PhoneMessage } from './apps/types.ts';
import type { Operation } from './apps/provider.tsx';
import type { GroupTask } from './groups/client.ts';
import { mayRetry } from './groups/state.ts';

/** A transport failure does not prove that the server rejected the command. */
export function sendFailureStatus(error: unknown): 'failed' | 'unknown' {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return [
    'INVALID_INPUT',
    'INVALID_COMMAND',
    'NOT_FOUND',
    'FORBIDDEN',
    'UNAUTHORIZED',
    'VERSION_CONFLICT',
    'IDEMPOTENCY_CONFLICT',
    'RATE_LIMITED',
    'BUSY',
    'INVALID_STATE',
  ].includes(String(code))
    ? 'failed'
    : 'unknown';
}

export function hasLocalSendFailure(
  operation: Operation | undefined,
  messages: readonly PhoneMessage[],
  operations: Record<string, Operation> = {},
) {
  if (!operation?.error || !operation.commandId) return false;
  let commandId: string | undefined = operation.commandId;
  const seen = new Set<string>();
  while (commandId && !seen.has(commandId)) {
    seen.add(commandId);
    if (
      messages.some(
        (m) =>
          m.role === 'user' &&
          m.id === commandId &&
          (m.status === 'failed' || m.status === 'unknown' || m.status === 'pending'),
      )
    )
      return true;
    const retry: Operation | undefined = operations[`retry:${commandId}`];
    if (retry?.status === 'committed') return true;
    commandId = retry?.commandId;
  }
  return false;
}

const RecoveryMessage = z.strictObject({
  id: Id,
  actorId: Id,
  role: z.literal('user'),
  text: z.string().min(1).max(4000),
  at: z.iso.datetime(),
  status: z.enum(['pending', 'failed', 'unknown']),
});
export const SendCommandSchema = z.strictObject({
  worldId: Id,
  commandId: Id,
  actorId: Id,
  text: z.string().trim().min(1).max(4000),
  expectedVersion: z.number().int().nonnegative(),
});
export type SendCommand = z.infer<typeof SendCommandSchema>;
const Recovery = z.strictObject({
  worldId: Id,
  messages: z.array(RecoveryMessage).max(100),
  commands: z.array(SendCommandSchema).max(100).default([]),
});
/** Browser reconciliation data only; never a repository or evidence of a commit. */
export function restoreSendMessages(raw: string | null, worldId: string): PhoneMessage[] {
  try {
    const result = Recovery.safeParse(raw ? JSON.parse(raw) : undefined);
    return result.success && result.data.worldId === worldId
      ? result.data.messages.map((message) => ({
          ...message,
          status: message.status === 'pending' ? 'unknown' : message.status,
        }))
      : [];
  } catch {
    return [];
  }
}
export function restoreSendCommands(
  raw: string | null,
  worldId: string,
): Record<string, SendCommand> {
  try {
    const result = Recovery.safeParse(raw ? JSON.parse(raw) : undefined);
    if (!result.success || result.data.worldId !== worldId) return {};
    return Object.fromEntries(
      result.data.commands
        .filter(
          (c) =>
            c.worldId === worldId &&
            result.data.messages.some(
              (m) => m.id === c.commandId && m.actorId === c.actorId && m.text === c.text,
            ),
        )
        .map((c) => [c.commandId, c]),
    );
  } catch {
    return {};
  }
}
export function storeSendMessages(
  worldId: string,
  messages: readonly PhoneMessage[],
  commands: Record<string, SendCommand> = {},
): string {
  return JSON.stringify({
    worldId,
    commands: messages.flatMap((m) => (commands[m.id] ? [commands[m.id]] : [])).slice(-100),
    messages: messages
      .filter((m) => m.role === 'user' && m.status !== 'sent')
      .slice(-100)
      .map(({ id, actorId, role, text, at, status }) => ({ id, actorId, role, text, at, status })),
  });
}

/** Re-read before a user-authorized retry; stale UNKNOWN must never create another task. */
export async function retryLatestGroupTask(
  taskId: string,
  read: (id: string) => Promise<GroupTask>,
  retry: (id: string, commandId: string) => Promise<GroupTask>,
  commandId: () => string,
) {
  const latest = await read(taskId);
  if (latest.id !== taskId) throw new Error('回复状态来源不一致，请刷新核对。');
  if (!mayRetry(latest)) return { task: latest, retried: false };
  return { task: await retry(taskId, commandId()), retried: true };
}
