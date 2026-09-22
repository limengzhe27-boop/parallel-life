import pg from 'pg';
import { localConfig } from './local-config.mjs';
export async function adminClient(database) {
  if (!['parallel_life_dev', 'parallel_life_test'].includes(database))
    throw Error('DEDICATED_LOCAL_DATABASE_REQUIRED');
  const config = await localConfig();
  const client = new pg.Client({
    host: '127.0.0.1',
    port: config.port,
    user: 'pl_admin',
    password: config.adminPassword,
    database,
  });
  await client.connect();
  return client;
}
