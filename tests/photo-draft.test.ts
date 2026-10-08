import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhotoDraft } from '../src/features/interview/photo-draft.ts';
import { ApiFailure } from '../src/features/api/client.ts';
test('replacement and cancellation discard only this editor’s new uploads, never old profile photos', async () => {
  const d = new PhotoDraft(),
    deleted: string[] = [];
  const c = {
    async discardUnusedUpload(id: string) {
      deleted.push(id);
    },
  };
  d.add('first');
  d.add('second');
  await d.discard(c, 'second');
  assert.deepEqual(deleted, ['first']);
  await d.discard(c);
  assert.deepEqual(deleted, ['first', 'second']);
  await d.discard(c);
  assert.equal(deleted.length, 2);
});
test('a confirmed save retains its picture while discarded replacements are cleaned', async () => {
  const d = new PhotoDraft(),
    deleted: string[] = [];
  d.add('saved');
  d.add('discarded');
  d.saved('saved');
  await d.discard({
    async discardUnusedUpload(id) {
      deleted.push(id);
    },
  });
  assert.deepEqual(deleted, ['discarded']);
});
test('failed cleanup retains ownership for an explicit retry', async () => {
  const d = new PhotoDraft();
  d.add('pending');
  let calls = 0;
  const c = {
    async discardUnusedUpload() {
      if (++calls === 1) throw new ApiFailure('UNAVAILABLE', '离线');
    },
  };
  await assert.rejects(d.discard(c));
  await d.discard(c);
  await d.discard(c);
  assert.equal(calls, 2);
});
test('a lost save response cannot cause removal of a referenced picture', async () => {
  const d = new PhotoDraft();
  d.add('late-save');
  let calls = 0;
  await d.discard({
    async discardUnusedUpload() {
      calls++;
      throw new ApiFailure('CONFLICT', '已经入档');
    },
  });
  await d.discard({
    async discardUnusedUpload() {
      throw Error('must not run');
    },
  });
  assert.equal(calls, 1);
});
