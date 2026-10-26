import { setTimeout as delay } from 'node:timers/promises';
import { runProactiveWorlds } from '../server/scheduler.ts';
import { getServices } from '../server/services.ts';
import {
  proactiveWorkerPolicy,
  runProactiveLoop,
} from '../modules/world/application/run-proactive-loop.ts';

// Identical application entry in local and hosted processes; environment chooses storage/credentials.
const policy = proactiveWorkerPolicy({
  checkEveryMs: Number(process.env.PROACTIVE_CHECK_MS ?? 15000),
  maxWorlds: Number(process.env.PROACTIVE_MAX_WORLDS ?? 2),
  cooldownSeconds: Number(process.env.PROACTIVE_COOLDOWN_SECONDS ?? 60),
  leaseSeconds: Number(process.env.PROACTIVE_LEASE_SECONDS ?? 60),
  maxElapsedMs: Number(process.env.PROACTIVE_TICK_BUDGET_MS ?? 15000),
});
const shutdown = new AbortController();
process.once('SIGINT', () => shutdown.abort());
process.once('SIGTERM', () => shutdown.abort());
console.log(JSON.stringify({ scope: 'proactive-worker', state: 'ready', policy }));
try {
  await runProactiveLoop({
    shutdown: shutdown.signal,
    policy,
    sleep: (ms, signal) => delay(ms, undefined, { signal }),
    tick: () =>
      runProactiveWorlds({
        continuousOnly: true,
        tick: { maxWorlds: policy.maxWorlds, maxElapsedMs: policy.maxElapsedMs },
        claim: { cooldownSeconds: policy.cooldownSeconds, leaseSeconds: policy.leaseSeconds },
      }),
    onResult: (result) => {
      console.log(
        JSON.stringify({ scope: 'proactive-worker', at: new Date().toISOString(), ...result }),
      );
    },
    onError: () => {
      console.warn(JSON.stringify({ scope: 'proactive-worker', code: 'TICK_FAILED' }));
    },
  });
} finally {
  await getServices().db.close();
}
