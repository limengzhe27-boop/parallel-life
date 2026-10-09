import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  replayWorldHistory,
  type WorldHistoryEvent,
} from '../src/modules/world/domain/world-history.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
test('mixed history restores group messages and membership gaps without private chat contamination', () => {
  const world: WorldState = {
    schemaVersion: 1,
    id: randomUUID(),
    ownerId: randomUUID(),
    version: 0,
    title: '试拍',
    time: '2026-10-09T00:00:00.000Z',
    actors: [{ id: randomUUID(), name: '小陈', persona: '搭档' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  const groupId = randomUUID(),
    actorId = world.actors[0]!.id;
  const b = (version: number) => ({
    schemaVersion: 1 as const,
    id: randomUUID(),
    ownerId: world.ownerId,
    worldId: world.id,
    commandId: randomUUID(),
    version,
    occurredAt: world.time,
    storyAt: world.time,
  });
  const events: WorldHistoryEvent[] = [
    { ...b(1), type: 'group.created', data: { groupId, title: '拍摄群', actorIds: [actorId] } },
    { ...b(2), type: 'group.message_sent', data: { groupId, text: '一起试灯' } },
    {
      ...b(3),
      type: 'group.membership_changed',
      data: { groupId, participant: { kind: 'actor', actorId }, action: 'leave' },
    },
    { ...b(4), type: 'group.message_sent', data: { groupId, text: '离开期间的消息' } },
    {
      ...b(5),
      type: 'group.membership_changed',
      data: { groupId, participant: { kind: 'actor', actorId }, action: 'join' },
    },
    {
      ...b(6),
      type: 'group.turn_resolved',
      data: { groupId, replies: [{ actorId, text: '我回来了' }] },
    },
  ];
  const end = replayWorldHistory(world, events);
  assert.equal(end.world.version, 6);
  assert.equal(end.world.messages.length, 0);
  assert.equal(end.messages.length, 3);
  assert.equal(end.groups[0]!.memberships.length, 3);
  const atLeave = replayWorldHistory(world, events, 3);
  assert.equal(atLeave.world.version, 3);
  assert.equal(atLeave.messages.length, 1);
  assert.equal(atLeave.groups[0]!.memberships[1]!.leftVersion, 3);
  assert.throws(() => replayWorldHistory(world, [{ ...events[0]!, worldId: randomUUID() }]), {
    code: 'VERSION_CONFLICT',
  });
  assert.throws(() => replayWorldHistory(world, [events[1]!]), { code: 'VERSION_CONFLICT' });
});
