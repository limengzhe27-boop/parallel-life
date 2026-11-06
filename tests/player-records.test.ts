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
function invitationFixture() {
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
  return { f, id, replyId };
}

function respondToFixtureInvitation(
  f: PlayerRecordsInput,
  id: string,
  operation: 'accept' | 'cancel' | 'reschedule' | 'attend',
) {
  const previousVersion = f.worldVersion++;
  const at = operation === 'reschedule' ? '2026-10-10T01:00:00.000Z' : undefined;
  const commandId = randomUUID();
  const appointment = f.appointments[0]!;
  appointment.status = (
    {
      accept: 'confirmed',
      cancel: 'cancelled',
      reschedule: 'proposed',
      attend: 'attended',
    } as const
  )[operation];
  appointment.responseVersion = f.worldVersion;
  appointment.responseAt = time;
  if (at) appointment.at = at;
  f.events.push({
    schemaVersion: 1,
    type: 'invitation.responded',
    id: randomUUID(),
    worldId: f.worldId,
    version: f.worldVersion,
    commandId,
    occurredAt: time,
    storyTime: time,
    data: {
      commandId,
      worldId: f.worldId,
      expectedVersion: previousVersion,
      id,
      operation,
      ...(at ? { at } : {}),
    },
  });
}

test('calendar status requires committed proposal and explicit response, legacy stays absent', () => {
  const { f, id } = invitationFixture();
  assert.equal(projectPlayerRecords(f).current.at(-1)!.state, 'proposed');
  f.appointments[0]!.status = 'confirmed';
  assert.equal(projectPlayerRecords(f).current.length, 1);
  respondToFixtureInvitation(f, id, 'accept');
  assert.equal(projectPlayerRecords(f).current.at(-1)!.state, 'confirmed');
  f.appointments[0]!.status = undefined;
  assert.equal(projectPlayerRecords(f).current.length, 1);
});

test('invitation tasks require visible proposal evidence and separate suggestions from consent', () => {
  const { f, id, replyId } = invitationFixture();
  const record = () =>
    PlayerRecordsSchema.parse(projectPlayerRecords(f)).current.find((r) => r.kind === 'invitation');
  const original = record();
  assert.equal(original?.task?.kind, 'decide_invitation');
  assert.equal(original?.task?.recommended, undefined);
  f.directedInvitationIds = new Set([randomUUID()]);
  assert.equal(record()?.task?.recommended, undefined);
  f.directedInvitationIds = new Set([id]);
  assert.equal(record()?.task?.recommended, true);
  assert.equal(record()?.task?.reason, '邀请你练习摄影');
  assert.deepEqual(record()?.navigation, { app: 'calendar', invitationId: id });
  assert.equal(record()?.state, 'proposed');
  const projected = record()!;
  assert.equal(projected.source.kind, 'world_event');
  if (projected.source.kind === 'world_event') assert.equal(projected.source.messageId, replyId);

  const offer = f.events[0]!;
  assert.equal(offer.type, 'turn.resolved');
  f.events.push({
    ...offer,
    id: randomUUID(),
    commandId: randomUUID(),
    version: ++f.worldVersion,
    data: { ...offer.data, userText: '我还想再想想，也想问问几点方便。', effects: [] },
  });
  assert.equal(record()?.task?.kind, 'decide_invitation');

  // An accepted-looking projection or a director recommendation cannot replace an explicit response.
  f.appointments[0]!.status = 'confirmed';
  assert.equal(record(), undefined);
  respondToFixtureInvitation(f, id, 'accept');
  assert.equal(record()?.task?.kind, 'attend_invitation');

  // The persisted reschedule requires a new decision and cannot be treated as continued consent.
  respondToFixtureInvitation(f, id, 'reschedule');
  assert.equal(record()?.task?.kind, 'decide_invitation');
  assert.equal(record()?.state, 'proposed');

  // A director link alone cannot expose an invitation whose proposal was never presented.
  f.messages = f.messages.filter((m) => m.id !== replyId);
  assert.equal(record(), undefined);
});

test('cancelled and recorded attendance invitations never leave an active task', () => {
  for (const operation of ['cancel', 'attend'] as const) {
    const { f, id } = invitationFixture();
    f.directedInvitationIds = new Set([id]);
    if (operation === 'attend') respondToFixtureInvitation(f, id, 'accept');
    respondToFixtureInvitation(f, id, operation);
    const records = PlayerRecordsSchema.parse(projectPlayerRecords(f));
    assert.equal(
      records.current.find((r) => r.kind === 'invitation'),
      undefined,
    );
    const archived = records.history.find((r) => r.kind === 'invitation');
    assert.equal(archived?.state, operation === 'cancel' ? 'cancelled' : 'attended');
    assert.equal(archived?.assertion, 'invitation_status');
    assert.equal(archived?.task, undefined);
  }
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
