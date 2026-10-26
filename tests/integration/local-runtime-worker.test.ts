import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import {
  PostgresOutbox,
  taskCommandId,
} from '../../src/modules/tasks/infrastructure/postgres-outbox.ts';
import { dispatchOutbox } from '../../src/modules/tasks/application/dispatch-outbox.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import {
  selectNewTask,
  selectNewOutboxEvents,
} from '../../scripts/local-runtime-worker-policy.mjs';

test('clone runner selects and leases only new work, keeps all historical records, and dispatches new outbox once', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.LOCAL_WORKER_TEST_PORT ?? 55432));
  const database = `parallel_life_clone_worker_test_${randomUUID().replaceAll('-', '')}`;
  const connection = {
    host: '127.0.0.1',
    port: cfg.port,
    user: 'pl_admin',
    password: cfg.adminPassword,
  };
  const control = new pg.Client({ ...connection, database: 'postgres' });
  await control.connect();
  await control.query(`CREATE DATABASE ${database}`);
  const admin = new pg.Client({ ...connection, database });
  await admin.connect();
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/${database}`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/${database}`,
  );
  t.after(async () => {
    await db.close();
    await queue.close();
    await admin.end();
    await control.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await control.end();
  });
  const owner = randomUUID();
  await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
  const addTask = async (status: string, command: string = randomUUID()) => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input,status,lease_token,lease_until)
    VALUES($1,$2,'world',$3,$4,'fixture','{"type":"scene"}',$5,$6,$7)`,
      [
        id,
        owner,
        randomUUID(),
        command,
        status,
        status === 'running' ? randomUUID() : null,
        status === 'running' ? '2020-01-01T00:00:00Z' : null,
      ],
    );
    return id;
  };
  const oldIds: string[] = [];
  for (const status of ['queued', 'running', 'unknown', 'failed', 'succeeded'])
    oldIds.push(await addTask(status));
  const historicalBefore = (await admin.query('SELECT * FROM parallel_life.tasks ORDER BY id'))
    .rows;
  const oldOutboxId = randomUUID(),
    blockedCommands = [taskCommandId(oldOutboxId)];
  const lateOldTask = await addTask('queued', blockedCommands[0]!);
  const next = await addTask('queued');
  const manifest = { excludedTaskIds: oldIds, excludedOutboxIds: [oldOutboxId] };
  assert.equal((await selectNewTask(admin, manifest, ['world'], blockedCommands))?.id, next);
  let ran = 0;
  const filtered = {
    claim: async (kinds: string[]) => {
      const picked = await selectNewTask(admin, manifest, kinds, blockedCommands);
      return picked ? queue.claimForOwner(picked.id, picked.owner_id, kinds) : null;
    },
    renew: queue.renew.bind(queue),
    finish: queue.finish.bind(queue),
  };
  await runOne(filtered, {
    world: async (lease) => {
      ran++;
      assert.equal(lease.id, next);
      assert.deepEqual(lease.input, { type: 'scene' });
      await queue.finish(lease, { status: 'succeeded' });
    },
  });
  assert.equal(ran, 1);
  assert.equal(
    await runOne(filtered, {
      world: async () => {
        throw Error('duplicate');
      },
    }),
    false,
  );
  assert.deepEqual(
    (
      await admin.query('SELECT * FROM parallel_life.tasks WHERE id=ANY($1::uuid[]) ORDER BY id', [
        oldIds,
      ])
    ).rows,
    historicalBefore,
  );
  assert.equal(
    (await admin.query('SELECT status FROM parallel_life.tasks WHERE id=$1', [lateOldTask])).rows[0]
      .status,
    'queued',
  );
  const world = randomUUID();
  await admin.query(
    "INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,'fixture','{}')",
    [world, owner],
  );
  const addEvent = async (version: number) => {
    const id = randomUUID(),
      command: string = randomUUID();
    await admin.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,0,'fixture','{}','queued')",
      [command, world, owner],
    );
    await admin.query(
      "INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,'{}',now())",
      [id, world, owner, version, command],
    );
    return id;
  };
  const oldEvent = await addEvent(1),
    newEvent = await addEvent(2);
  const addOutbox = async (id: string, event: string) => {
    const payload = {
      id,
      eventId: event,
      worldId: world,
      type: 'image.generate',
      requestId: randomUUID(),
      prompt: 'synthetic fixture',
    };
    await admin.query(
      'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
      [id, world, owner, event, payload],
    );
  };
  await addOutbox(oldOutboxId, oldEvent);
  await addOutbox(randomUUID(), oldEvent);
  await addOutbox(randomUUID(), newEvent);
  const oldJobs = (
    await admin.query('SELECT * FROM parallel_life.outbox_jobs WHERE event_id=$1 ORDER BY id', [
      oldEvent,
    ])
  ).rows;
  const events = await selectNewOutboxEvents(admin, manifest);
  assert.deepEqual(
    events.map((e: { event_id: string }) => e.event_id),
    [newEvent],
  );
  const ports = new PostgresOutbox(db).ports(owner, { worldId: world, eventId: newEvent });
  const first = await dispatchOutbox({ ...ports, limit: 2 });
  assert.equal(first.submitted, 1);
  assert.equal((await dispatchOutbox({ ...ports, limit: 2 })).submitted, 0);
  assert.deepEqual(
    (
      await admin.query('SELECT * FROM parallel_life.outbox_jobs WHERE event_id=$1 ORDER BY id', [
        oldEvent,
      ])
    ).rows,
    oldJobs,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM parallel_life.tasks WHERE scope_kind='media'",
      )
    ).rows[0].n,
    1,
  );
  // Exercise the actual runner process on an isolated empty-eligible clone: no gateway calls.
  const runtimeDir = path.resolve('.local', `worker-smoke-${randomUUID()}`);
  const assets = path.join(runtimeDir, 'assets');
  await mkdir(assets, { recursive: true });
  const allTaskIds = (await admin.query('SELECT id::text FROM parallel_life.tasks')).rows.map(
    (x) => x.id,
  );
  const allOutboxIds = (await admin.query('SELECT id FROM parallel_life.outbox_jobs')).rows.map(
    (x) => x.id,
  );
  const candidate = {
    DATABASE_URL: `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/${database}`,
    WORKER_DATABASE_URL: `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/${database}`,
    PRIVATE_ASSET_DIR: assets,
    APP_ORIGIN: 'http://127.0.0.1:3218',
    SESSION_SECRET: 'fixture-only-secret-that-is-at-least-32-characters',
    YIBU_API_KEY: 'fixture-not-a-provider-key',
    YIBU_TEXT_MODEL: 'fixture',
  };
  await writeFile(path.join(runtimeDir, 'candidate-env.json'), JSON.stringify(candidate), {
    mode: 0o600,
  });
  await writeFile(
    path.join(runtimeDir, 'worker-exclusions.json'),
    JSON.stringify({
      schemaVersion: 1,
      target: { host: '127.0.0.1', port: cfg.port, database },
      capturedAt: new Date().toISOString(),
      excludedTaskIds: allTaskIds,
      excludedOutboxIds: allOutboxIds,
      preserveUnknown: true,
    }),
    { mode: 0o600 },
  );
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv))
    if (/^(SUPABASE_|BLOB_|VERCEL)/.test(key)) delete childEnv[key];
  const args = [
    '--conditions=react-server',
    '--experimental-strip-types',
    'scripts/local-runtime-worker.mjs',
    '--runtime-dir',
    runtimeDir,
  ];
  const child = spawn(process.execPath, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (x) => {
    output += String(x);
  });
  child.stderr.on('data', (x) => {
    output += String(x);
  });
  const ended = new Promise<number | null>((resolve) => child.on('exit', resolve));
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGTERM');
  });
  for (let i = 0; i < 100; i++) {
    try {
      const health = JSON.parse(
        await readFile(path.join(runtimeDir, 'worker-health.json'), 'utf8'),
      );
      if (health.state === 'ready') break;
      if (health.state === 'failed') assert.fail(output);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (child.exitCode !== null) assert.fail(output);
    await sleep(100);
  }
  const status = spawnSync(process.execPath, [...args, '--status'], {
    encoding: 'utf8',
    env: childEnv,
  });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).healthy, true);
  const duplicate = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: childEnv,
    timeout: 10000,
  });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /LOCAL_WORKER_ALREADY_REGISTERED/);
  child.kill('SIGTERM');
  assert.equal(await ended, 0, output);
  const finalHealth = JSON.parse(
    await readFile(path.join(runtimeDir, 'worker-health.json'), 'utf8'),
  );
  assert.equal(finalHealth.state, 'stopped');
  assert.equal(finalHealth.tasksRun, 0);
  await assert.rejects(access(path.join(runtimeDir, 'worker.lock')), { code: 'ENOENT' });
});
