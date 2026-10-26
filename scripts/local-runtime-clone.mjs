/** Explicit Supabase -> isolated loopback clone. Never uploads or writes the source.
 * node scripts/local-runtime-clone.mjs --root /absolute/main --output /absolute/ignored/dir
 * --database parallel_life_clone_NAME [--pg-bin /path/to/bin] [--resume-assets]
 * All snapshots/manifests/env files contain private data and stay outside git.
 */
import { readFile, writeFile, mkdir, stat, copyFile, chmod, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import pg from 'pg';
const { values: args } = parseArgs({
  options: {
    root: { type: 'string' },
    output: { type: 'string' },
    database: { type: 'string' },
    'pg-bin': { type: 'string', default: '/opt/homebrew/opt/libpq/bin' },
    'resume-assets': { type: 'boolean', default: false },
    'resume-restore': { type: 'boolean', default: false },
  },
});
if (!args.root || !args.output || !/^parallel_life_clone_[a-z0-9_]+$/.test(args.database ?? ''))
  throw Error('EXPLICIT_MAIN_ROOT_OUTPUT_AND_NEW_CLONE_DATABASE_REQUIRED');
const root = resolve(args.root),
  output = resolve(args.output),
  database = args.database;
if (!output.startsWith(join(root, '.local') + '/'))
  throw Error('OUTPUT_MUST_BE_IGNORED_LOCAL_DIRECTORY');
await mkdir(output, { recursive: true, mode: 0o700 });
const writeJson = async (file, value) =>
  writeFile(join(output, file), JSON.stringify(value, null, 2), { mode: 0o600 });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const qi = (value) => '"' + String(value).replaceAll('"', '""') + '"';
const sourceEnv = parseEnv(await readFile(join(root, '.local/supabase.env'), 'utf8'));
const localEnv = parseEnv(await readFile(join(root, '.env.local'), 'utf8'));
const runtime = JSON.parse(await readFile(join(root, '.local/runtime.json'), 'utf8'));
const sourceUrl = new URL(sourceEnv.SUPABASE_DB_URL);
if (!sourceUrl.hostname.endsWith('.supabase.com') && !sourceUrl.hostname.endsWith('.supabase.co'))
  throw Error('SUPABASE_SOURCE_REQUIRED');
sourceUrl.searchParams.delete('sslmode');
sourceUrl.port = '5432'; // session pool: exported snapshot and pg_dump share a stable session.
const local = (db) =>
  new pg.Client({
    host: '127.0.0.1',
    port: runtime.port,
    user: 'pl_admin',
    password: runtime.adminPassword,
    database: db,
    connectionTimeoutMillis: 10000,
  });
const source = new pg.Client({
  connectionString: sourceUrl.href,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});
const runPg = async (tool, argv, env) => {
  const log = [];
  const result = await new Promise((resolve, reject) => {
    const child = spawn(join(args['pg-bin'], tool), argv, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', (chunk) => log.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
  await writeFile(join(output, tool + '.log'), Buffer.concat(log), { mode: 0o600 });
  if (result !== 0) throw Error(tool.toUpperCase() + '_FAILED_SEE_PRIVATE_LOG');
};
const fingerprint = async (client, tables) => {
  const queries = tables.map(({ table_schema: schema, table_name: name }) => {
    const table = qi(schema) + '.' + qi(name);
    return `SELECT '${schema}.${name}' AS name,count(*)::text AS count,COALESCE(sum(('x'||substr(md5(to_jsonb(t)::text),1,16))::bit(64)::bigint::numeric),0)::text AS content_sum FROM ${table} t`;
  });
  return (await client.query(queries.join(' UNION ALL ') + ' ORDER BY name')).rows;
};
const localDb = local(database);
let manifest;
if (!args['resume-assets']) {
  if (!args['resume-restore']) {
    if (
      await stat(join(output, 'snapshot.dump')).then(
        () => true,
        () => false,
      )
    )
      throw Error('BACKUP_ALREADY_EXISTS_USE_NEW_OUTPUT_OR_RESUME_ASSETS');
    const admin = local('postgres');
    await admin.connect();
    try {
      if ((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount)
        throw Error('TARGET_DATABASE_EXISTS_WILL_NOT_OVERWRITE');
      await source.connect();
      await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await source.query(
        "SET LOCAL statement_timeout='120000ms'; SET LOCAL lock_timeout='5000ms'; SET LOCAL TIME ZONE 'UTC'",
      );
      const snapshot = (await source.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
      const tables = (
        await source.query(
          "SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN('public','parallel_life') ORDER BY 1,2",
        )
      ).rows;
      const roles = (
        await source.query(
          "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname",
        )
      ).rows;
      const fingerprints = await fingerprint(source, tables);
      const storageObjects = (
        await source.query(
          "SELECT bucket_id,name,metadata->>'size' AS bytes,metadata->>'eTag' AS etag FROM storage.objects WHERE bucket_id IN('private-assets','publication-media') ORDER BY bucket_id,name",
        )
      ).rows;
      const roleMemberships = (
        await source.query(
          "SELECT r.rolname AS role,m.rolname AS member FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.roleid JOIN pg_roles m ON m.oid=am.member WHERE r.rolname LIKE 'pl_%' OR m.rolname LIKE 'pl_%' ORDER BY 1,2",
        )
      ).rows;
      manifest = {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        database,
        port: runtime.port,
        tables,
        fingerprints,
        roles,
        roleMemberships,
        storageObjects,
        sourceHost: sourceUrl.hostname,
        snapshotConsistent: true,
      };
      await writeJson('source-manifest.json', manifest);
      await writeFile(join(output, 'snapshot.dump'), '', { flag: 'wx', mode: 0o600 });
      await runPg(
        'pg_dump',
        [
          '--format=custom',
          '--schema=parallel_life',
          '--schema=public',
          '--snapshot=' + snapshot,
          '--file=' + join(output, 'snapshot.dump'),
        ],
        {
          PGHOST: sourceUrl.hostname,
          PGPORT: sourceUrl.port,
          PGUSER: decodeURIComponent(sourceUrl.username),
          PGPASSWORD: decodeURIComponent(sourceUrl.password),
          PGDATABASE: sourceUrl.pathname.slice(1),
          PGSSLMODE: 'require',
          PGCONNECT_TIMEOUT: '20',
          PGOPTIONS: '-c default_transaction_read_only=on -c lock_timeout=5000',
        },
      );
      await chmod(join(output, 'snapshot.dump'), 0o600);
      await source.query('ROLLBACK');
      await source.end();
      console.log(
        JSON.stringify({
          phase: 'backup_complete',
          tables: tables.length,
          bytes: (await stat(join(output, 'snapshot.dump'))).size,
        }),
      );
      for (const { rolname } of roles) {
        if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [rolname])).rowCount)
          await admin.query(
            `CREATE ROLE ${qi(rolname)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
          );
      }
      for (const membership of roleMemberships) {
        if (membership.role.startsWith('pl_') && membership.member.startsWith('pl_'))
          await admin.query(`GRANT ${qi(membership.role)} TO ${qi(membership.member)}`);
      }
      await admin.query(`CREATE DATABASE ${qi(database)} OWNER pl_admin TEMPLATE template0`);
    } finally {
      await admin.end();
      await source.end().catch(() => {});
    }
  } else {
    manifest = JSON.parse(await readFile(join(output, 'source-manifest.json'), 'utf8'));
    if (manifest.database !== database || manifest.port !== runtime.port)
      throw Error('RESUME_TARGET_MISMATCH');
  }
  const empty = local(database);
  await empty.connect();
  try {
    const existing = (
      await empty.query(
        "SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema IN('public','parallel_life') AND table_type='BASE TABLE'",
      )
    ).rows[0].count;
    if (existing !== 0) throw Error('RESTORE_TARGET_NOT_EMPTY_WILL_NOT_OVERWRITE');
    await empty.query('DROP SCHEMA IF EXISTS public');
  } finally {
    await empty.end();
  }
  await runPg(
    'pg_restore',
    ['--exit-on-error', '--no-owner', '--dbname=' + database, join(output, 'snapshot.dump')],
    {
      PGHOST: '127.0.0.1',
      PGPORT: String(runtime.port),
      PGUSER: 'pl_admin',
      PGPASSWORD: runtime.adminPassword,
      PGSSLMODE: 'disable',
    },
  );
  await localDb.connect();
  await localDb.query("SET TIME ZONE 'UTC'");
  const restored = await fingerprint(localDb, manifest.tables);
  if (JSON.stringify(restored) !== JSON.stringify(manifest.fingerprints))
    throw Error('RESTORE_FINGERPRINT_MISMATCH');
  await writeJson('restore-verification.json', {
    checkedAt: new Date().toISOString(),
    tables: restored.length,
    allCountsAndContentSumsMatch: true,
    fingerprints: restored,
  });
  const queued = (
    await localDb.query(
      'SELECT id,scope_kind,status,error_code FROM parallel_life.tasks ORDER BY created_at',
    )
  ).rows;
  const outbox = (
    await localDb.query('SELECT id,status FROM parallel_life.outbox_jobs ORDER BY id')
  ).rows;
  await writeJson('pending-work-before-quarantine.json', { queued, outbox });
  const clockState = (
    await localDb.query(
      'SELECT world_id,owner_id,paused,active_until FROM parallel_life.world_clock ORDER BY world_id',
    )
  ).rows;
  await writeJson('worker-exclusions.json', {
    schemaVersion: 1,
    target: { host: '127.0.0.1', port: runtime.port, database },
    capturedAt: manifest.capturedAt,
    excludedTaskIds: queued.map((x) => x.id),
    excludedOutboxIds: outbox.map((x) => x.id),
    preserveUnknown: true,
  });
  await writeJson('world-clock-before-pause.json', clockState);
  // Existing task and outbox rows retain their original state. The local-only
  // worker must load worker-exclusions.json before accepting new work.
  const clocks = await localDb.query(
    'UPDATE parallel_life.world_clock SET paused=true,active_until=NULL RETURNING world_id',
  );
  await writeJson('quarantine.json', {
    mode: 'worker_exclusions',
    taskStatesUntouched: true,
    outboxStatesUntouched: true,
    clocksPaused: clocks.rowCount,
    unknownUntouched: true,
  });
  await localDb.end();
} else {
  manifest = JSON.parse(await readFile(join(output, 'source-manifest.json'), 'utf8'));
  if (manifest.database !== database || manifest.port !== runtime.port)
    throw Error('RESUME_TARGET_MISMATCH');
}
const assetDirs = {
  'private-assets': join(output, 'assets'),
  'publication-media': join(output, 'assets', 'publication-media'),
};
const key = sourceEnv.SUPABASE_SECRET_KEY || sourceEnv.SUPABASE_SERVICE_ROLE_KEY;
const storageBase = new URL('/storage/v1/object/authenticated/', sourceEnv.SUPABASE_URL).href;
const results = [],
  failures = [];
let storageRestricted = await readFile(join(output, 'storage-blocker.json'), 'utf8').then(
  (s) => JSON.parse(s).status === 402,
  () => false,
);
let index = 0;
async function download() {
  while (index < manifest.storageObjects.length) {
    const object = manifest.storageObjects[index++];
    if (!assetDirs[object.bucket_id]) throw Error('UNEXPECTED_BUCKET');
    const relative =
      object.bucket_id === 'private-assets' && object.name.startsWith('assets/')
        ? object.name.slice(7)
        : object.name;
    if (!relative || relative.split('/').some((p) => p === '..' || p === '.' || !p))
      throw Error('INVALID_OBJECT_PATH');
    const file = join(assetDirs[object.bucket_id], relative);
    try {
      let bytes;
      try {
        bytes = await readFile(file);
        if (bytes.length !== Number(object.bytes)) bytes = undefined;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!bytes) {
        if (storageRestricted) throw Error('STORAGE_RESTRICTED_402');
        const response = await fetch(
          storageBase +
            encodeURIComponent(object.bucket_id) +
            '/' +
            object.name.split('/').map(encodeURIComponent).join('/'),
          {
            headers: { apikey: key, Authorization: 'Bearer ' + key },
            signal: AbortSignal.timeout(120000),
            redirect: 'error',
          },
        );
        if (response.status === 402) storageRestricted = true;
        if (!response.ok) throw Error('ASSET_HTTP_' + response.status);
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== Number(object.bytes)) throw Error('ASSET_SIZE_MISMATCH');
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(file + '.part', bytes, { mode: 0o600 });
        await rename(file + '.part', file);
      }
      results.push({
        bucket: object.bucket_id,
        key: object.name,
        bytes: bytes.length,
        sha256: sha(bytes),
      });
      if (results.length % 25 === 0)
        console.log(
          JSON.stringify({
            phase: 'assets',
            completed: results.length,
            total: manifest.storageObjects.length,
          }),
        );
    } catch (error) {
      failures.push({ bucket: object.bucket_id, key: object.name, code: error.message });
    }
  }
}
await Promise.all([download(), download(), download(), download()]);
await writeJson('asset-manifest.json', {
  capturedAt: new Date().toISOString(),
  completed: results.length,
  bytes: results.reduce((s, x) => s + x.bytes, 0),
  results: results.sort((a, b) => (a.bucket + a.key).localeCompare(b.bucket + b.key)),
  failures,
});
// An incomplete material clone remains explicit; its local database can still be
// inspected without a remote fallback. Integration must report this limitation.
// Build a server-only candidate. Integration owner decides when to switch ports.
const prior = JSON.parse(await readFile(join(root, '.local/local-play/env.json'), 'utf8'));
const candidate = { ...prior };
for (const k of Object.keys(candidate))
  if (k.startsWith('SUPABASE_') || k.startsWith('BLOB_') || k.startsWith('VERCEL'))
    delete candidate[k];
const localUrl = (role, password) =>
  `postgresql://${role}:${encodeURIComponent(password)}@127.0.0.1:${runtime.port}/${database}`;
candidate.DATABASE_URL = candidate.APP_DATABASE_URL = localUrl('pl_app', runtime.appPassword);
candidate.WORKER_DATABASE_URL = localUrl('pl_worker', runtime.workerPassword);
candidate.SCHEDULER_DATABASE_URL = localUrl('pl_scheduler', runtime.schedulerPassword);
if (localEnv.PUBLISHER_DATABASE_URL) {
  const u = new URL(localEnv.PUBLISHER_DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname))
    throw Error('LOCAL_PUBLISHER_ROLE_CONFIG_REQUIRED');
  u.pathname = '/' + database;
  candidate.PUBLISHER_DATABASE_URL = u.href;
}
candidate.PRIVATE_ASSET_DIR = assetDirs['private-assets'];
candidate.APP_ORIGIN = 'http://play.localhost:3218';
await writeJson('candidate-env.json', candidate);
console.log(
  JSON.stringify({
    phase: 'clone_ready_for_integration',
    database,
    port: runtime.port,
    assets: results.length,
    bytes: results.reduce((s, x) => s + x.bytes, 0),
    candidateEnv: join(output, 'candidate-env.json'),
    schedulingPaused: true,
    assetsComplete: failures.length === 0,
    missingAssets: failures.length,
  }),
);

if (failures.length) process.exitCode = 2;
