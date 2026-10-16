import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PublishedWorldContentSchema } from '../src/contracts/published-world-content.ts';
import { publicationReview } from '../src/server/publication-runtime.ts';

const workId = '11111111-1111-4111-8111-111111111111';
const receiptId = '22222222-2222-4222-8222-222222222222';
test('optional trial policy and persisted trial evidence stay distinct', async () => {
  const source = await readFile(
    new URL('../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const content = PublishedWorldContentSchema.parse(
    JSON.parse(/```json\n([\s\S]*?)\n```/.exec(source)![1]!),
  );
  const input = { workId, draftVersion: 5, contentHash: 'a'.repeat(64), content };
  const before = structuredClone(input);
  for (const [raw, expected] of [
    [
      { verified: false, receiptId: null },
      { verified: false, receiptId: null },
    ],
    [
      { verified: false, receiptId },
      { verified: false, receiptId: null },
    ],
    [
      { verified: true, receiptId: null },
      { verified: false, receiptId: null },
    ],
    [
      { verified: true, receiptId },
      { verified: true, receiptId },
    ],
  ] as const) {
    let calls = 0;
    const result = await publicationReview(async (w, v, h) => {
      calls++;
      assert.deepEqual([w, v, h], [workId, 5, input.contentHash]);
      return raw;
    }).review(input);
    assert.equal(calls, 1);
    assert.equal(result.trialRequired, false);
    assert.deepEqual(result.trial, expected);
    assert.notEqual(result.trial.receiptId, workId);
    assert.deepEqual(input, before);
  }
  await assert.rejects(
    publicationReview(async () => {
      throw Error('EVIDENCE_UNAVAILABLE');
    }).review(input),
    /EVIDENCE_UNAVAILABLE/,
  );
});
