import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_BUDGET,
  fitWithinBudget,
} from '../src/modules/world/infrastructure/director-agent-model.ts';

const big = (n: number, size: number) => Array.from({ length: n }, () => 'x'.repeat(size));

test('大世界不再直接报错，而是裁到预算内', () => {
  const payload = {
    focus: 'keep-me',
    blockers: ['keep-blocker'],
    observations: big(40, 2000),
    episodes: big(30, 2000),
    candidates: big(30, 2000),
    changes: big(30, 2000),
    cast: [{ id: 'a', name: '青青', persona: 'p'.repeat(1500) }],
    worldSetting: 'w'.repeat(4000),
  };
  const fitted = fitWithinBudget(payload);
  assert.ok(JSON.stringify(fitted).length <= CONTEXT_BUDGET, '必须进入预算');
  assert.equal(fitted.focus, 'keep-me');
  assert.deepEqual(fitted.blockers, ['keep-blocker']);
  assert.ok((fitted.observations as unknown[]).length >= 1, '保留最近观察');
});
