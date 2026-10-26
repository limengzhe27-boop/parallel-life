// Explicit recovery utility. No model calls, database writes, deletions or cloud overwrites.
// node --experimental-strip-types scripts/sync-local-assets.mjs ENV_JSON OWNER_ID [--apply]
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { PostgresDatabase } from '../src/modules/storage/infrastructure/postgres.ts';
import { PrivateDiskStore } from '../src/modules/media/infrastructure/private-disk-store.ts';
const [envFile, ownerId, mode] = process.argv.slice(2);
if (!envFile || !ownerId || (mode && mode !== '--apply'))
  throw Error('ENV_JSON OWNER_ID [--apply] required');
const env = JSON.parse(await readFile(envFile, 'utf8'));
if (!env.PRIVATE_ASSET_DIR) throw Error('PRIVATE_ASSET_DIR required');
const db = new PostgresDatabase(env.APP_DATABASE_URL);
const disk = new PrivateDiskStore(env.PRIVATE_ASSET_DIR);
const base = new URL('/storage/v1/object/', env.SUPABASE_URL).href;
const bucket = env.SUPABASE_STORAGE_BUCKET || 'private-assets';
const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: secret, Authorization: `Bearer ${secret}` };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function files(dir, prefix = '') {
  const result = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const key = prefix + e.name;
    if (e.isDirectory()) result.push(...(await files(join(dir, e.name), key + '/')));
    else if (e.isFile()) result.push(key); // Never follow symlinks.
  }
  return result;
}
async function remoteBytes(key) {
  const r = await fetch(base + 'authenticated/' + bucket + '/assets/' + key, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (r.ok) return Buffer.from(await r.arrayBuffer());
  let body;
  try {
    body = await r.json();
  } catch {}
  if (r.status === 404 || (r.status === 400 && String(body?.statusCode) === '404')) return null;
  throw Error('REMOTE_READ_HTTP_' + r.status);
}
try {
  const keys = await files(resolve(env.PRIVATE_ASSET_DIR));
  for (const key of keys) {
    const row = await db.transaction(
      ownerId,
      async (sql) =>
        (
          await sql.query(
            "SELECT id,byte_length,mime_type FROM parallel_life.assets WHERE owner_id=$1 AND storage_key=$2 AND status='ready'",
            [ownerId, key],
          )
        ).rows[0],
    );
    if (!row) {
      console.log(JSON.stringify({ key, status: 'skipped_unregistered_or_deleted' }));
      continue;
    }
    const bytes = await disk.get(key);
    if (bytes.length !== row.byte_length) throw Error('LOCAL_SIZE_MISMATCH');
    if (mode !== '--apply') {
      console.log(JSON.stringify({ key, status: 'eligible', bytes: bytes.length }));
      continue;
    }
    const previous = await remoteBytes(key);
    if (previous && hash(previous) !== hash(bytes)) throw Error('REMOTE_CONTENT_CONFLICT');
    if (!previous) {
      const r = await fetch(base + bucket + '/assets/' + key, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': row.mime_type, 'x-upsert': 'false' },
        body: bytes,
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error('REMOTE_WRITE_HTTP_' + r.status);
      const uploaded = await remoteBytes(key);
      if (!uploaded || hash(uploaded) !== hash(bytes)) throw Error('REMOTE_VERIFY_FAILED');
    }
    console.log(JSON.stringify({ key, status: previous ? 'already_synced' : 'synced_verified' }));
  }
} catch (e) {
  console.error(
    JSON.stringify({
      status: 'stopped',
      code: /^[A-Z_0-9]+$/.test(e.message) ? e.message : 'SYNC_FAILED',
      localFilesRetained: true,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
