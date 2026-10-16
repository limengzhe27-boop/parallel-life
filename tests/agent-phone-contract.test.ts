import test from 'node:test';
import assert from 'node:assert/strict';
import { OpeningStatusSchema, OpeningAdvanceSchema } from '../src/contracts/publication-opening.ts';
import { AdvanceReceiptSchema } from '../src/contracts/world-clock.ts';

const base = {
  status: 'advanced' as const,
  worldId: '11111111-1111-4111-8111-111111111111',
  storyNow: '2026-10-15T08:00:00.000Z',
  played: 0,
  folded: 0,
  summary: null,
  actors: [],
};
test('Agent opening metadata preserves pending status instead of completing the story', () => {
  for (const phase of ['none', 'unplanned'] as const) {
    const status = { runtime: 'agents' as const, phase, total: 0, delivered: 0, retryable: false };
    assert.deepEqual(OpeningStatusSchema.parse(status), status);
    assert.notEqual(OpeningStatusSchema.parse(status).phase, 'complete');
  }
  assert.equal(
    OpeningStatusSchema.safeParse({
      runtime: 'legacy',
      phase: 'none',
      total: 0,
      delivered: 0,
      retryable: false,
    }).success,
    false,
  );
});
test('quiet committed change survives phone contracts without manufacturing a played message', () => {
  const changed = { ...base, changed: true, worldVersion: 7 };
  assert.deepEqual(AdvanceReceiptSchema.parse(changed), changed);
  const value = OpeningAdvanceSchema.parse({
    ...changed,
    opening: { runtime: 'agents', phase: 'unplanned', total: 0, delivered: 0, retryable: false },
  });
  assert.equal(value.changed, true);
  assert.equal(value.worldVersion, 7);
  assert.equal(value.played, 0);
  assert.deepEqual(value.actors, []);
});
test('legacy phone receipts remain valid and malformed change metadata remains invalid', () => {
  assert.deepEqual(AdvanceReceiptSchema.parse(base), base);
  assert(
    OpeningAdvanceSchema.safeParse({
      ...base,
      opening: { phase: 'complete', total: 1, delivered: 1, retryable: false },
    }).success,
  );
  for (const patch of [
    { changed: 'true' },
    { worldVersion: -1 },
    { worldVersion: 1.5 },
    { played: -1 },
    { played: '1' },
  ])
    assert.equal(AdvanceReceiptSchema.safeParse({ ...base, ...patch }).success, false);
});
