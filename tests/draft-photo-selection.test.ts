import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LifeDraft } from '../src/contracts/life-drafts.ts';
import type { ProfilePhotoRoles } from '../src/contracts/profile-photo-roles.ts';
import {
  optionalDraftPhotos,
  synchronizeDraftPhotos,
} from '../src/features/discovery/draft-photo-selection.ts';
const roles: ProfilePhotoRoles = {
  profileId: 'profile',
  profileVersion: 1,
  portraitAssetId: 'portrait',
  sharedAssetIds: ['portrait', 'reference', 'friend-a', 'friend-b'],
  referenceAssetIds: ['reference'],
  personAssets: [
    { personId: 'a', assetId: 'friend-a' },
    { personId: 'b', assetId: 'friend-b' },
  ],
};
const selection = (personIds: string[], assetIds: string[] = []): LifeDraft['selection'] => ({
  factIds: ['fact'],
  eventIds: ['event'],
  personIds,
  personRoles: personIds.map((personId) => ({ personId, role: '我的同伴' })),
  assetIds,
  portraitAssetId: assetIds.includes('portrait') ? 'portrait' : null,
});
test('optional photo choices never duplicate a friend photo, including accidental overlapping purposes', () => {
  assert.deepEqual(optionalDraftPhotos(roles), ['reference', 'portrait']);
  assert.deepEqual(optionalDraftPhotos(), []);
  assert.deepEqual(
    optionalDraftPhotos({ ...roles, referenceAssetIds: ['reference', 'friend-a'] }),
    ['reference', 'portrait'],
  );
});
test('selected friends automatically add current authorized pictures while preserving explicitly chosen own photos', () => {
  const original = selection(['a'], ['reference', 'portrait', 'friend-b', 'unavailable']);
  const result = synchronizeDraftPhotos(original, roles);
  assert.deepEqual(result.assetIds, ['reference', 'portrait', 'friend-a']);
  assert.equal(result.portraitAssetId, 'portrait');
  assert.deepEqual(result.factIds, original.factIds);
  assert.deepEqual(result.eventIds, original.eventIds);
  assert.deepEqual(result.personRoles, original.personRoles);
  assert.deepEqual(original.assetIds, ['reference', 'portrait', 'friend-b', 'unavailable']);
});
test('rereading new purposes replaces selected friend pictures instead of only filtering old ones', () => {
  const previous = synchronizeDraftPhotos(selection(['a'], ['reference', 'portrait']), roles);
  const changed = {
    ...roles,
    profileVersion: 2,
    personAssets: [{ personId: 'a', assetId: 'replacement' }, roles.personAssets[1]!],
  };
  const next = synchronizeDraftPhotos(previous, changed);
  assert.deepEqual(next.assetIds, ['reference', 'portrait', 'replacement']);
  assert.equal(next.portraitAssetId, 'portrait');
});
test('a shared friend picture stays until the last referencing selected person is removed', () => {
  const shared = {
    ...roles,
    personAssets: [
      { personId: 'a', assetId: 'shared' },
      { personId: 'b', assetId: 'shared' },
    ],
  };
  const both = synchronizeDraftPhotos(selection(['a', 'b'], ['reference']), shared);
  assert.deepEqual(both.assetIds, ['reference', 'shared']);
  const one = synchronizeDraftPhotos(
    { ...both, personIds: ['b'], personRoles: [{ personId: 'b', role: '朋友' }] },
    shared,
  );
  assert.deepEqual(one.assetIds, ['reference', 'shared']);
  const none = synchronizeDraftPhotos({ ...one, personIds: [], personRoles: [] }, shared);
  assert.deepEqual(none.assetIds, ['reference']);
});
test('people without photos remain selected and there is no implicit own portrait selection', () => {
  const noPhotos = { ...roles, personAssets: [] };
  const original = selection(
    Array.from({ length: 8 }, (_, i) => `person-${i}`),
    ['reference'],
  );
  const next = synchronizeDraftPhotos(original, noPhotos);
  assert.equal(next.personIds.length, 8);
  assert.deepEqual(next.assetIds, ['reference']);
  assert.equal(next.portraitAssetId, null);
});
test('stable rereads are idempotent; an unavailable own portrait is cleared without replacing it implicitly', () => {
  const once = synchronizeDraftPhotos(selection(['a'], ['portrait']), roles);
  assert.equal(synchronizeDraftPhotos(once, roles), once);
  const next = synchronizeDraftPhotos(once, { ...roles, portraitAssetId: null });
  assert.deepEqual(next.assetIds, ['friend-a']);
  assert.equal(next.portraitAssetId, null);
});
