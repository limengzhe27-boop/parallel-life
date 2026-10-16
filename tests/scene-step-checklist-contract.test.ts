import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneStepChecklistSchema } from '../src/contracts/world-records.ts';

const ids = [
  'order_reviewed',
  'repair_explained',
  'handed_over',
  'received',
  'connector_checked',
  'record_written',
  'receiver_inspected',
] as const;
const fixture = () => ({
  ruleVersion: 'r17-delivery-v1',
  requiredTotal: 4,
  completedRequired: 1,
  steps: ids.map((id, i) => ({
    id,
    title: id,
    required: i < 4,
    performer: ['received', 'receiver_inspected'].includes(id) ? 'actor' : 'player',
    state: i === 0 ? 'completed' : 'pending',
    ...(i === 0 ? { at: '2026-10-09T09:53:00.000Z' } : {}),
  })),
});
test('read-only checklist accepts one saved player step and a separate actual receiver step', () => {
  const one = fixture();
  assert.equal(SceneStepChecklistSchema.parse(one).completedRequired, 1);
  one.steps[3] = { ...one.steps[3]!, state: 'completed', at: '2026-10-09T09:55:00.000Z' };
  const two = {
    ...one,
    completedRequired: 2,
    steps: one.steps.map((s, i) => (i === 3 ? { ...s, actorName: '测试接收人' } : s)),
  };
  assert.equal(SceneStepChecklistSchema.parse(two).steps[3]?.performer, 'actor');
});
test('checklist rejects guessed credit, editable flags, raw source and inconsistent definition', () => {
  const base = fixture();
  for (const value of [
    { ...base, completedRequired: 4 },
    { ...base, editable: true },
    { ...base, steps: [...base.steps.slice(0, 6), base.steps[0]] },
    { ...base, steps: base.steps.map((s, i) => (i === 0 ? { ...s, at: undefined } : s)) },
    { ...base, steps: base.steps.map((s, i) => (i === 3 ? { ...s, performer: 'player' } : s)) },
    { ...base, steps: base.steps.map((s, i) => (i === 4 ? { ...s, required: true } : s)) },
    { ...base, steps: base.steps.map((s, i) => (i === 1 ? { ...s, actorName: '未实际收到' } : s)) },
    { ...base, steps: base.steps.map((s, i) => (i === 0 ? { ...s, inputQuote: '私有原文' } : s)) },
  ])
    assert.equal(SceneStepChecklistSchema.safeParse(value).success, false);
});
