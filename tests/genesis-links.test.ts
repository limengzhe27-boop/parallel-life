import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  genesisMessages,
  type MessageHistoryProposal,
} from '../src/modules/world/domain/genesis-messages.ts';
import {
  createGenesisLinks,
  mergeAppointments,
  validateHistoryConnections,
  verifiedGenesisLinks,
} from '../src/modules/world/domain/genesis-links.ts';
import { projectPlayerRecords } from '../src/modules/world/domain/player-records.ts';
import {
  applyInvitationEvent,
  type InvitationEvent,
} from '../src/modules/world/domain/invitations.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
function fixture() {
  const id = randomUUID(),
    seedId = randomUUID(),
    actorIds = new Map([
      ['a', randomUUID()],
      ['b', randomUUID()],
    ]),
    startAt = '1998-12-31T15:30:00.000Z';
  const quote =
    '1\u67081\u65e500:30\u4e00\u8d77\u6574\u7406\u914d\u4ef6\uff0c\u4f60\u613f\u610f\u6765\u5417\uff1f';
  const history: MessageHistoryProposal = {
    version: 1,
    messages: [
      {
        key: 'old_a',
        actorKey: 'a',
        text: quote,
        minutesBeforeStart: 1440,
        connection: { quote, calendar: { minutesAfterStart: 60 } },
      },
      { key: 'old_b', actorKey: 'b', text: 'Private B old letter', minutesBeforeStart: 1441 },
    ],
  };
  const messages = genesisMessages({
    worldId: id,
    startAt,
    actors: actorIds,
    history,
    current: [{ actorKey: 'b', text: 'Current B' }],
    newId: randomUUID,
  });
  const links = createGenesisLinks({
    worldId: id,
    seedId,
    startAt,
    history,
    actorIds,
    messages,
    newId: randomUUID,
  });
  const state: WorldState = {
    schemaVersion: 1,
    id,
    ownerId: randomUUID(),
    version: 0,
    title: 'Explicit fixture',
    time: startAt,
    actors: [...actorIds].map(([name, id]) => ({ id, name, persona: 'private' })),
    facts: [],
    messages,
    mediaRequests: [],
    messageHistory: { version: 1, startAt, timeZone: 'UTC+08:00' },
    ...links,
  };
  return { state, history, seedId, actorIds };
}
test('one exact old source binds future proposal and read-only records, never another actor context', () => {
  const { state, seedId, actorIds } = fixture();
  const entry = verifiedGenesisLinks(state)[0]!;
  assert.equal(entry.appointment!.at, '1998-12-31T16:30:00.000Z');
  assert.equal(entry.appointment!.status, 'proposed');
  const output = projectPlayerRecords({
    worldId: state.id,
    worldVersion: 0,
    initial: state,
    opening: { seedId },
    choices: [],
    appointments: state.appointments,
    messages: state.messages,
    actors: state.actors,
    events: [],
  });
  assert.equal(output.history[0]!.source.kind, 'world_genesis');
  assert.equal(output.current[0]!.origin!.messageId, entry.messageId);
  assert.equal(output.history[0]!.assertion, 'actor_statement');
  assert.equal(state.facts.length, 0);
  assert.equal(actorContext(state, actorIds.get('b')!, '').appointments.length, 0);
  assert.equal(
    actorContext(state, actorIds.get('a')!, '', [], new Set([entry.messageId])).appointments.length,
    0,
  );
});
test('reject wrong source, exact quote, participant, date and duplicate or conflicting projections', () => {
  const { state, history } = fixture();
  for (const mutate of [
    (s: WorldState) => {
      s.genesisLinks!.entries[0]!.quote = 'Not quoted';
    },
    (s: WorldState) => {
      s.genesisLinks!.entries[0]!.actorId = s.actors[1]!.id;
    },
    (s: WorldState) => {
      s.appointments[0]!.participantIds.push(s.actors[1]!.id);
    },
    (s: WorldState) => {
      s.genesisLinks!.entries.push({ ...s.genesisLinks!.entries[0]! });
    },
  ]) {
    const bad = structuredClone(state);
    mutate(bad);
    assert.throws(() => verifiedGenesisLinks(bad));
  }
  const bad = structuredClone(history);
  bad.messages[0]!.connection!.calendar!.minutesAfterStart = 120;
  assert.throws(() => validateHistoryConnections(bad, state.time));
  assert.equal(
    mergeAppointments(state.appointments, [
      Object.fromEntries(
        Object.entries(state.appointments[0]!).reverse(),
      ) as (typeof state.appointments)[number],
    ]).length,
    1,
  );
  assert.throws(() =>
    mergeAppointments(state.appointments, [{ ...state.appointments[0]!, title: 'Changed' }]),
  );
});
test('real invitation response source changes while initial origin and old state remain immutable', () => {
  const { state, seedId } = fixture(),
    before = JSON.stringify(state),
    id = state.appointments[0]!.id;
  const cmd = {
    commandId: randomUUID(),
    worldId: state.id,
    id,
    expectedVersion: 0,
    operation: 'accept' as const,
  };
  const event: InvitationEvent = {
    schemaVersion: 1,
    type: 'invitation.responded',
    id: randomUUID(),
    worldId: state.id,
    version: 1,
    commandId: cmd.commandId,
    occurredAt: state.time,
    storyTime: state.time,
    data: cmd,
  };
  const next = applyInvitationEvent(state, event);
  const input = {
    worldId: state.id,
    initial: state,
    opening: { seedId },
    choices: [],
    messages: state.messages,
    actors: state.actors,
  };
  const current = projectPlayerRecords({
    ...input,
    worldVersion: 1,
    appointments: next.appointments,
    events: [event],
  }).current[0]!;
  assert.equal(current.source.kind, 'world_event');
  assert.equal(current.origin!.kind, 'world_genesis');
  assert.equal(current.state, 'confirmed');
  assert.equal(
    projectPlayerRecords({
      ...input,
      worldVersion: 0,
      appointments: state.appointments,
      events: [event],
    }).current[0]!.state,
    'proposed',
  );
  assert.equal(JSON.stringify(state), before);
});
