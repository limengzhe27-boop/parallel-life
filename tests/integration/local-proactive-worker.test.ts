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
import { PostgresSchedulerRepository } from '../../src/modules/world/infrastructure/scheduler-repository.ts';
import { runProactiveScheduler } from '../../src/modules/world/application/run-proactive-scheduler.ts';
import {
  claimAgentAdvanceBatch,
  releaseAgentAdvanceBatch,
} from '../../src/modules/world/infrastructure/agent-advance-batch-lease.ts';

test('local proactive SQL fairness, shared advance lease, stop-state guard and independent process lifecycle', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.LOCAL_PROACTIVE_TEST_PORT ?? 55432));
  const database = `parallel_life_clone_proactive_test_${randomUUID().replaceAll('-', '')}`;
  const conn = { host: '127.0.0.1', port: cfg.port, user: 'pl_admin', password: cfg.adminPassword };
  const control = new pg.Client({ ...conn, database: 'postgres' });
  await control.connect();
  await control.query(`CREATE DATABASE ${database}`);
  const admin = new pg.Client({ ...conn, database });
  await admin.connect();
  await migrate(admin);
  const appUrl = `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/${database}`;
  const db = new PostgresDatabase(appUrl),
    secondDb = new PostgresDatabase(appUrl);
  const repo = new PostgresSchedulerRepository(
    `postgresql://pl_scheduler:${cfg.schedulerPassword}@127.0.0.1:${cfg.port}/${database}`,
  );
  const secondRepo = new PostgresSchedulerRepository(
    `postgresql://pl_scheduler:${cfg.schedulerPassword}@127.0.0.1:${cfg.port}/${database}`,
  );
  t.after(async () => {
    await db.close();
    await secondDb.close();
    await repo.close();
    await secondRepo.close();
    await admin.end();
    await control.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await control.end();
  });
  const owner = randomUUID(),
    profile = randomUUID();
  await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
  await admin.query("INSERT INTO parallel_life.profiles(id,owner_id,document) VALUES($1,$2,'{}')", [
    profile,
    owner,
  ]);
  const addWorld = async (paused = false, mode = 'continuous', future = false) => {
    const id = randomUUID(),
      state = {
        schemaVersion: 1,
        id,
        ownerId: owner,
        version: 0,
        title: 'local scheduler fixture',
        time: new Date().toISOString(),
        actors: [],
        messages: [],
        facts: [],
        appointments: [],
        mediaRequests: [],
      };
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [id, owner, state.title, state],
    );
    await admin.query(
      'INSERT INTO parallel_life.agent_runtime_worlds(world_id,owner_id,engine_epoch) VALUES($1,$2,2)',
      [id, owner],
    );
    await admin.query(
      `INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,paused,continuity_mode,pause_reason,managed,active_until) VALUES($1,$2,now(),$3,$4,$5,true,now()+$6*interval '1 second')`,
      [id, owner, paused, mode, paused ? 'manual' : null, future ? 60 : -60],
    );
    return id;
  };
  const worlds: string[] = [];
  for (let i = 0; i < 5; i++) worlds.push(await addWorld());
  const paused = await addWorld(true),
    trial = await addWorld();
  const seed = randomUUID();
  await admin.query(
    "INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,'fixture','{}')",
    [seed, owner, profile, randomUUID()],
  );
  await admin.query(
    'INSERT INTO parallel_life.world_builds(seed_id,owner_id,world_id,opening) VALUES($1,$2,$3,$4)',
    [seed, owner, trial, { originKind: 'trial' }],
  );
  const limits: number[] = [],
    seen: string[] = [];
  const source = {
    claimProactive: async (limit = 2) => {
      limits.push(limit);
      return repo.claimProactive(limit, { cooldownSeconds: 60, leaseSeconds: 60 });
    },
  };
  const advance = async (_owner: string, world: string) => {
    assert.equal(seen.includes(world), false);
    seen.push(world);
    return { played: 1 };
  };
  assert.equal(
    (await runProactiveScheduler(source, advance, { maxWorlds: 3, maxElapsedMs: 10000 })).claimed,
    3,
  );
  assert.deepEqual(limits, [2, 1]);
  assert.equal(
    (await runProactiveScheduler(source, advance, { maxWorlds: 2, maxElapsedMs: 10000 })).claimed,
    2,
  );
  assert.deepEqual(new Set(seen), new Set(worlds));
  assert.equal((await repo.claimProactive()).length, 0);
  assert.equal(
    (
      await admin.query(
        'SELECT paused,pause_reason FROM parallel_life.world_clock WHERE world_id=$1',
        [paused],
      )
    ).rows[0].paused,
    true,
  );
  // Both original cron and the local claim use the same durable proactive lease.
  await admin.query(
    "UPDATE parallel_life.world_proactive_leases SET last_started_at=now()-interval '61 seconds',lease_until=now()-interval '1 second' WHERE world_id=$1",
    [worlds[0]],
  );
  const [a, b] = await Promise.all([
    repo.claimProactive(1, { cooldownSeconds: 60, leaseSeconds: 60 }),
    secondRepo.claimProactive(1, { cooldownSeconds: 60, leaseSeconds: 60 }),
  ]);
  assert.equal(a.length + b.length, 1);
  // The foreground and background advance paths share their original batch lease too.
  const first = await claimAgentAdvanceBatch(db, owner, worlds[0]!);
  assert.equal(first.status, 'claimed');
  assert.equal((await claimAgentAdvanceBatch(secondDb, owner, worlds[0]!)).status, 'busy');
  if (first.status === 'claimed')
    await releaseAgentAdvanceBatch(db, owner, worlds[0]!, first.token);
  const next = await claimAgentAdvanceBatch(secondDb, owner, worlds[0]!);
  assert.equal(next.status, 'claimed');
  if (next.status === 'claimed')
    await releaseAgentAdvanceBatch(secondDb, owner, worlds[0]!, next.token);
  // Invoke the actual server wrapper with a presence-only expired world: it must not buy a model.
  await admin.query('UPDATE parallel_life.world_clock SET paused=true');
  const presence = await addWorld(false, 'presence');
  const runtimeDir = path.resolve('.local', `proactive-smoke-${randomUUID()}`),
    assets = path.join(runtimeDir, 'assets');
  await mkdir(assets, { recursive: true });
  const candidate = {
    DATABASE_URL: appUrl,
    WORKER_DATABASE_URL: `postgresql://pl_worker:${cfg.workerPassword}@127.0.0.1:${cfg.port}/${database}`,
    SCHEDULER_DATABASE_URL: `postgresql://pl_scheduler:${cfg.schedulerPassword}@127.0.0.1:${cfg.port}/${database}`,
    PRIVATE_ASSET_DIR: assets,
    APP_ORIGIN: 'http://127.0.0.1:3218',
    SESSION_SECRET: 'fixture-only-secret-at-least-32-characters-long',
    YIBU_API_KEY: 'fixture-never-send',
    YIBU_TEXT_MODEL: 'fixture',
  };
  const envPath = path.join(runtimeDir, 'candidate-env.json');
  await writeFile(envPath, JSON.stringify(candidate), { mode: 0o600 });
  await writeFile(
    path.join(runtimeDir, 'worker-exclusions.json'),
    JSON.stringify({
      schemaVersion: 1,
      target: { host: '127.0.0.1', port: cfg.port, database },
      capturedAt: new Date().toISOString(),
      excludedTaskIds: [],
      excludedOutboxIds: [],
      preserveUnknown: true,
    }),
    { mode: 0o600 },
  );
  const cleanEnv = { ...process.env };
  for (const key of Object.keys(cleanEnv))
    if (/^(SUPABASE_|BLOB_|VERCEL)/.test(key)) delete cleanEnv[key];
  const probe = spawnSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
   import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
   Object.assign(process.env,JSON.parse(await readFile(process.argv[1],'utf8')));
   globalThis.fetch=async()=>{throw Error('MODEL_MUST_NOT_BE_CALLED')};
   const{runProactiveWorlds}=await import('./src/server/scheduler.ts');const{getServices}=await import('./src/server/services.ts');
   const result=await runProactiveWorlds({tick:{maxWorlds:2,maxElapsedMs:1000},claim:{cooldownSeconds:60,leaseSeconds:60}});
   assert.equal(result.claimed,0);assert.equal(result.advanced,0);assert.equal(result.messages,0);assert.equal(result.failed,0);await getServices().db.close();
 `,
      envPath,
    ],
    { encoding: 'utf8', env: cleanEnv, timeout: 20000 },
  );
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(
    (
      await admin.query(
        'SELECT paused,continuity_mode FROM parallel_life.world_clock WHERE world_id=$1',
        [presence],
      )
    ).rows[0].continuity_mode,
    'presence',
  );
  await admin.query('UPDATE parallel_life.world_clock SET paused=true');
  const baseArgs = ['--conditions=react-server', '--experimental-strip-types'];
  const missing = spawnSync(
    process.execPath,
    [...baseArgs, 'scripts/local-proactive-worker.mjs', '--runtime-dir', runtimeDir],
    { encoding: 'utf8', env: cleanEnv },
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /EXPLICIT_LOCAL_PROACTIVE_START_REQUIRED/);
  // Two independent processes can be ready together. No browser and no eligible fixture/model work.
  const children: {
    child: ReturnType<typeof spawn>;
    ended: Promise<number | null>;
    output: () => string;
    health: string;
    args: string[];
  }[] = [];
  for (const name of ['local-runtime-worker', 'local-proactive-worker']) {
    const args = [
      ...baseArgs,
      `scripts/${name}.mjs`,
      '--runtime-dir',
      runtimeDir,
      ...(name === 'local-proactive-worker' ? ['--start'] : []),
    ];
    const child = spawn(process.execPath, args, {
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.on('data', (x) => {
      output += String(x);
    });
    child.stderr!.on('data', (x) => {
      output += String(x);
    });
    const ended = new Promise<number | null>((resolve) => child.on('exit', resolve));
    children.push({
      child,
      ended,
      output: () => output,
      health: path.join(
        runtimeDir,
        name === 'local-runtime-worker' ? 'worker-health.json' : 'proactive-worker-health.json',
      ),
      args,
    });
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGTERM');
    });
  }
  for (const c of children) {
    for (let i = 0; i < 100; i++) {
      try {
        const h = JSON.parse(await readFile(c.health, 'utf8'));
        if (h.state === 'ready') break;
        if (h.state === 'failed') assert.fail(c.output());
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      if (c.child.exitCode !== null) assert.fail(c.output());
      await sleep(100);
    }
    const status = spawnSync(process.execPath, [...c.args, '--status'], {
      encoding: 'utf8',
      env: cleanEnv,
    });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).healthy, true);
  }
  const p = children[1]!;
  const duplicate = spawnSync(process.execPath, p.args, {
    encoding: 'utf8',
    env: cleanEnv,
    timeout: 10000,
  });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /LOCAL_PROACTIVE_ALREADY_REGISTERED/);
  for (const c of children) c.child.kill('SIGTERM');
  for (const c of children) assert.equal(await c.ended, 0, c.output());
  const final = JSON.parse(await readFile(p.health, 'utf8'));
  assert.equal(final.state, 'stopped');
  assert.equal(final.messages, 0);
  await assert.rejects(access(path.join(runtimeDir, 'proactive-worker.lock')), { code: 'ENOENT' });
  const once = spawnSync(process.execPath, [...p.args, '--once'], {
    encoding: 'utf8',
    env: cleanEnv,
    timeout: 20000,
  });
  assert.equal(once.status, 0, once.stderr);
  const onceHealth = JSON.parse(await readFile(p.health, 'utf8'));
  assert.equal(onceHealth.ticks, 1);
  assert.equal(onceHealth.state, 'stopped');
  assert.equal(onceHealth.messages, 0);
});
