import 'server-only';
import { PostgresGroupRepository } from '../modules/world/infrastructure/group-repository.ts';
import { getServices } from './services.ts';
import { PostgresTaskQueue } from '../modules/tasks/infrastructure/postgres-task-queue.ts';
import { groupTaskHandler } from '../modules/world/infrastructure/group-task-handler.ts';
import { WorldGroupPlanner } from '../modules/world/infrastructure/group-planner.ts';
import { runOne } from '../modules/tasks/application/run-worker.ts';
import { DomainError } from '../modules/world/domain/errors.ts';
import { createTextModel } from './composition.ts';
import { gatewayConfig } from './config.ts';
/** New, group-only composition; shared services/worker dispatcher remain with the integrator. */
export function getGroupServices() {
  return new PostgresGroupRepository(getServices().db);
}
/** Explicit HTTP execution reuses the existing queue/lease runner; no work after response. */
export async function runGroupOwnedTask(
  ownerId: string,
  worldId: string,
  groupId: string,
  taskId: string,
) {
  const s = getServices();
  const task = await s.db.transaction(ownerId, async (sql) => {
    const row = (
      await sql.query(
        'SELECT scope_kind,scope_id,input,status FROM parallel_life.tasks WHERE id=$1',
        [taskId],
      )
    ).rows[0];
    if (
      !row ||
      row.scope_kind !== 'world' ||
      row.scope_id !== worldId ||
      row.input?.channel !== 'group' ||
      row.input?.groupId !== groupId
    )
      throw new DomainError('NOT_FOUND');
    return row;
  });
  if (!['queued', 'running'].includes(task.status)) return;
  const url = process.env.WORKER_DATABASE_URL;
  if (!url || new URL(url).username.split('.')[0] !== 'pl_worker')
    throw Error('WORKER_NOT_CONFIGURED');
  const queue = new PostgresTaskQueue(url),
    config = gatewayConfig();
  try {
    await runOne(
      {
        claim: (kinds) => queue.claimForOwner(taskId, ownerId, kinds),
        renew: (lease) => queue.renew(lease),
        finish: (lease, outcome) => queue.finish(lease, outcome),
      },
      { world: groupTaskHandler(queue, new WorldGroupPlanner(createTextModel()), config.model) },
      AbortSignal.timeout(110000),
    );
  } finally {
    await queue.close();
  }
}
