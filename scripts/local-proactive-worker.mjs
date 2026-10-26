// Explicit local-only entry. Never run this against production or from an implicit startup hook.
import { readFile, writeFile, open, unlink, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { validateLocalWorkerEnvironment } from './local-runtime-worker-policy.mjs';
import { localProactivePolicy, runLocalProactiveLoop } from './local-proactive-worker-policy.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const root = path.resolve(import.meta.dirname, '..');
const runtimeDir = path.resolve(
  option('--runtime-dir', path.join(root, '.local/local-runtime-clone-20261026')),
);
const healthPath = path.join(runtimeDir, 'proactive-worker-health.json');
if (args.includes('--status')) {
  try {
    const h = JSON.parse(await readFile(healthPath, 'utf8'));
    let alive = true;
    try {
      process.kill(h.pid, 0);
    } catch {
      alive = false;
    }
    const healthy =
      alive &&
      h.state === 'ready' &&
      !h.lastError &&
      Date.now() - Date.parse(h.heartbeatAt) < 15000;
    console.log(JSON.stringify({ ...h, alive, healthy }));
    process.exitCode = healthy ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ healthy: false, state: 'not_started' }));
    process.exitCode = 1;
  }
} else {
  if (!args.includes('--start')) throw Error('EXPLICIT_LOCAL_PROACTIVE_START_REQUIRED');
  const readConfig = async (file, code) => {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      throw Error(code);
    }
  };
  const env = await readConfig(
    path.resolve(option('--env', path.join(runtimeDir, 'candidate-env.json'))),
    'LOCAL_PROACTIVE_ENV_UNREADABLE',
  );
  const manifest = await readConfig(
    path.resolve(option('--manifest', path.join(runtimeDir, 'worker-exclusions.json'))),
    'LOCAL_PROACTIVE_MANIFEST_UNREADABLE',
  );
  const local = await readConfig(
    path.resolve(option('--local-config', path.join(root, '.local/runtime.json'))),
    'LOCAL_PROACTIVE_ADMIN_CONFIG_UNREADABLE',
  );
  const selected = validateLocalWorkerEnvironment({ ...process.env, ...env }, manifest, local);
  const policy = localProactivePolicy({
    checkEveryMs: Number(option('--check-ms', 15000)),
    maxWorlds: Number(option('--max-worlds', 2)),
    cooldownSeconds: Number(option('--cooldown-seconds', 60)),
    leaseSeconds: Number(option('--lease-seconds', 60)),
    maxElapsedMs: Number(option('--tick-budget-ms', 15000)),
  });
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  const nonce = randomUUID(),
    lockPath = path.join(runtimeDir, 'proactive-worker.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw Error('LOCAL_PROACTIVE_ALREADY_REGISTERED');
  });
  await lock.writeFile(
    JSON.stringify({
      pid: process.pid,
      nonce,
      startedAt: new Date().toISOString(),
      target: selected.target,
    }),
  );
  await lock.close();
  const shutdown = new AbortController();
  process.once('SIGINT', () => shutdown.abort());
  process.once('SIGTERM', () => shutdown.abort());
  const health = {
    pid: process.pid,
    state: 'starting',
    target: selected.target,
    policy,
    startedAt: new Date().toISOString(),
    heartbeatAt: '',
    ticks: 0,
    claimed: 0,
    advanced: 0,
    messages: 0,
    failed: 0,
    lastError: null,
    lastTickStartedAt: null,
    lastTickCompletedAt: null,
  };
  let heartbeat,
    db,
    writing = false;
  const publish = async () => {
    if (writing) return;
    writing = true;
    try {
      health.heartbeatAt = new Date().toISOString();
      const tmp = `${healthPath}.${nonce}.tmp`;
      await writeFile(tmp, JSON.stringify(health, null, 2), { mode: 0o600 });
      await rename(tmp, healthPath);
    } finally {
      writing = false;
    }
  };
  try {
    Object.assign(process.env, env);
    const { runProactiveWorlds } = await import('../src/server/scheduler.ts');
    const { getServices } = await import('../src/server/services.ts');
    db = getServices().db;
    health.state = 'ready';
    await publish();
    heartbeat = setInterval(() => {
      void publish().catch(() => {});
    }, 5000);
    console.log(
      JSON.stringify({ event: 'local_proactive_ready', target: selected.target, policy }),
    );
    await runLocalProactiveLoop({
      shutdown: shutdown.signal,
      once: args.includes('--once'),
      policy,
      sleep: (ms, signal) => sleep(ms, undefined, { signal }),
      tick: async () => {
        health.lastTickStartedAt = new Date().toISOString();
        return runProactiveWorlds({
          continuousOnly: true,
          tick: { maxWorlds: policy.maxWorlds, maxElapsedMs: policy.maxElapsedMs },
          claim: { cooldownSeconds: policy.cooldownSeconds, leaseSeconds: policy.leaseSeconds },
        });
      },
      onResult: async (result) => {
        health.ticks++;
        for (const key of ['claimed', 'advanced', 'messages', 'failed']) health[key] += result[key];
        health.lastTickCompletedAt = new Date().toISOString();
        health.lastError = result.failed ? 'LOCAL_PROACTIVE_WORLD_FAILED' : null;
        await publish();
      },
      onError: async () => {
        health.ticks++;
        health.lastError = 'LOCAL_PROACTIVE_TICK_FAILED';
        await publish();
      },
    });
    health.state = 'stopped';
  } catch (error) {
    health.state = 'failed';
    health.lastError = String(error?.code ?? 'LOCAL_PROACTIVE_START_FAILED');
    console.error(JSON.stringify({ event: 'local_proactive_failed', code: health.lastError }));
    process.exitCode = 1;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await publish().catch(() => {});
    await db?.close().catch(() => {});
    const own = JSON.parse(await readFile(lockPath, 'utf8').catch(() => '{}'));
    if (own.nonce === nonce) await unlink(lockPath);
  }
}
