// Run with --conditions=react-server --experimental-strip-types. Never imports production env files.
import { readFile, writeFile, open, unlink, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import {
  validateLocalWorkerEnvironment,
  selectNewTask,
  selectNewOutboxEvents,
} from './local-runtime-worker-policy.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const root = path.resolve(import.meta.dirname, '..');
const runtimeDir = path.resolve(
  option('--runtime-dir', path.join(root, '.local/local-runtime-clone-20261026')),
);
const healthPath = path.join(runtimeDir, 'worker-health.json');
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
  const readConfiguration = async (file, code) => {
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      throw Error(code);
    } // Never print a malformed secret-bearing JSON excerpt.
  };
  const env = await readConfiguration(
    path.resolve(option('--env', path.join(runtimeDir, 'candidate-env.json'))),
    'LOCAL_WORKER_ENV_UNREADABLE',
  );
  const manifest = await readConfiguration(
    path.resolve(option('--manifest', path.join(runtimeDir, 'worker-exclusions.json'))),
    'LOCAL_WORKER_MANIFEST_UNREADABLE',
  );
  const local = await readConfiguration(
    path.resolve(option('--local-config', path.join(root, '.local/runtime.json'))),
    'LOCAL_WORKER_ADMIN_CONFIG_UNREADABLE',
  );
  const selected = validateLocalWorkerEnvironment({ ...process.env, ...env }, manifest, local);
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  const nonce = randomUUID();
  const lockPath = path.join(runtimeDir, 'worker.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw Error('LOCAL_WORKER_ALREADY_REGISTERED');
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
  let admin, queue, db, heartbeat;
  const shutdown = new AbortController();
  process.once('SIGINT', () => shutdown.abort());
  process.once('SIGTERM', () => shutdown.abort());
  const health = {
    pid: process.pid,
    state: 'starting',
    target: selected.target,
    startedAt: new Date().toISOString(),
    heartbeatAt: '',
    cycles: 0,
    tasksRun: 0,
    lastError: null,
    scheduler: 'existing_application_entries',
    excludedTasks: selected.excludedTaskIds.length,
    excludedOutbox: selected.excludedOutboxIds.length,
  };
  let writing = false;
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
    // The admin connection is never handed to the application or used to execute tasks.
    admin = new pg.Client({
      host: selected.target.host,
      port: selected.target.port,
      user: 'pl_admin',
      password: local.adminPassword,
      database: selected.target.database,
      connectionTimeoutMillis: 5000,
      options: '-c default_transaction_read_only=on -c statement_timeout=5000',
    });
    await admin.connect();
    const { createWorker } = await import('../src/server/worker-composition.ts');
    const { getServices } = await import('../src/server/services.ts');
    const { runOne } = await import('../src/modules/tasks/application/run-worker.ts');
    const { runLoop } = await import('../src/modules/tasks/application/run-loop.ts');
    const { PostgresOutbox, taskCommandId } =
      await import('../src/modules/tasks/infrastructure/postgres-outbox.ts');
    const { dispatchOutbox } = await import('../src/modules/tasks/application/dispatch-outbox.ts');
    const worker = createWorker();
    queue = worker.queue;
    db = getServices().db;
    const excludedCommands = selected.excludedOutboxIds.map(taskCommandId);
    health.state = 'ready';
    await publish();
    heartbeat = setInterval(() => {
      void publish().catch(() => {});
    }, 5000);
    console.log(
      JSON.stringify({
        event: 'local_worker_ready',
        target: selected.target,
        excludedTasks: health.excludedTasks,
        excludedOutbox: health.excludedOutbox,
      }),
    );
    const result = await runLoop({
      shutdown: shutdown.signal,
      idleDelayMs: 1000,
      drainMs: 20000,
      sleep: (ms, signal) => sleep(ms, undefined, { signal }),
      log: () => {
        health.lastError = 'LOCAL_WORKER_EXECUTION_UNAVAILABLE';
      },
      runOnce: async (signal) => {
        health.cycles++;
        for (const e of await selectNewOutboxEvents(admin, selected)) {
          if (signal.aborted) return false;
          const ports = new PostgresOutbox(db).ports(e.owner_id, {
            worldId: e.world_id,
            eventId: e.event_id,
          });
          await dispatchOutbox({ ...ports, limit: 2 });
        }
        const ran = await runOne(
          {
            claim: async (kinds) => {
              const next = await selectNewTask(admin, selected, kinds, excludedCommands);
              return next ? queue.claimForOwner(next.id, next.owner_id, kinds) : null;
            },
            renew: (lease) => queue.renew(lease),
            finish: (lease, outcome) => queue.finish(lease, outcome),
          },
          worker.handlers,
          signal,
        );
        if (ran) health.tasksRun++;
        health.lastError = null;
        return ran;
      },
    });
    health.state = result.drained ? 'stopped' : 'stopped_with_unknown';
  } catch (error) {
    health.state = 'failed';
    health.lastError = String(error?.code ?? 'LOCAL_WORKER_START_FAILED');
    console.error(JSON.stringify({ event: 'local_worker_failed', code: health.lastError }));
    process.exitCode = 1;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await publish().catch(() => {});
    await queue?.close().catch(() => {});
    await db?.close().catch(() => {});
    await admin?.end().catch(() => {});
    const own = JSON.parse(await readFile(lockPath, 'utf8').catch(() => '{}'));
    if (own.nonce === nonce) await unlink(lockPath);
  }
}
