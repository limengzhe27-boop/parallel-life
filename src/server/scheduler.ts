import 'server-only';
import { PostgresSchedulerRepository } from '../modules/world/infrastructure/scheduler-repository.ts';
import { runDailyScheduler } from '../modules/world/application/run-daily-scheduler.ts';
import { getServices } from './services.ts';

let source: PostgresSchedulerRepository | undefined;
export async function runScheduledWorlds() {
  const url = process.env.SCHEDULER_DATABASE_URL;
  if (!url) throw Error('SCHEDULER_NOT_CONFIGURED');
  source ??= new PostgresSchedulerRepository(url);
  const services = getServices();
  return runDailyScheduler(source, (ownerId, worldId) =>
    services.advanceWorld(ownerId, worldId, 1, true),
  );
}
