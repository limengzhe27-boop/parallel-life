import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateDiskStore } from '../src/modules/media/infrastructure/private-disk-store.ts';
import { LocalFirstAssetStore } from '../src/modules/media/infrastructure/local-first-asset-store.ts';

test('local writes and reads survive cloud quota; historical misses use original cloud key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'local-assets-'));
  let remoteReads = 0;
  const remote = {
    async put() {
      throw Error('CLOUD_QUOTA');
    },
    async get(key: string) {
      remoteReads++;
      return Buffer.from(key);
    },
    async remove() {},
  };
  try {
    const disk = new PrivateDiskStore(dir);
    const store = new LocalFirstAssetStore(disk, remote);
    const key = '11111111-1111-4111-8111-111111111111.webp';
    await store.put(key, Buffer.from('real bytes'));
    assert.equal((await store.get(key)).toString(), 'real bytes');
    assert.equal(remoteReads, 0);
    await assert.rejects(store.put(key, Buffer.from('overwrite')), { code: 'EEXIST' });
    const oldKey = '22222222-2222-4222-8222-222222222222.webp';
    assert.equal((await store.get(oldKey)).toString(), oldKey);
    assert.equal(remoteReads, 1);
    await assert.rejects(store.get('../private.env'), /INVALID_STORAGE_KEY/);
    assert.equal(remoteReads, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('disk failures do not silently send local-only bytes to cloud', async () => {
  let calls = 0;
  const fail = async (): Promise<never> => {
    throw Object.assign(Error('disk failure'), { code: 'EACCES' });
  };
  const store = new LocalFirstAssetStore(
    { put: fail, get: fail, remove: fail },
    {
      async put() {
        calls++;
      },
      async get() {
        calls++;
        return Buffer.alloc(0);
      },
      async remove() {
        calls++;
      },
    },
  );
  await assert.rejects(store.get('key'), { code: 'EACCES' });
  await assert.rejects(store.put('key', Buffer.alloc(1)), { code: 'EACCES' });
  assert.equal(calls, 0);
});
