import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PublishedWorldStartRequestSchema,
  PublicationTrialStartRequestSchema,
  PublicationWorldResultSchema,
  PublicationOriginSchema,
} from '../src/contracts/publication-worlds.ts';
const commandId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base = { commandId, publicationVersion: 1 };
test('published start admits only command and exact positive publication version', () => {
  assert.deepEqual(PublishedWorldStartRequestSchema.parse(base), base);
  for (const publicationVersion of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(
      PublishedWorldStartRequestSchema.safeParse({ ...base, publicationVersion }).success,
      false,
    );
  for (const key of ['ownerId', 'principalId', 'compiled', 'approved', 'capabilities', 'trial'])
    assert.equal(
      PublishedWorldStartRequestSchema.safeParse({ ...base, [key]: true }).success,
      false,
    );
});
test('trial is bound to saved version and hash without client identity or runtime', () => {
  const input = { commandId, draftVersion: 0, contentHash: 'a'.repeat(64) };
  assert.deepEqual(PublicationTrialStartRequestSchema.parse(input), input);
  for (const contentHash of ['bad', 'A'.repeat(64), 'a'.repeat(63)])
    assert.equal(
      PublicationTrialStartRequestSchema.safeParse({ ...input, contentHash }).success,
      false,
    );
  assert.equal(
    PublicationTrialStartRequestSchema.safeParse({ ...input, ownerId: commandId }).success,
    false,
  );
});
test('origin has exact work/version/draft/hash and never an invented publicationId', () => {
  const origin = {
    workId: commandId,
    publicationVersion: 0,
    draftVersion: 0,
    contentHash: 'b'.repeat(64),
  };
  assert.deepEqual(PublicationOriginSchema.parse(origin), origin);
  assert.equal(
    PublicationOriginSchema.safeParse({ ...origin, publicationId: commandId }).success,
    false,
  );
  assert.equal(PublicationOriginSchema.safeParse({ ...origin, draftVersion: 1.5 }).success, false);
});
test('world receipt returns only the public binding not the runtime, private profile or raw draft', () => {
  const input = {
    worldId: commandId,
    seedId: commandId,
    origin: {
      workId: commandId,
      publicationVersion: 1,
      draftVersion: 0,
      contentHash: 'a'.repeat(64),
    },
    originKind: 'published_work',
    trialId: null,
    resumed: false,
    replayed: false,
  };
  assert.deepEqual(PublicationWorldResultSchema.parse(input), input);
  for (const key of ['content', 'world', 'opening', 'ownerId', 'interview'])
    assert.equal(PublicationWorldResultSchema.safeParse({ ...input, [key]: {} }).success, false);
});
