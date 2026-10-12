import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PublisherDraftContentSchema,
  PublisherCreateWorkSchema,
  PublisherSaveDraftSchema,
  PublisherCheckDraftSchema,
  PublisherPublishSchema,
  PublisherUnpublishSchema,
  PublisherRestoreSchema,
} from '../src/contracts/world-publisher.ts';

test('empty and incomplete private drafts preserve unknown schema/fields without pretending to execute', () => {
  for (const content of [
    {},
    { schemaVersion: 999, authorNote: '待完善' },
    { futureField: { unknown: true } },
  ])
    assert.deepEqual(PublisherDraftContentSchema.parse(content), content);
});
test('draft creation and save take no staff, permission or approved flags from body', () => {
  const commandId = randomUUID(),
    content = {};
  assert.ok(
    PublisherCreateWorkSchema.safeParse({ commandId, title: '未命名作品', content }).success,
  );
  assert.ok(
    PublisherSaveDraftSchema.safeParse({ commandId, expectedDraftVersion: 0, content }).success,
  );
  for (const field of ['principalId', 'ownerId', 'role', 'approved', 'supported', 'canPublish'])
    assert.equal(
      PublisherCreateWorkSchema.safeParse({ commandId, title: '作品', content, [field]: true })
        .success,
      false,
    );
});
test('private draft JSON rejects executable array prototypes before budget serialization', () => {
  let calls = 0;
  const array = ['data'];
  Object.setPrototypeOf(array, {
    toJSON() {
      calls++;
      return 'replacement';
    },
  });
  assert.equal(PublisherDraftContentSchema.safeParse({ array }).success, false);
  assert.equal(calls, 0);
});
test('draft content is an object and stays within pure JSON and byte budget', () => {
  for (const raw of [null, [], undefined, { x: () => {} }, { x: '字'.repeat(23000) }])
    assert.equal(PublisherDraftContentSchema.safeParse(raw).success, false);
});
test('public commands require distinct exact draft/meta and a server-issued check reference', () => {
  const commandId = randomUUID();
  assert.ok(PublisherCheckDraftSchema.safeParse({ commandId, expectedDraftVersion: 0 }).success);
  assert.ok(
    PublisherPublishSchema.safeParse({
      commandId,
      expectedDraftVersion: 1,
      expectedMetadataVersion: 2,
      checkId: randomUUID(),
    }).success,
  );
  assert.equal(
    PublisherPublishSchema.safeParse({
      commandId,
      expectedDraftVersion: 1,
      expectedMetadataVersion: 2,
      approved: true,
    }).success,
    false,
  );
  assert.ok(PublisherUnpublishSchema.safeParse({ commandId, expectedMetadataVersion: 0 }).success);
  assert.ok(
    PublisherRestoreSchema.safeParse({
      commandId,
      expectedMetadataVersion: 2,
      publicationVersion: 1,
    }).success,
  );
  assert.equal(
    PublisherRestoreSchema.safeParse({
      commandId,
      expectedMetadataVersion: 2,
      publicationVersion: 0,
    }).success,
    false,
  );
});
test('versions cannot be negative, fractional or unsafe and future commands cannot choose a final publication number', () => {
  for (const expectedDraftVersion of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(
      PublisherSaveDraftSchema.safeParse({
        commandId: randomUUID(),
        expectedDraftVersion,
        content: {},
      }).success,
      false,
    );
  assert.equal(
    PublisherPublishSchema.safeParse({
      commandId: randomUUID(),
      expectedDraftVersion: 0,
      expectedMetadataVersion: 0,
      checkId: randomUUID(),
      publicationVersion: 99,
    }).success,
    false,
  );
});
