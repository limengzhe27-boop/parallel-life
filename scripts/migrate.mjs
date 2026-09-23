import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { adminClient } from './db-admin.mjs';
import { pathToFileURL } from 'node:url';
export async function migrate(client) {
  await client.query('SELECT pg_advisory_lock(82147201)');
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS public.pl_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())',
    );
    for (const name of (await readdir(new URL('../db/migrations/', import.meta.url)))
      .filter((x) => x.endsWith('.sql'))
      .sort()) {
      const sql = await readFile(new URL('../db/migrations/' + name, import.meta.url), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const row = (
        await client.query('SELECT checksum FROM public.pl_migrations WHERE name=$1', [name])
      ).rows[0];
      if (row) {
        if (row.checksum !== checksum) throw Error('APPLIED_MIGRATION_CHANGED: ' + name);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO public.pl_migrations(name,checksum) VALUES($1,$2)', [
          name,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(82147201)');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = await adminClient('parallel_life_dev');
  try {
    await migrate(client);
    console.log('Dedicated development database migrations applied.');
  } finally {
    await client.end();
  }
}
