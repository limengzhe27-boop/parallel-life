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
    /** Explicit local backup: never adopt/resume presence-only or paused worlds. */
    continuousOnly?: boolean;
  } = {},
) {
  const services = getServices();
  const clocks = new Map<string, { allowed: boolean; offline: boolean }>();
  const key = (ownerId: string, worldId: string) => `${ownerId}\0${worldId}`;
  return runProactiveScheduler(
    {
      claimProactive: async (maxWorlds) => {
        const worlds = await services.claimProactiveWorlds(maxWorlds, options.claim);
        if (!options.continuousOnly) return worlds;
        // Each independent read has its own owner-scoped connection; no parallel queries on one client.
        await Promise.all(
          worlds.map(async (world) => {
            const clock = await services.db.transaction(
              world.ownerId,
              async (sql) =>
                (
                  await sql.query(
                    'SELECT paused,continuity_mode,active_until FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2',
                    [world.worldId, world.ownerId],
                  )
                ).rows[0],
            );
            clocks.set(key(world.ownerId, world.worldId), {
              allowed: !!clock && !clock.paused && clock.continuity_mode === 'continuous',
              offline: !clock?.active_until || new Date(clock.active_until).getTime() <= Date.now(),
            });
          }),
        );
        // The SQL claim remains globally fair; priority applies only to this bounded claimed batch.
        return worlds.sort(
          (a, b) =>
            Number(clocks.get(key(b.ownerId, b.worldId))?.offline ?? false) -
            Number(clocks.get(key(a.ownerId, a.worldId))?.offline ?? false),
        );
      },
    },
    async (ownerId, worldId) =>
      options.continuousOnly && !clocks.get(key(ownerId, worldId))?.allowed
        ? { played: 0 }
        : services.advanceProactiveWorld(ownerId, worldId),
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
