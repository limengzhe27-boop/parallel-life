import { createHash } from 'node:crypto';

/** Queue recovery preserves the original task identity and therefore its child command. */
export function nativeAgentCommandId(taskId: string, actorId: string): string {
  const hex = createHash('sha256')
    .update(JSON.stringify(['npc-task', taskId, actorId]))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
