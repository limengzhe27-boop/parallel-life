import test from 'node:test';
import assert from 'node:assert/strict';
import { authoredReconsiderationEvidence } from '../src/modules/world/domain/authored-reconsideration.ts';
import type { DirectorPendingReason } from '../src/modules/world/domain/world-awareness.ts';

test('only related committed semantic changes alter an author event review context', () => {
  const reasons: DirectorPendingReason[] = [
    {
      id: 'plan-a',
      eventId: 'e1',
      worldVersion: 1,
      kind: 'plan_changed',
      ref: { kind: 'plan', id: 'p', actorId: 'a' },
    },
    {
      id: 'decision-b',
      eventId: 'e2',
      worldVersion: 2,
      kind: 'player_decision',
      ref: { kind: 'decision', id: 'd', actorId: 'b' },
    },
    {
      id: 'result-a',
      eventId: 'e3',
      worldVersion: 3,
      kind: 'action_result',
      ref: { kind: 'action_result', id: 'r', actorId: 'a' },
    },
    {
      id: 'tick',
      eventId: 'e4',
      worldVersion: 4,
      kind: 'new_condition',
      ref: { kind: 'event', id: 'e4' },
    },
  ];
  assert.deepEqual(authoredReconsiderationEvidence(['a'], reasons, 0), []);
  assert.deepEqual(authoredReconsiderationEvidence(['a'], reasons, 1), ['plan-a']);
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], reasons, 2),
    ['plan-a'],
    'another actor decision cannot reopen this event',
  );
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], [...reasons, reasons[0]!].reverse(), 99),
    ['plan-a', 'result-a'],
    'order, duplicate rows, unrelated versions and ticks do not change identity',
  );
  assert.deepEqual(
    authoredReconsiderationEvidence([], reasons, 99),
    [],
    'no resolved author cast cannot invent relevance',
  );
});
