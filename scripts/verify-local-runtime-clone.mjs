/** Verify a restored clone and fill only missing local files from existing local
 * private stores. No remote calls, model calls, schema changes or queue execution.
 * node scripts/verify-local-runtime-clone.mjs MAIN_ROOT CLONE_DIRECTORY
 */
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import pg from 'pg';
const [rootArg, directoryArg] = process.argv.slice(2);
if (!rootArg || !directoryArg) throw Error('MAIN_ROOT_AND_CLONE_DIRECTORY_REQUIRED');
const root = resolve(rootArg),
  directory = resolve(directoryArg);
if (!directory.startsWith(join(root, '.local') + '/'))
  throw Error('IGNORED_CLONE_DIRECTORY_REQUIRED');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const cfg = await readJson(join(root, '.local/runtime.json'));
const manifest = await readJson(join(directory, 'source-manifest.json'));
const env = await readJson(join(directory, 'candidate-env.json'));
const exclusions = await readJson(join(directory, 'worker-exclusions.json'));
const prior = await readJson(join(root, '.local/local-play/env.json'));
const development = parseEnv(await readFile(join(root, '.env.local'), 'utf8'));
if (manifest.port !== cfg.port || !/^parallel_life_clone_[a-z0-9_]+$/.test(manifest.database))
  throw Error('CLONE_TARGET_INVALID');
for (const key of [
  'DATABASE_URL',
  'APP_DATABASE_URL',
  'WORKER_DATABASE_URL',
  'SCHEDULER_DATABASE_URL',
  'PUBLISHER_DATABASE_URL',
]) {
  if (!env[key]) continue;
  const u = new URL(env[key]);
  if (
    !['localhost', '127.0.0.1'].includes(u.hostname) ||
    Number(u.port) !== cfg.port ||
    u.pathname !== '/' + manifest.database
  )
    throw Error('ENV_TARGET_MISMATCH');
}
if (
  Object.keys(env).some(
    (k) => k.startsWith('SUPABASE_') || k.startsWith('BLOB_') || k.startsWith('VERCEL'),
  )
)
  throw Error('REMOTE_STORAGE_CONFIG_REMAINS');
const client = new pg.Client({
  host: '127.0.0.1',
  port: cfg.port,
  user: 'pl_admin',
  password: cfg.adminPassword,
  database: manifest.database,
});
const report = {
  checkedAt: new Date().toISOString(),
  remoteDatabaseWrites: 0,
  paidCalls: 0,
  missing: [],
  recoveredLocal: [],
  checkedAssets: 0,
};
try {
  await client.connect();
  const assets = (
    await client.query(
      "SELECT storage_key,byte_length,'private' AS kind FROM parallel_life.assets WHERE status='ready' UNION ALL SELECT storage_key,byte_length,'publication' AS kind FROM parallel_life.publication_media_assets WHERE status='ready' ORDER BY kind,storage_key",
    )
  ).rows;
  const oldRoots = [
    ...new Set(
      [prior.PRIVATE_ASSET_DIR, development.PRIVATE_ASSET_DIR, join(root, '.local/assets')]
        .filter(Boolean)
        .map((p) => resolve(p)),
    ),
  ];
  for (const asset of assets) {
    const key = asset.storage_key;
    if (key.split('/').some((p) => !p || p === '.' || p === '..')) throw Error('ASSET_KEY_INVALID');
    const suffix = asset.kind === 'publication' ? join('publication-media', key) : key;
    const target = join(env.PRIVATE_ASSET_DIR, suffix);
    let size = await stat(target).then(
      (x) => x.size,
      () => -1,
    );
    if (size !== Number(asset.byte_length)) {
      let recovered = false;
      for (const oldRoot of oldRoots) {
        const file = join(oldRoot, suffix);
        if (
          (await stat(file).then(
            (x) => x.size,
            () => -1,
          )) !== Number(asset.byte_length)
        )
          continue;
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(file, target);
        recovered = true;
        report.recoveredLocal.push({ kind: asset.kind, key, bytes: Number(asset.byte_length) });
        break;
      }
      if (!recovered) {
        report.missing.push({ kind: asset.kind, key, bytes: Number(asset.byte_length) });
        continue;
      }
    }
    report.checkedAssets++;
  }
  const tasks = (await client.query('SELECT id FROM parallel_life.tasks')).rows.map((x) => x.id);
  const jobs = (await client.query('SELECT id FROM parallel_life.outbox_jobs')).rows.map(
    (x) => x.id,
  );
  report.historicalTasksExcluded = tasks.every((id) => exclusions.excludedTaskIds.includes(id));
  report.historicalOutboxExcluded = jobs.every((id) => exclusions.excludedOutboxIds.includes(id));
  report.taskStatuses = (
    await client.query(
      'SELECT status,count(*)::integer AS count FROM parallel_life.tasks GROUP BY status ORDER BY status',
    )
  ).rows;
  report.migrations = (
    await client.query('SELECT name FROM public.pl_migrations ORDER BY name')
  ).rows.map((x) => x.name);
  report.constraints = (
    await client.query(
      "SELECT contype,count(*)::integer AS count,count(*) FILTER(WHERE NOT convalidated)::integer AS not_validated FROM pg_constraint WHERE connamespace='parallel_life'::regnamespace GROUP BY contype ORDER BY contype",
    )
  ).rows;
  report.pausedClocks = (
    await client.query(
      'SELECT count(*)::integer AS total,count(*) FILTER(WHERE paused AND active_until IS NULL)::integer AS paused FROM parallel_life.world_clock',
    )
  ).rows[0];
  const world = (await client.query('SELECT owner_id FROM parallel_life.worlds LIMIT 1')).rows[0];
  if (world) {
    const app = new pg.Client({ connectionString: env.APP_DATABASE_URL });
    await app.connect();
    try {
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.user_id',$1,true)", [world.owner_id]);
      const visible = (await app.query('SELECT owner_id FROM parallel_life.worlds')).rows;
      if (visible.some((x) => x.owner_id !== world.owner_id)) throw Error('RLS_OWNER_LEAK');
      report.ownerRls = { ownWorldVisible: visible.length > 0, otherOwnersVisible: false };
      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }
  }
  await writeFile(join(directory, 'clone-verification.json'), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  if (
    report.missing.length ||
    !report.historicalTasksExcluded ||
    !report.historicalOutboxExcluded ||
    !report.ownerRls?.ownWorldVisible
  )
    throw Error('CLONE_VERIFICATION_INCOMPLETE_SEE_PRIVATE_REPORT');
  console.log(
    JSON.stringify({
      verified: true,
      checkedAssets: report.checkedAssets,
      recoveredLocal: report.recoveredLocal.length,
      migrations: report.migrations.length,
      historicalTasksExcluded: report.historicalTasksExcluded,
      historicalOutboxExcluded: report.historicalOutboxExcluded,
      ownerRls: report.ownerRls,
      pausedClocks: report.pausedClocks,
    }),
  );
} finally {
  await client.end();
}
