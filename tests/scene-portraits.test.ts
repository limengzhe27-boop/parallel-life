import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PUBLICATION_ART } from '../src/contracts/publication-assets.ts';
import type { SceneRead } from '../src/contracts/scenes.ts';
import type { PhoneContact } from '../src/features/phone/apps/types.ts';
import { scenePortraits } from '../src/features/phone/scenes/stage-presentation.ts';
const worldId = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
function scene(): SceneRead {
  return {
    worldVersion: 2,
    entries: [],
    scene: {
      worldId,
      presence: [{ participant: { kind: 'actor', actorId }, joinedVersion: 1, sourceVersion: 1 }],
    },
  } as unknown as SceneRead;
}
const contact: PhoneContact = {
  id: actorId,
  name: '任何显示姓名',
  relationship: '朋友',
  unread: 0,
  avatarUrl: PUBLICATION_ART[0]!.url,
  avatarKind: 'publication-art',
};
test('scene portrait requires exact registered visual identity and actual presence, never a name match', () => {
  const read = scene();
  assert.equal(scenePortraits(read, [contact])[0]?.url, PUBLICATION_ART[0]!.scenePortrait?.url);
  assert.deepEqual(
    scenePortraits(read, [{ ...contact, avatarUrl: '/custom-person.png', name: '青青' }]),
    [],
  );
  assert.deepEqual(scenePortraits(read, [{ ...contact, avatarKind: 'authorized-photo' }]), []);
  assert.deepEqual(
    scenePortraits({ ...read, scene: { ...read.scene!, presence: [] } }, [contact]),
    [],
  );
  assert.deepEqual(scenePortraits(read, []), []);
});
test('an authorized per-actor upload overrides curated cutout, cross-world URLs do not', () => {
  const url = `/api/v1/worlds/${worldId}/media/10000000-0000-4000-8000-000000000003`;
  const read = { ...scene(), actorImages: [{ actorId, url }] };
  assert.equal(scenePortraits(read, [contact])[0]?.url, url);
  assert.equal(
    scenePortraits({ ...read, actorImages: [{ actorId, url: url.replace(worldId, actorId) }] }, [
      contact,
    ])[0]?.url,
    PUBLICATION_ART[0]!.scenePortrait?.url,
  );
  assert.equal(
    scenePortraits({ ...read, actorImages: [{ actorId: 'other', url }] }, [contact])[0]?.url,
    PUBLICATION_ART[0]!.scenePortrait?.url,
  );
  assert.deepEqual(
    scenePortraits({ ...read, scene: { ...read.scene!, presence: [] } }, [contact]),
    [],
  );
});
test('registered scene images have immutable matching hashes and actual transparent alpha', async () => {
  const portraits = PUBLICATION_ART.filter((art) => art.scenePortrait);
  assert.equal(portraits.length, 6);
  for (const art of portraits) {
    const bytes = await readFile(new URL('../public' + art.scenePortrait!.url, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), art.scenePortrait!.sha256);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.hasAlpha, true);
    const stats = await sharp(bytes).stats();
    assert.equal(stats.channels[3]?.min, 0);
    assert.equal(stats.channels[3]?.max, 255);
  }
});
