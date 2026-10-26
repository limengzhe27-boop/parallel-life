import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  LocalFirstPublicationMediaStore,
  publicationLocalStorageEnabled,
} from '../src/modules/media/infrastructure/local-first-publication-media-store.ts';
import { PublisherClient } from '../src/features/publisher/publisher-client.ts';

test('local publication storage requires explicit loopback and never overwrites existing bytes', async (t) => {
  for (const origin of [
    'http://localhost:3218',
    'http://127.0.0.1:3218',
    'http://play.localhost:3218',
    'http://[::1]:3218',
  ])
    assert.equal(publicationLocalStorageEnabled({ origin, directory: '/private' }), true);
  for (const config of [
    { origin: 'https://example.com', directory: '/private' },
    { origin: 'http://localhost', directory: '/private', vercel: '1' },
    { origin: 'http://localhost' },
    { origin: 'file:///tmp', directory: '/private' },
  ])
    assert.equal(publicationLocalStorageEnabled(config), false);
  const dir = await mkdtemp(join(tmpdir(), 'publication-local-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const work = randomUUID(),
    asset = randomUUID(),
    key = `works/${work}/${asset}.png`;
  let remoteCalls = 0;
  const storage = new LocalFirstPublicationMediaStore(dir, {
    async signUpload() {
      throw Error('unused');
    },
    async inspect() {
      remoteCalls++;
      return { byteLength: 99, mimeType: 'image/png', header: new Uint8Array() };
    },
    async signRead() {
      remoteCalls++;
      return 'https://private.example/signed';
    },
  });
  assert.equal(
    (await storage.signUpload(key)).uploadUrl,
    `/api/v1/publisher/works/${work}/media/${asset}/content`,
  );
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  await storage.put(key, bytes);
  await storage.put(key, bytes);
  await assert.rejects(storage.put(key, Buffer.from('different')), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  assert.deepEqual(await storage.readStored(key), bytes);
  assert.equal((await storage.inspect(key)).byteLength, bytes.length);
  assert.equal(remoteCalls, 0);
  assert.equal(await storage.readStored(`works/${work}/${randomUUID()}.png`), undefined);
  await storage.inspect(`works/${work}/${randomUUID()}.png`);
  assert.equal(remoteCalls, 1);
  await assert.rejects(storage.readStored('../outside.png'), { code: 'INVALID_INPUT' });
});

test('publisher upload only accepts its exact local path and includes session CSRF', async () => {
  const work = randomUUID(),
    asset = randomUUID(),
    csrf = 'a'.repeat(43);
  const calls: { url: string; init?: RequestInit }[] = [];
  const localPath = `/api/v1/publisher/works/${work}/media/${asset}/content`;
  const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
  let wrong = false;
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/session'))
      return Response.json({
        publisher: {
          id: randomUUID(),
          username: 'tester',
          displayName: '测试',
          permissions: ['edit'],
        },
        csrfToken: csrf,
      });
    if (url.endsWith('/finalize'))
      return Response.json({ assetId: asset, kind: 'image', mimeType: 'image/png', byteLength: 3 });
    if (init?.method === 'PUT') return Response.json({ assetId: asset }, { status: 201 });
    return Response.json({
      assetId: asset,
      kind: 'image',
      mimeType: 'image/png',
      byteLength: 3,
      uploadUrl: wrong ? localPath.replace(work, randomUUID()) : localPath,
      uploadToken: 'local-session',
    });
  };
  const client = new PublisherClient(transport);
  await client.session();
  await client.uploadWorkMedia(work, file);
  const upload = calls.find((c) => c.init?.method === 'PUT')!;
  assert.equal(upload.url, localPath);
  assert.equal(upload.init?.credentials, 'same-origin');
  assert.equal(new Headers(upload.init?.headers).get('X-Publisher-CSRF'), csrf);
  wrong = true;
  const before = calls.filter((c) => c.init?.method === 'PUT').length;
  await assert.rejects(client.uploadWorkMedia(work, file));
  assert.equal(calls.filter((c) => c.init?.method === 'PUT').length, before);
});
