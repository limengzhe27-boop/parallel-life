import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgenda, threadFor } from '../src/modules/world/domain/agenda.ts';
import { followupAgenda } from '../src/modules/world/domain/return-followups.ts';
import { beatCue, selectSpeaker } from '../src/modules/world/domain/clock.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';

const now = '2026-10-20T18:00:00.000Z';
const world = (at: string): WorldState => ({
  schemaVersion: 1,
  id: 'world-reminder',
  ownerId: 'owner',
  version: 1,
  title: '提醒验收',
  time: now,
  actors: [{ id: 'a', name: '林澈', persona: '守时的人' }],
  facts: [],
  messages: [],
  mediaRequests: [],
  appointments: [
    {
      id: 'ap',
      title: '一起吃饭',
      at,
      participantIds: ['a'],
      sourceEventId: 'evt',
      status: 'confirmed',
    },
  ],
});

test('a confirmed date inside two story hours creates a code-timed reminder, not an arrival claim', () => {
  const w = world('2026-10-20T19:30:00.000Z');
  const agenda = buildAgenda(w);
  assert.deepEqual(
    agenda.map((thread) => thread.kind),
    ['appointment_upcoming'],
  );
  assert.equal(threadFor(agenda, 'a')?.kind, 'appointment_upcoming');
  assert.equal(selectSpeaker(w, []), 'a');
  const cue = beatCue(w, 'a', agenda);
  assert.match(cue, /约在/);
  assert.match(cue, /2026-10-21 03:30|距现在约90分钟/);
  assert.match(cue, /不要说已经见面/);
});

test('the reminder window is bounded and a real message inside it suppresses repetition', () => {
  assert.deepEqual(buildAgenda(world('2026-10-20T20:01:00.000Z')), []);
  const w = world('2026-10-20T19:30:00.000Z');
  w.messages.push({
    id: 'm1',
    actorId: 'a',
    role: 'assistant',
    text: '七点半，别迟到',
    at: '2026-10-20T18:10:00.000Z',
    sourceEventId: 'evt2',
  });
  assert.deepEqual(buildAgenda(w), []);
});

test('at the saved instant the thread becomes due; a late proposed invitation stays quiet', () => {
  const due = world(now);
  assert.equal(buildAgenda(due)[0]?.kind, 'appointment_due');
  const proposed = world('2026-10-20T17:00:00.000Z');
  proposed.appointments[0]!.status = 'proposed';
  assert.deepEqual(buildAgenda(proposed), []);
});

test('an hour after the date, a code-timed consequence appears without inventing attendance or blame', () => {
  const overdue = world('2026-10-20T16:00:00.000Z');
  const agenda = buildAgenda(overdue);
  assert.equal(agenda[0]?.kind, 'appointment_overdue');
  assert.equal(selectSpeaker(overdue, []), 'a');
  const cue = beatCue(overdue, 'a', agenda);
  assert.match(cue, /过去一小时以上/);
  assert.match(cue, /不能编造主角到场/);
  overdue.messages.push({
    id: 'due-message',
    actorId: 'a',
    role: 'assistant',
    text: '我到了，你在哪',
    at: '2026-10-20T16:05:00.000Z',
    sourceEventId: 'due-event',
  });
  assert.equal(buildAgenda(overdue)[0]?.kind, 'appointment_overdue');
  overdue.messages.push({
    id: 'consequence-message',
    actorId: 'a',
    role: 'assistant',
    text: '我先回去了，改天再说',
    at: '2026-10-20T17:10:00.000Z',
    sourceEventId: 'consequence-event',
  });
  assert.deepEqual(buildAgenda(overdue), []);
});

test('a follow-up can deliver the reminder once inside the window', () => {
  const w = world('2026-10-20T19:30:00.000Z');
  const agenda = buildAgenda(w);
  const previous = [{ actorId: 'a', at: '2026-10-19T18:00:00.000Z', version: 1 }];
  assert.equal(followupAgenda(w, agenda, now, previous).length, 1);
  assert.equal(
    followupAgenda(w, agenda, '2026-10-20T20:30:00.000Z', [{ actorId: 'a', at: now, version: 2 }])
      .length,
    0,
    'the old reminder thread cannot fire after its instant; the due thread is rebuilt separately',
  );
  w.messages.push({
    id: 'already-spoke',
    actorId: 'a',
    role: 'assistant',
    text: '刚看到一家店，改天带你去',
    at: '2026-10-20T18:10:00.000Z',
    sourceEventId: 'unrelated-chat',
  });
  assert.deepEqual(
    buildAgenda(w),
    [],
    'a real message inside the reminder window suppresses the repetition at the source',
  );
});
