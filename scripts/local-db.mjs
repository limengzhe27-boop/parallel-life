import EmbeddedPostgres from 'embedded-postgres';
import { access, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { localConfig, writeLocalEnv, root } from './local-config.mjs';
const config = await localConfig();
const databaseDir = path.join(root, '.local/postgres');
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: 'pl_admin',
  password: config.adminPassword,
  port: config.port,
  authMethod: 'scram-sha-256',
  persistent: true,
  postgresFlags: ['-h', '127.0.0.1', '-k', '/tmp'],
  onLog: () => {},
  onError: () => {},
});
try {
  await access(path.join(databaseDir, 'PG_VERSION'));
} catch {
  await postgres.initialise();
  // Require a password even on loopback and sockets; never expose to the LAN.
  await appendFile(path.join(databaseDir, 'postgresql.conf'), "\nlisten_addresses = '127.0.0.1'\n");
}
await postgres.start();
const client = postgres.getPgClient('postgres', '127.0.0.1');
await client.connect();
for (const name of ['parallel_life_dev', 'parallel_life_test']) {
  if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
    await client.query(`CREATE DATABASE ${name}`);
}
for (const [name, password] of [
  ['pl_app', config.appPassword],
  ['pl_worker', config.workerPassword],
]) {
  if (!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])).rowCount)
    await client.query(
      `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
}
const version = (await client.query('SHOW server_version')).rows[0].server_version;
await client.end();
await writeLocalEnv(config);
console.log(
  `Local PostgreSQL ${version} ready on 127.0.0.1:${config.port}. Separate dev/test databases; private assets outside public/.`,
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await postgres.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 60000);
