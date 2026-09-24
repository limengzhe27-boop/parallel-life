import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceClock,
  beatCue,
  clampSpeed,
  MAX_BEATS_PER_ADVANCE,
  selectSpeaker,
  type WorldClock,
} from '../src/modules/world/domain/clock.ts';
import { buildAgenda } from '../src/modules/world/domain/agenda.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

const clock = (over: Partial<WorldClock> = {}): WorldClock => ({
  storyNow: '2026-09-24T00:00:00.000Z',
  speed: 1,
  paused: false,
  lastTickAt: '2026-09-24T00:00:00.000Z',
  missedBeats: 0,
  summary: null,
  ...over,
});
const at = (iso: string) => iso;

test('a paused world does not move', () => {
  const result = advanceClock(clock({ paused: true }), '2026-09-24T05:00:00.000Z');
  assert.deepEqual(result.beats, []);
  assert.equal(result.clock.storyNow, '2026-09-24T00:00:00.000Z');
  assert.equal(result.clock.lastTickAt, '2026-09-24T05:00:00.000Z');
});

test('time runs 1:1 by default and plays one beat per half hour', () => {
  const result = advanceClock(clock(), '2026-09-24T01:30:00.000Z');
  assert.equal(result.clock.storyNow, '2026-09-24T01:30:00.000Z');
  assert.equal(result.beats.length, 3);
  assert.equal(result.beats[0], '2026-09-24T00:30:00.000Z');
  assert.equal(result.folded, 0);
  assert.equal(result.clock.summary, null);
});

test('speed multiplies story time but beats stay capped', () => {
  const fast = advanceClock(clock({ speed: 2 }), '2026-09-24T01:00:00.000Z');
  assert.equal(fast.clock.storyNow, '2026-09-24T02:00:00.000Z');
  assert.equal(fast.beats.length, 3, 'still at most the cap');
  assert.equal(fast.folded, 1, 'the fourth beat is folded, not played');
});

test('a long absence folds the extra beats into a summary instead of paying for them', () => {
  const result = advanceClock(clock(), '2026-09-24T06:00:00.000Z');
  assert.equal(result.beats.length, MAX_BEATS_PER_ADVANCE);
  assert.equal(result.folded, 9);
  assert.match(result.clock.summary ?? '', /世界照常运转/);
  assert.equal(result.clock.storyNow, '2026-09-24T06:00:00.000Z');
});

test('a backwards or zero clock change plays nothing', () => {
  assert.deepEqual(advanceClock(clock(), '2026-09-23T00:00:00.000Z').beats, []);
  assert.deepEqual(advanceClock(clock(), '2026-09-24T00:00:00.000Z').beats, []);
});

test('speed is clamped to a legal range', () => {
  assert.equal(clampSpeed(-3), 0);
  assert.equal(clampSpeed(1000), 60);
  assert.equal(clampSpeed(1.234), 1.23);
  assert.equal(clampSpeed(Number.NaN), 1);
});

const state = (): WorldState => ({
  schemaVersion: 1,
  id: 'w1',
  ownerId: 'o1',
  version: 4,
  title: '测试',
  time: at('2026-09-24T00:00:00.000Z'),
  actors: [
    { id: 'a', name: '甲', persona: '' },
    { id: 'b', name: '乙', persona: '' },
  ],
  facts: [],
  messages: [
    {
      id: 'm1',
      actorId: 'a',
      role: 'assistant',
      text: '甲说过话',
      at: at('2026-09-24T00:00:00.000Z'),
      sourceEventId: 'e1',
    },
  ],
  appointments: [],
  mediaRequests: [],
});

test('the speaker who waited longest goes first, and nobody speaks twice in a row', () => {
  assert.equal(selectSpeaker(state(), []), 'b', '乙 never spoke');
  assert.equal(
    selectSpeaker(state(), ['b']),
    'a',
    '甲 waits longer than a silent 乙 who already spoke',
  );
  assert.equal(
    selectSpeaker(state(), ['a', 'b']),
    'b',
    'someone who never spoke in the whole world still waits longest',
  );
});

test('the beat cue is a stage direction, never the user speaking', () => {
  const cue = beatCue(state(), 'b');
  assert.match(cue, /用户没有开口/);
  assert.match(cue, /乙/);
  assert.equal(/用户(说|问)/.test(cue), false);
});

test('unfinished business decides who acts, before the silence rule', () => {
  /* The protagonist just spoke to 甲 and 甲 has not answered. */
  const waiting = state();
  waiting.messages = [
    ...waiting.messages,
    {
      id: 'm2',
      actorId: 'a',
      role: 'user',
      text: '在吗',
      at: at('2026-09-24T00:05:00.000Z'),
      sourceEventId: 'e2',
    },
  ];
  const agenda = buildAgenda(waiting);
  assert.equal(agenda[0]?.kind, 'awaiting_reply');
  assert.equal(agenda[0]?.actorId, 'a');
  /* 乙 never spoke, yet the character who owes a reply goes first. */
  assert.equal(selectSpeaker(waiting, []), 'a');
  assert.match(beatCue(waiting, 'a'), /对方还没有回应/);
});

test('an open appointment pulls its participant into the beat', () => {
  const pending = state();
  pending.appointments = [
    {
      id: 'ap1',
      title: '周三一起看展',
      at: at('2026-09-25T10:00:00.000Z'),
      participantIds: ['b'],
      sourceEventId: 'e3',
      status: 'proposed',
    },
  ];
  const agenda = buildAgenda(pending);
  assert.deepEqual(
    agenda.map((thread) => [thread.kind, thread.actorId]),
    [['proposed_appointment', 'b']],
  );
  assert.equal(selectSpeaker(pending, []), 'b');
  assert.match(beatCue(pending, 'b'), /周三一起看展/);
});

test('with nothing pending the silence rule still applies', () => {
  assert.deepEqual(buildAgenda(state()), []);
  assert.equal(selectSpeaker(state(), []), 'b');
});

test('a promise a character made is unfinished business too', () => {
  const memories = [
    {
      scopeType: 'character',
      characterId: 'b',
      kind: 'commitment',
      text: '答应帮你打听房租',
      status: 'active',
    },
    {
      scopeType: 'character',
      characterId: 'a',
      kind: 'commitment',
      text: '已经作废的承诺',
      status: 'superseded',
    },
  ];
  const agenda = buildAgenda(state(), 5, memories);
  assert.deepEqual(
    agenda.map((thread) => [thread.kind, thread.actorId]),
    [['commitment', 'b']],
  );
  assert.equal(selectSpeaker(state(), [], agenda), 'b');
  assert.match(beatCue(state(), 'b', agenda), /答应帮你打听房租/);
});

test('a reply owed outranks a promise', () => {
  const waiting = state();
  waiting.messages = [
    ...waiting.messages,
    {
      id: 'm2',
      actorId: 'a',
      role: 'user',
      text: '在吗',
      at: at('2026-09-24T00:05:00.000Z'),
      sourceEventId: 'e2',
    },
  ];
  const agenda = buildAgenda(waiting, 5, [
    {
      scopeType: 'character',
      characterId: 'b',
      kind: 'commitment',
      text: '答应帮你问问',
      status: 'active',
    },
  ]);
  assert.equal(selectSpeaker(waiting, [], agenda), 'a');
});
