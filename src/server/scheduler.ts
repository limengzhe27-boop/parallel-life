import 'server-only';
import { PostgresSchedulerRepository } from '../modules/world/infrastructure/scheduler-repository.ts';
import { runDailyScheduler } from '../modules/world/application/run-daily-scheduler.ts';
import {
  runProactiveScheduler,
  type ProactiveTickPolicy,
  type ProactiveClaimTiming,
} from '../modules/world/application/run-proactive-scheduler.ts';
import { getServices } from './services.ts';

let source: PostgresSchedulerRepository | undefined;
export async function runProactiveWorlds(
  options: {
    tick?: Partial<ProactiveTickPolicy>;
    claim?: Partial<ProactiveClaimTiming>;
  } = {},
) {
  const services = getServices();
  // Qualification and leases are atomic in claim_proactive_worlds. Ineligible worlds
  // are never claimed and cannot consume cooldown or appear in the advanced count.
  return runProactiveScheduler(
    { claimProactive: (maxWorlds) => services.claimProactiveWorlds(maxWorlds, options.claim) },
    (ownerId, worldId) => services.advanceProactiveWorld(ownerId, worldId),
    options.tick,
  );
}

export async function runScheduledWorlds() {
  const url = process.env.SCHEDULER_DATABASE_URL;
  if (!url) throw Error('SCHEDULER_NOT_CONFIGURED');
  source ??= new PostgresSchedulerRepository(url);
  const services = getServices();
  return runDailyScheduler(source, (ownerId, worldId) =>
    services.advanceWorld(ownerId, worldId, 1, true),
  );
}
