import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  PUBLICATION_ART,
  PublicationAssetUrlSchema,
  publicationArt,
} from '../src/contracts/publication-assets.ts';
import {
  selectPublisherArt,
  publisherArtUrl,
} from '../src/features/publisher/publisher-art-model.ts';

const descriptor = (key = 'qingqing') => ({
  key,
  asset: { namespace: 'publication', key, revision: 1 },
  use: 'avatar',
  depiction: 'generated_image',
  label: '原创形象',
  visibility: { kind: 'world' },
});
test('every curated publication image exists and matches its immutable hash', async () => {
  assert.equal(new Set(PUBLICATION_ART.map((a) => a.key)).size, PUBLICATION_ART.length);
  for (const a of PUBLICATION_ART) {
    PublicationAssetUrlSchema.parse(a.url);
    const bytes = await readFile(new URL('../public' + a.url, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), a.sha256);
    assert.ok(a.url.includes(a.sha256.slice(0, 16)));
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  }
});
test('private assets, unknown revisions, wrong use and foreign URLs never resolve', () => {
  const m = descriptor();
  assert.equal(publicationArt(m, 'avatar')?.key, 'qingqing');
  for (const changed of [
    { ...m, asset: { ...m.asset, namespace: 'user' } },
    { ...m, asset: { ...m.asset, revision: 2 } },
    { ...m, visibility: { kind: 'player' } },
    { ...m, depiction: 'uploaded_photo' },
    { ...m, use: 'scene' },
  ])
    assert.equal(publicationArt(changed, 'avatar'), null);
  assert.equal(publicationArt(m, 'cover'), null);
  assert.equal(
    PublicationAssetUrlSchema.safeParse('https://foreign.example/avatar.webp').success,
    false,
  );
});
test('asset resolver does not execute inherited or own getters', () => {
  let reads = 0;
  const m = descriptor();
  Object.defineProperty(m, 'asset', {
    get() {
      reads++;
      throw Error('getter');
    },
  });
  assert.equal(publicationArt(m, 'avatar'), null);
  assert.equal(publicationArt(Object.create(descriptor()), 'avatar'), null);
  const nested = descriptor();
  Object.defineProperty(nested.asset, 'key', {
    get() {
      reads++;
      return 'qingqing';
    },
  });
  assert.equal(publicationArt(nested, 'avatar'), null);
  assert.equal(reads, 0);
});
test('explicit avatar selection preserves other people, unknown fields and source input', () => {
  const original = {
    work: { title: '稿', extra: 'kept' },
    actors: [
      { key: 'a', publicCard: { identity: '甲', custom: { x: 1 } } },
      { key: 'b', publicCard: { identity: '乙' } },
    ],
    media: [],
    extension: { unknown: true },
  };
  const before = structuredClone(original),
    next = selectPublisherArt(original, 'avatar', 'qingqing', 'a');
  assert.deepEqual(original, before);
  assert.deepEqual((next.actors as typeof original.actors)[1], original.actors[1]);
  assert.deepEqual(next.extension, original.extension);
  assert.equal(publisherArtUrl(next, 'qingqing', 'avatar'), PUBLICATION_ART[0]!.url);
  const cleared = selectPublisherArt(next, 'avatar', '', 'a');
  assert.equal(
    (cleared.actors as { publicCard: Record<string, unknown> }[])[0]!.publicCard.avatarMediaKey,
    undefined,
  );
  assert.equal((cleared.media as unknown[]).length, 1);
  assert.throws(
    () => selectPublisherArt(original, 'avatar', 'missing', 'a'),
    /UNKNOWN_PUBLICATION_ART/,
  );
  assert.throws(
    () =>
      selectPublisherArt(
        { ...original, media: [{ key: 'qingqing', asset: { namespace: 'user' } }] },
        'avatar',
        'qingqing',
        'a',
      ),
    /MEDIA_KEY_CONFLICT/,
  );
});
