import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  projectPlayerRecords,
  type PlayerRecordsInput,
} from '../src/modules/world/domain/player-records.ts';
import { PlayerRecordsSchema } from '../src/contracts/world-records.ts';
const time = '2026-10-10T00:00:00.000Z';
function fixture(): PlayerRecordsInput {
  const worldId = randomUUID(),
    actorId = randomUUID(),
    eventId = randomUUID(),
    choiceId = randomUUID();
  return {
    worldId,
    worldVersion: 1,
    actors: [{ id: actorId, name: '同名朋友' }],
    appointments: [],
    choices: [
      {
        id: choiceId,
        actorId,
        quote: '我决定练习摄影',
        intent: '练习摄影',
        sourceEventId: eventId,
        sourceVersion: 1,
        status: 'pending',
      },
    ],
    events: [
      {
        schemaVersion: 1,
        id: eventId,
        worldId,
        version: 1,
        commandId: randomUUID(),
        occurredAt: time,
        type: 'turn.resolved',
        data: {
          actorId,
          userText: '我决定练习摄影',
          effects: [
            { type: 'choice.recorded', id: choiceId, quote: '我决定练习摄影', intent: '练习摄影' },
          ],
        },
      },
    ],
    messages: [
      {
        id: eventId + '_user',
        actorId,
        role: 'user',
        text: '我决定练习摄影',
        at: time,
        sourceEventId: eventId,
        sourceVersion: 1,
      },
    ],
  };
}
test('records whitelist public starting fields, have stable IDs and keep source semantics', () => {
  const f = fixture();
  const opening = {
    seedId: randomUUID(),
    identity: '摄影师',
    setting: '刚到新城市',
    notes: ['SECRET_NOTES'],
    persona: 'SECRET_PERSONA',
  };
  f.opening = opening;
  const result = PlayerRecordsSchema.parse(projectPlayerRecords(f));
  assert.equal(result.about.length, 2);
  assert.equal(result.current.length, 1);
  assert.equal(result.current[0]!.source.kind, 'world_event');
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.deepEqual(projectPlayerRecords(f), projectPlayerRecords(f));
  assert.deepEqual(result.current[0]!.navigation, { app: 'wechat', actorId: f.actors[0]!.id });
  assert.equal(result.current[0]!.state, 'planned');
  assert.equal(result.coverage, 'recent');
});
test('records exclude mismatched, foreign, future and missing visible sources', () => {
  for (const mutate of [
    (f: PlayerRecordsInput) => {
      f.events[0]!.worldId = randomUUID();
    },
    (f: PlayerRecordsInput) => {
      f.events[0]!.version = 2;
    },
    (f: PlayerRecordsInput) => {
      f.messages = [];
    },
    (f: PlayerRecordsInput) => {
      f.messages[0]!.actorId = randomUUID();
    },
    (f: PlayerRecordsInput) => {
      f.messages[0]!.text = '无关的发言';
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(projectPlayerRecords(f).current.length, 0);
  }
});
test('a sourced actor suggestion stays a suggestion and cannot manufacture acceptance', () => {
  const f = fixture(),
    c = f.choices[0]!,
    eventId = randomUUID(),
    messageId = randomUUID(),
    quote = '周末一起练习拍照吧';
  f.worldVersion = 2;
  c.nextStep = { quote, sourceEventId: eventId, sourceMessageId: messageId, sourceVersion: 2 };
  f.events.push({
    schemaVersion: 1,
    id: eventId,
    worldId: f.worldId,
    version: 2,
    commandId: randomUUID(),
    occurredAt: time,
    storyAt: time,
    type: 'turn.resolved',
    data: {
      actorId: c.actorId,
      userText: `[choice:${c.id}]`,
      origin: 'director',
      effects: [
        { type: 'message.received', id: messageId, actorId: c.actorId, text: quote },
        { type: 'choice.next_step', id: randomUUID(), choiceId: c.id, quote },
      ],
    },
  });
  f.messages.push({
    id: messageId,
    actorId: c.actorId,
    role: 'assistant',
    text: quote,
    at: time,
    sourceEventId: eventId,
  });
  let result = projectPlayerRecords(f);
  assert.equal(result.current[1]!.assertion, 'actor_statement');
  assert.equal(result.current[1]!.state, 'suggested');
  f.messages[1]!.actorId = randomUUID();
  result = projectPlayerRecords(f);
  assert.equal(result.current.length, 1);
});
test('player reports are qualified history, superseded does not mean abandoned', () => {
  const f = fixture(),
    c = f.choices[0]!,
    id = randomUUID(),
    quote = '我已经完成练习摄影';
  f.worldVersion = 2;
  c.result = { kind: 'reported_done', quote, sourceEventId: id, sourceVersion: 2 };
  f.events.push({
    schemaVersion: 1,
    id,
    worldId: f.worldId,
    version: 2,
    commandId: randomUUID(),
    occurredAt: time,
    type: 'turn.resolved',
    data: {
      actorId: c.actorId,
      userText: quote,
      effects: [
        {
          type: 'choice.result_reported',
          id: randomUUID(),
          choiceId: c.id,
          outcome: 'reported_done',
          quote,
        },
      ],
    },
  });
  f.messages.push({
    id: id + '_user',
    actorId: c.actorId,
    role: 'user',
    text: quote,
    at: time,
    sourceEventId: id,
  });
  const result = projectPlayerRecords(f);
  assert.equal(result.current.length, 0);
  assert.equal(result.history[0]!.stateLabel, '你说已完成');
  assert.equal(result.history[0]!.assertion, 'player_statement');
  c.status = 'superseded';
  assert.equal(projectPlayerRecords(f).history[0]!.state, 'superseded');
});
test('calendar status requires committed proposal and explicit response, legacy stays absent', () => {
  const f = fixture(),
    event = f.events[0]!;
  if (event.type !== 'turn.resolved') throw Error();
  const id = randomUUID(),
    actorId = f.actors[0]!.id;
  event.data.effects.push({
    type: 'appointment.proposed',
    id,
    title: '摄影练习',
    at: time,
    participantIds: [actorId],
  });
  const replyId = randomUUID();
  event.data.effects.push({
    type: 'message.received',
    id: replyId,
    actorId,
    text: '邀请你练习摄影',
  });
  f.messages.push({
    id: replyId,
    actorId,
    role: 'assistant',
    text: '邀请你练习摄影',
    at: time,
    sourceEventId: event.id,
  });
  f.appointments.push({
    id,
    title: '摄影练习',
    at: time,
    participantIds: [actorId],
    sourceEventId: event.id,
    status: 'proposed',
  });
  assert.equal(projectPlayerRecords(f).current.at(-1)!.state, 'proposed');
  f.appointments[0]!.status = 'confirmed';
  assert.equal(projectPlayerRecords(f).current.length, 1);
  f.worldVersion = 2;
  f.appointments[0]!.responseVersion = 2;
  f.events.push({
    schemaVersion: 1,
    type: 'invitation.responded',
    id: randomUUID(),
    worldId: f.worldId,
    version: 2,
    commandId: randomUUID(),
    occurredAt: time,
    storyTime: time,
    data: {
      commandId: randomUUID(),
      worldId: f.worldId,
      expectedVersion: 1,
      id,
      operation: 'accept',
    },
  });
  assert.equal(projectPlayerRecords(f).current.at(-1)!.state, 'confirmed');
  f.appointments[0]!.status = undefined;
  assert.equal(projectPlayerRecords(f).current.length, 1);
});
test('legacy records are genuinely empty and source timestamps do not become invented story dates', () => {
  const f = fixture();
  const r = projectPlayerRecords(f);
  assert.equal(r.current[0]!.source.kind, 'world_event');
  if (r.current[0]!.source.kind === 'world_event')
    assert.equal(r.current[0]!.source.timeBasis, 'recorded');
  f.choices = [];
  f.events = [];
  f.messages = [];
  assert.deepEqual(projectPlayerRecords(f).current, []);
  assert.deepEqual(projectPlayerRecords(f).about, []);
});
