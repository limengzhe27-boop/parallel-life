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

test('authenticated arrival and scene entry alter author event review context only for matching place and cast', () => {
  const reasons = [
    {
      id: 'arrival-a-home',
      eventId: 'e10',
      worldVersion: 10,
      kind: 'new_condition' as const,
      ref: { kind: 'event' as const, id: 'e10' },
      placeId: 'home',
      actorId: 'a',
      subjectKind: 'actor' as const,
    },
    {
      id: 'arrival-player-home',
      eventId: 'e11',
      worldVersion: 11,
      kind: 'new_condition' as const,
      ref: { kind: 'event' as const, id: 'e11' },
      placeId: 'home',
      subjectKind: 'player' as const,
    },
    {
      id: 'arrival-b-home',
      eventId: 'e12',
      worldVersion: 12,
      kind: 'new_condition' as const,
      ref: { kind: 'event' as const, id: 'e12' },
      placeId: 'home',
      actorId: 'b',
      subjectKind: 'actor' as const,
    },
    {
      id: 'arrival-a-away',
      eventId: 'e13',
      worldVersion: 13,
      kind: 'new_condition' as const,
      ref: { kind: 'event' as const, id: 'e13' },
      placeId: 'away',
      actorId: 'a',
      subjectKind: 'actor' as const,
    },
    {
      id: 'scene-player-home',
      eventId: 'e14',
      worldVersion: 14,
      kind: 'new_condition' as const,
      ref: { kind: 'event' as const, id: 'e14' },
      placeId: 'home',
      subjectKind: 'player' as const,
    },
    {
      id: 'raw-tick',
      eventId: 'e15',
      worldVersion: 15,
      kind: 'new_condition' as const,
      ref: { kind: 'event' as const, id: 'e15' },
    },
  ];

  // Event with cast ['a'] and place ['home']
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], reasons, 9, ['home']),
    [],
    'before version 10 no arrival evidence',
  );
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], reasons, 10, ['home']),
    ['arrival-a-home'],
    'cast actor arriving at event place is valid evidence',
  );
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], reasons, 11, ['home']),
    ['arrival-a-home', 'arrival-player-home'],
    'player arriving at event place is valid evidence',
  );
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], reasons, 12, ['home']),
    ['arrival-a-home', 'arrival-player-home'],
    'unrelated actor b arriving at home does not wake event with cast [a]',
  );
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], reasons, 13, ['home']),
    ['arrival-a-home', 'arrival-player-home'],
    'actor a arriving at unrelated place away does not wake event at home',
  );
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], reasons, 14, ['home']),
    ['arrival-a-home', 'arrival-player-home', 'scene-player-home'],
    'player entering scene at event place is valid evidence',
  );
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], reasons, 15, ['home']),
    ['arrival-a-home', 'arrival-player-home', 'scene-player-home'],
    'raw tick or non-arrival new_condition is not evidence',
  );

  // Event with NO places defined: arrival must NOT wake it
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], reasons, 99, []),
    [],
    'event without resolved places is never awakened by physical arrivals',
  );

  // Event at unrelated place 'cafe'
  assert.deepEqual(
    authoredReconsiderationEvidence(['a'], reasons, 99, ['cafe']),
    [],
    'arrivals at home or away do not wake an event at cafe',
  );
});
