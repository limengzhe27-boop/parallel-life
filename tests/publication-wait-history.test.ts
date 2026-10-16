import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  replayWorldHistory,
  type WorldHistoryEvent,
} from '../src/modules/world/domain/world-history.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
test('sourced invitation locations enter replay only with the offering event and survive a later cancellation', () => {
  const id = randomUUID(),
    ownerId = randomUUID(),
    actorId = randomUUID(),
    seedId = randomUUID(),
    offerId = randomUUID(),
    invitationId = 'invitation';
  const time = '2026-10-16T10:30:00.000Z',
    at = '2026-10-16T11:30:00.000Z';
  const source = { kind: 'seed_genesis' as const, seedId, snapshotVersion: 0 as const };
  const initial: WorldState = {
    schemaVersion: 1,
    id,
    ownerId,
    version: 0,
    title: '纯测试',
    time,
    actors: [{ id: actorId, name: '朋友', persona: '人物' }],
    messages: [],
    appointments: [],
    facts: [],
    mediaRequests: [],
    space: {
      currentPlaceId: 'restaurant',
      positionSource: source,
      places: [
        {
          id: 'restaurant',
          name: '餐厅',
          description: '已有地点',
          source,
          contactActorIds: [],
          appointmentIds: [],
        },
      ],
      routes: [],
    },
  };
  const command = randomUUID(),
    acceptCommand = randomUUID(),
    cancelCommand = randomUUID();
  const events: WorldHistoryEvent[] = [
    {
      schemaVersion: 1,
      type: 'turn.resolved',
      id: offerId,
      worldId: id,
      commandId: command,
      version: 1,
      occurredAt: time,
      storyAt: time,
      data: {
        actorId,
        userText: '一个可选邀约',
        origin: 'director',
        effects: [
          { type: 'message.received', id: 'message', actorId, text: '晚上有空一起吃饭吗？' },
          {
            type: 'appointment.proposed',
            id: invitationId,
            title: '晚饭',
            at,
            participantIds: [actorId],
          },
        ],
      },
    },
    {
      schemaVersion: 1,
      type: 'invitation.responded',
      id: randomUUID(),
      worldId: id,
      commandId: acceptCommand,
      version: 2,
      occurredAt: time,
      storyTime: time,
      data: {
        worldId: id,
        commandId: acceptCommand,
        id: invitationId,
        expectedVersion: 1,
        operation: 'accept',
      },
    },
    {
      schemaVersion: 1,
      type: 'appointment.waited',
      id: randomUUID(),
      worldId: id,
      commandId: randomUUID(),
      version: 3,
      occurredAt: time,
      storyAt: at,
      data: {
        invitationId,
        invitationResponseVersion: 2,
        placeId: 'restaurant',
        fromStoryAt: time,
        toStoryAt: at,
      },
    },
    {
      schemaVersion: 1,
      type: 'invitation.responded',
      id: randomUUID(),
      worldId: id,
      commandId: cancelCommand,
      version: 4,
      occurredAt: time,
      storyTime: at,
      data: {
        worldId: id,
        commandId: cancelCommand,
        id: invitationId,
        expectedVersion: 3,
        operation: 'cancel',
      },
    },
  ];
  const links = [{ invitationId, placeId: 'restaurant', sourceEventId: offerId }];
  assert.equal(replayWorldHistory(initial, events, 0, links).world.appointments.length, 0);
  assert.deepEqual(
    replayWorldHistory(initial, events, 0, links).world.space!.places[0]!.appointmentIds,
    [],
  );
  const waited = replayWorldHistory(initial, events, 3, links).world;
  assert.equal(waited.time, at);
  assert.equal(waited.appointments[0]!.status, 'confirmed');
  const cancelled = replayWorldHistory(initial, events, 4, links).world;
  assert.equal(cancelled.appointments[0]!.status, 'cancelled');
  assert.deepEqual(cancelled.space!.places[0]!.appointmentIds, [invitationId]);
  assert.throws(() =>
    replayWorldHistory(initial, events, 3, [{ ...links[0]!, sourceEventId: randomUUID() }]),
  );
  assert.deepEqual(initial.space!.places[0]!.appointmentIds, []);
  assert.equal(initial.version, 0);
});
