import test from 'node:test';
import assert from 'node:assert/strict';
import { manuscriptBatches } from '../src/features/publisher/publisher-manuscript-batches.ts';
import { PublisherPreparationMaterialSchema } from '../src/contracts/publisher-preparation.ts';
test('many manuscripts are partitioned without dropping documents, changing order or truncating text', () => {
  const files = Array.from({ length: 40 }, (_, i) => ({
    filename: `人物${i}.md`,
    content: '原稿'.repeat(1000),
  }));
  const result = manuscriptBatches(files, {});
  assert.ok(result.batches.length > 1);
  assert.equal(result.oversized.length, 0);
  assert.deepEqual(result.batches.flat(), files);
  for (const sources of result.batches)
    assert.ok(
      PublisherPreparationMaterialSchema.safeParse({ currentContent: {}, sources }).success,
    );
});
test('oversized single manuscript remains explicitly unprocessed; smaller neighbours stay available', () => {
  const huge = { filename: '大稿.md', content: '文'.repeat(100000) },
    small = { filename: '角色.md', content: '一位成年角色' };
  const result = manuscriptBatches([huge, small], {});
  assert.deepEqual(result.oversized, [huge]);
  assert.deepEqual(result.batches, [[small]]);
  assert.equal(result.oversized[0]!.content.length, 100000);
});
test('newly enlarged working draft causes a fresh capacity check before the next batch', () => {
  const file = { filename: '人物.md', content: '文稿'.repeat(5000) };
  assert.equal(manuscriptBatches([file], {}).batches.length, 1);
  const next = manuscriptBatches([file], { notes: '已有内容'.repeat(10000) });
  assert.deepEqual(next.oversized, [file]);
  assert.equal(next.batches.length, 0);
});
