import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = (name: string) => fileURLToPath(new URL('../scripts/' + name, import.meta.url));
test('clone refuses a production database name and output escaping the private directory before reading credentials', () => {
  for (const args of [
    [
      '--root',
      '/missing/main',
      '--output',
      '/missing/main/.local/clone',
      '--database',
      'parallel_life_dev',
    ],
    [
      '--root',
      '/missing/main',
      '--output',
      '/missing/main/.local/../public',
      '--database',
      'parallel_life_clone_test',
    ],
  ]) {
    const child = spawnSync(process.execPath, [script('local-runtime-clone.mjs'), ...args], {
      encoding: 'utf8',
    });
    assert.notEqual(child.status, 0);
    assert.match(
      child.stderr,
      /EXPLICIT_MAIN_ROOT_OUTPUT_AND_NEW_CLONE_DATABASE_REQUIRED|OUTPUT_MUST_BE_IGNORED_LOCAL_DIRECTORY/,
    );
    assert.doesNotMatch(child.stderr, /ENOENT/);
  }
});
test('cache recovery requires source content hash and size rather than a matching filename', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pl-clone-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const clone = join(root, '.local/clone');
  const cache = join(root, '.local/cache');
  await mkdir(clone, { recursive: true });
  await mkdir(cache, { recursive: true });
  const key = '12345678-1234-1234-1234-123456789012.webp';
  const correct = Buffer.from('exact-authorized-bytes');
  const wrong = Buffer.from('wrong-authorized-bytes');
  assert.equal(correct.length, wrong.length);
  await writeFile(join(cache, key), wrong);
  await writeFile(join(cache, 'original-scene.png'), correct);
  await writeFile(
    join(clone, 'source-manifest.json'),
    JSON.stringify({
      storageObjects: [
        {
          bucket_id: 'private-assets',
          name: 'assets/' + key,
          bytes: String(correct.length),
          etag: '"' + createHash('md5').update(correct).digest('hex') + '"',
        },
      ],
    }),
  );
  const child = spawnSync(
    process.execPath,
    [script('recover-local-clone-assets.mjs'), root, clone],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(await readFile(join(clone, 'assets', key)), correct);
  assert.deepEqual(await readFile(join(cache, key)), wrong);
  const manifest = JSON.parse(await readFile(join(clone, 'existing-asset-copies.json'), 'utf8'));
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].sha256, createHash('sha256').update(correct).digest('hex'));
});
