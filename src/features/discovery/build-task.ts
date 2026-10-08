import type { LifeClient } from '../api/client.ts';
/** An explicit retry creates a replacement task; the failed task is immutable. */
export async function retryBuildTask(
  client: Pick<LifeClient, 'retryTask' | 'task'>,
  taskId: string,
  commandId: string,
  onQueued: () => Promise<void>,
) {
  const replacement = await client.retryTask(taskId, commandId);
  await onQueued();
  if (replacement.status === 'queued' || replacement.status === 'running')
    return client.task(replacement.id);
  return replacement;
}
