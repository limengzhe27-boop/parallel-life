// Explicit recovery only. Default dry-run: no cloud requests/writes, no model calls.
// node --experimental-strip-types scripts/sync-publication-assets.mjs ENV_JSON [--apply]
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PostgresDatabase } from '../src/modules/storage/infrastructure/postgres.ts';
import { PrivateDiskStore } from '../src/modules/media/infrastructure/private-disk-store.ts';
import { parsePublisherPrincipals } from '../src/modules/identity/infrastructure/publisher-session.ts';
const [envFile, mode] = process.argv.slice(2);
if (!envFile || (mode && mode !== '--apply')) throw Error('ENV_JSON [--apply] required');
const env = JSON.parse(await readFile(envFile, 'utf8'));
if (!env.PRIVATE_ASSET_DIR || !env.PUBLISHER_DATABASE_URL)
  throw Error('LOCAL_PUBLICATION_STORAGE_REQUIRED');
const login = new URL(env.PUBLISHER_DATABASE_URL);
if (decodeURIComponent(login.username).split('.')[0] !== 'pl_publisher_login')
  throw Error('PUBLISHER_ROLE_REQUIRED');
const db = new PostgresDatabase(env.PUBLISHER_DATABASE_URL);
const root = resolve(env.PRIVATE_ASSET_DIR, 'publication-media');
const disk = new PrivateDiskStore(root);
const hash = (b) => createHash('sha256').update(b).digest('hex');
async function files(dir, prefix = '') {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const e of entries) {
    const key = prefix + e.name;
    if (e.isDirectory()) out.push(...(await files(join(dir, e.name), key + '/')));
    else if (e.isFile()) out.push(key);
  }
  return out;
}
// Principal is an explicit enabled editor from the existing server configuration,
// never a fabricated identity or administrator role.
const principals = parsePublisherPrincipals(JSON.parse(env.PUBLISHER_PRINCIPALS || '[]'));
const principal = principals.find((p) => p.enabled && p.permissions.includes('edit'))?.id;
if (!principal) throw Error('PUBLISHER_PRINCIPAL_REQUIRED');
try {
  for (const key of await files(root)) {
    if (!/^works\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|mp4)$/.test(key)) continue;
    const row = await db.transaction(principal, async (sql) => {
      await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [principal]);
      await sql.query("SELECT parallel_life.publisher_lock_permission('edit')");
      return (
        await sql.query(
          "SELECT id,byte_length,mime_type FROM parallel_life.publication_media_assets WHERE storage_key=$1 AND status='ready'",
          [key],
        )
      ).rows[0];
    });
    if (!row) {
      console.log(JSON.stringify({ key, status: 'skipped_unregistered_or_pending' }));
      continue;
    }
    const bytes = await disk.get(key);
    if (bytes.length !== Number(row.byte_length)) throw Error('LOCAL_SIZE_MISMATCH');
    if (mode !== '--apply') {
      console.log(
        JSON.stringify({ key, status: 'eligible', bytes: bytes.length, sha256: hash(bytes) }),
      );
      continue;
    }
    const origin = new URL(env.SUPABASE_URL);
    if (origin.protocol !== 'https:') throw Error('SUPABASE_HTTPS_REQUIRED');
    const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw Error('STORAGE_CREDENTIAL_REQUIRED');
    const headers = { apikey: secret, Authorization: `Bearer ${secret}` };
    const base = origin.origin + '/storage/v1/object/';
    async function remote() {
      const r = await fetch(base + 'authenticated/publication-media/' + key, {
        headers,
        signal: AbortSignal.timeout(30000),
      });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      let b;
      try {
        b = await r.json();
      } catch {}
      if (r.status === 404 || (r.status === 400 && String(b?.statusCode) === '404')) return null;
      throw Error('REMOTE_READ_HTTP_' + r.status);
    }
    const previous = await remote();
    if (previous && hash(previous) !== hash(bytes)) throw Error('REMOTE_CONTENT_CONFLICT');
    if (!previous) {
      const r = await fetch(base + 'publication-media/' + key, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': row.mime_type, 'x-upsert': 'false' },
        body: bytes,
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error('REMOTE_WRITE_HTTP_' + r.status);
      const saved = await remote();
      if (!saved || hash(saved) !== hash(bytes)) throw Error('REMOTE_VERIFY_FAILED');
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
