import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beatsForPacing,
  describeImpact,
  directionLines,
  EMPTY_DIRECTION,
  normalizeDirection,
} from '../src/modules/world/domain/direction.ts';
import { selectSpeaker } from '../src/modules/world/domain/clock.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

const state = (): WorldState => ({
  schemaVersion: 1,
  id: 'w1',
  ownerId: 'o1',
  version: 1,
  title: 't',
  time: '2026-09-24T00:00:00.000Z',
  actors: [
    { id: 'a', name: '甲', persona: '' },
    { id: 'b', name: '乙', persona: '' },
  ],
  facts: [],
  messages: [],
  appointments: [],
  mediaRequests: [],
});

test('pacing is a hard cap on how many beats one advance may play', () => {
  assert.equal(beatsForPacing('slow'), 1);
  assert.equal(beatsForPacing('normal'), 3);
  assert.equal(beatsForPacing('fast'), 3);
});

test('the brief is validated instead of trusted', () => {
  assert.throws(() => normalizeDirection({ guidance: 'x'.repeat(501) }), {
    code: 'INVALID_COMMAND',
  });
  assert.throws(() => normalizeDirection({ themes: Array.from({ length: 6 }, () => 't') }), {
    code: 'INVALID_COMMAND',
  });
  assert.throws(() => normalizeDirection({ focusActorIds: ['a', 'b', 'c', 'd'] }, state()), {
    code: 'INVALID_COMMAND',
  });
  assert.throws(() => normalizeDirection({ focusActorIds: ['ghost'] }, state()), {
    code: 'INVALID_COMMAND',
  });
  assert.deepEqual(
    normalizeDirection({ guidance: '  慢一点  ', themes: [' 房租 ', ''] }, state()),
    {
      guidance: '慢一点',
      themes: ['房租'],
      pacing: 'normal',
      focusActorIds: [],
    },
  );
});

test('a focused character is brought on stage before the silence rule', () => {
  /* With nobody speaking yet the tie is broken by id, so 甲 goes first. */
  assert.equal(selectSpeaker(state(), []), 'a');
  /* The brief brings 乙 on stage instead. */
  assert.equal(selectSpeaker(state(), [], [], ['b']), 'b');
  /* Unfinished business still outranks a focus request. */
  const waiting = state();
  waiting.messages = [
    {
      id: 'm1',
      actorId: 'b',
      role: 'user',
      text: '在吗',
      at: '2026-09-24T00:01:00.000Z',
      sourceEventId: 'e1',
    },
  ];
  assert.equal(selectSpeaker(waiting, [], undefined, ['a']), 'b');
});

test('the impact can be described without applying anything', () => {
  const impact = describeImpact(
    { ...EMPTY_DIRECTION, pacing: 'slow', focusActorIds: ['b'], themes: ['房租'] },
    state(),
  );
  assert.deepEqual(impact, { beatsPerAdvance: 1, speaksFirst: '乙', themes: ['房租'] });
});

test('guidance reaches the character, and only the focused one is told to appear', () => {
  const direction = {
    ...EMPTY_DIRECTION,
    guidance: '把节奏放慢',
    themes: ['房租'],
    focusActorIds: ['a'],
  };
  const forA = directionLines(direction, 'a').join(' ');
  const forB = directionLines(direction, 'b').join(' ');
  assert.match(forA, /导演要求/);
  assert.match(forA, /房租/);
  assert.match(forA, /多由你出场/);
  assert.equal(/多由你出场/.test(forB), false);
});
