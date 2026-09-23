// Prepares a database for CI: creates the two restricted runtime roles and the
// dev/test databases on a PostgreSQL service, then writes the ignored local
// config the test suite reads. Never prints or commits credentials.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const dryRun = process.argv.includes('--dry-run');
const root = path.resolve(import.meta.dirname, '..');
const runtimeFile = path.join(root, '.local/runtime.json');
const host = process.env.PGHOST ?? '127.0.0.1';
const port = Number(process.env.PGPORT ?? 55432);
const adminUser = process.env.PGUSER ?? 'pl_admin';
const adminPassword = process.env.PGPASSWORD ?? '';

const config = await readFile(runtimeFile, 'utf8')
  .then((raw) => JSON.parse(raw))
  .catch(() => ({
    port,
    adminPassword: adminPassword || randomBytes(24).toString('hex'),
    appPassword: randomBytes(24).toString('hex'),
    workerPassword: randomBytes(24).toString('hex'),
    sessionSecret: randomBytes(32).toString('hex'),
  }));
config.port = port;
if (adminPassword) config.adminPassword = adminPassword;

const statements = [
  `CREATE ROLE pl_app LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
  `CREATE ROLE pl_worker LOGIN PASSWORD '${config.workerPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
  'CREATE DATABASE parallel_life_dev',
  'CREATE DATABASE parallel_life_test',
];

if (dryRun) {
  console.log(`Would connect to ${host}:${port} as ${adminUser} and ensure:`);
  for (const statement of statements)
    console.log('  -', statement.replace(/PASSWORD '[^']*'/, "PASSWORD '<hidden>'"));
  console.log(`Would write ${path.relative(root, runtimeFile)} (no secrets printed).`);
  process.exit(0);
}

if (!adminPassword) {
  console.error('PGPASSWORD is required (the PostgreSQL service password).');
  process.exit(1);
}

const client = new pg.Client({
  host,
  port,
  user: adminUser,
  password: adminPassword,
  database: 'postgres',
});
await client.connect();
for (const name of ['pl_app', 'pl_worker']) {
  const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])).rowCount;
  if (exists) continue;
  const password = name === 'pl_app' ? config.appPassword : config.workerPassword;
  await client.query(
    `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
  );
  console.log(`created role ${name}`);
}
for (const name of ['parallel_life_dev', 'parallel_life_test']) {
  const exists = (await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]))
    .rowCount;
  if (exists) continue;
  await client.query(`CREATE DATABASE ${name}`);
  console.log(`created database ${name}`);
}
await client.end();
await mkdir(path.dirname(runtimeFile), { recursive: true, mode: 0o700 });
await writeFile(runtimeFile, JSON.stringify(config), { mode: 0o600 });
console.log(`CI database ready on ${host}:${port}; wrote ${path.relative(root, runtimeFile)}.`);
