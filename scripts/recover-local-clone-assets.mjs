/** Recover exact authorized object bytes from explicit project/worktree caches.
 * Requires source storage eTag MD5 AND exact byte length; never substitutes art.
 * node scripts/recover-local-clone-assets.mjs MAIN_ROOT CLONE_DIRECTORY [WORKTREE_CACHE]
 * No network, model calls, source database writes, or public asset publication.
 */
import { readFile, readdir, stat, writeFile, mkdir, copyFile, chmod } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const [rootArg, dirArg, worktreeArg] = process.argv.slice(2);
const root = rootArg ? resolve(rootArg) : '';
const dir = dirArg ? resolve(dirArg) : '';
const worktreeCache = worktreeArg ? resolve(worktreeArg) : undefined;
if (!root || !dir || !dir.startsWith(root + '/.local/'))
  throw Error('EXPLICIT_MAIN_AND_IGNORED_CLONE_DIRECTORY_REQUIRED');
const manifest = JSON.parse(await readFile(dir + '/source-manifest.json', 'utf8'));
const m = await readFile(dir + '/storage-content-tags.json', 'utf8').then(
  JSON.parse,
  () => manifest.storageObjects,
);
for (const x of m) {
  if (
    !['private-assets', 'publication-media'].includes(x.bucket_id) ||
    x.name.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw Error('INVALID_STORAGE_OBJECT');
  x.md5 = x.etag?.replaceAll('"', '');
}
const wanted = new Map();
for (const x of m) {
  const n = Number(x.bytes);
  if (!wanted.has(n)) wanted.set(n, []);
  wanted.get(n).push(x);
}
const found = new Map();
let scanned = 0,
  hashed = 0;
async function walk(d) {
  for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
    if (e.isSymbolicLink()) continue;
    const p = join(d, e.name);
    if (e.isDirectory()) {
      if (p === dir || ['node_modules', '.git', '.next', 'postgres'].includes(e.name)) continue;
      await walk(p);
    } else if (e.isFile()) {
      scanned++;
      const size = (await stat(p)).size;
      const targets = wanted.get(size)?.filter((o) => !found.has(o.bucket_id + '/' + o.name));
      if (!targets?.length) continue;
      const bytes = await readFile(p);
      hashed++;
      const hash = createHash('md5').update(bytes).digest('hex');
      for (const o of targets) {
        if (o.md5 !== hash) continue;
        const k = o.bucket_id + '/' + o.name;
        found.set(k, { ...o, path: p, sha256: createHash('sha256').update(bytes).digest('hex') });
        const rel =
          o.bucket_id === 'private-assets'
            ? o.name.replace(/^assets\//, '')
            : join('publication-media', o.name);
        const target = join(dir, 'assets', rel);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(p, target);
        await chmod(target, 0o600);
      }
    }
  }
}
await walk(root + '/.local');
await walk(root + '/public');
if (worktreeCache) await walk(worktreeCache);
await writeFile(dir + '/existing-asset-copies.json', JSON.stringify([...found.values()], null, 2), {
  mode: 0o600,
});
console.log({
  scanned,
  hashed,
  found: found.size,
  total: m.length,
  buckets: [...found.values()].reduce(
    (a, o) => ((a[o.bucket_id] = (a[o.bucket_id] || 0) + 1), a),
    {},
  ),
});
