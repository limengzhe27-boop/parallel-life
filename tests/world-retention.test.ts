import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTS_BUDGET_CHARS, GENESIS_FACTS, retainFacts } from '../src/modules/world/domain/retention.ts';
import type { Fact } from '../src/modules/world/domain/types.ts';

const fact = (n: number, size = 100): Fact => ({
  id: `f${n}`,
  text: 'x'.repeat(size),
  visibility: { kind: 'world' },
  sourceEventId: `e${n}`,
});

test('a short list is returned untouched', () => {
  const facts = [fact(1), fact(2)];
  assert.deepEqual(retainFacts(facts), facts);
});

test('the budget keeps the genesis facts and the newest ones', () => {
  const facts = [fact(0), fact(1), ...Array.from({ length: 40 }, (_, i) => fact(i + 10, 3000))];
  const kept = retainFacts(facts, 12_000);
  assert.deepEqual(
    kept.slice(0, GENESIS_FACTS).map((item) => item.id),
    ['f0', 'f1'],
  );
  const tailKept = kept.slice(GENESIS_FACTS);
  assert.ok(tailKept.length > 0 && tailKept.length < 40, `kept ${tailKept.length}`);
  /* newest first from the end: the last fact must survive */
  assert.equal(kept.at(-1)!.id, 'f49');
  assert.ok(JSON.stringify(kept).length <= 12_000, `size ${JSON.stringify(kept).length}`);
  /* older facts are dropped from the window, not from history (they stay in the projection) */
  assert.ok(!kept.some((item) => item.id === 'f25'));
});

test('the default budget keeps the snapshot far below its hard limit', () => {
  const facts = [fact(0), fact(1), ...Array.from({ length: 200 }, (_, i) => fact(i + 10, 4000))];
  const kept = retainFacts(facts);
  assert.ok(JSON.stringify(kept).length <= FACTS_BUDGET_CHARS);
  assert.ok(JSON.stringify(kept).length < 262144);
});
