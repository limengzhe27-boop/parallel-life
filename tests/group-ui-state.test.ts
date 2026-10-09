import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  activeMembers,
  mergeGroupDetail,
  groupTarget,
  isJoined,
  localGroupKey,
  mayExecute,
  mayRetry,
  parseGroupTarget,
  publicMemberName,
  restorePending,
  taskText,
} from '../src/features/phone/groups/state.ts';
import type { GroupConversation } from '../src/contracts/world-experiences.ts';
import type { GroupTask } from '../src/features/phone/groups/client.ts';
const worldId = randomUUID(),
  groupId = randomUUID(),
  actorId = randomUUID(),
  sourceEventId = randomUUID();
const group: GroupConversation = {
  id: groupId,
  worldId,
  ownerId: randomUUID(),
  title: 'Rehearsal',
  sourceEventId,
  sourceVersion: 1,
  memberships: [
    { participant: { kind: 'player' }, joinedVersion: 1, sourceEventId, sourceVersion: 1 },
    {
      participant: { kind: 'actor', actorId },
      joinedVersion: 1,
      leftVersion: 3,
      sourceEventId,
      sourceVersion: 1,
    },
  ],
};
test('explicit group targets cannot collide with private contacts', () => {
  assert.equal(parseGroupTarget(groupTarget(groupId)), groupId);
  assert.equal(parseGroupTarget(actorId), undefined);
  assert.equal(parseGroupTarget('group:invalid'), undefined);
});
test('member labels use public contacts; closed intervals are not active members', () => {
  assert.equal(activeMembers(group).length, 1);
  assert.equal(isJoined(group), true);
  assert.equal(publicMemberName({ kind: 'actor', actorId }, []), '群成员');
  assert.equal(
    publicMemberName({ kind: 'actor', actorId }, [
      { id: actorId, name: 'Chen', relationship: 'friend', unread: 0 },
    ]),
    'Chen',
  );
  assert.equal(
    isJoined({ ...group, memberships: group.memberships.map((m) => ({ ...m, leftVersion: 3 })) }),
    false,
  );
});
test('reconciliation is world/group scoped and corrupt records never become commands', () => {
  const saved = {
    worldId,
    groupId,
    commandId: randomUUID(),
    expectedVersion: 2,
    text: 'hello',
    taskId: randomUUID(),
  };
  assert.deepEqual(restorePending(JSON.stringify(saved), worldId, groupId), saved);
  assert.equal(restorePending(JSON.stringify(saved), randomUUID(), groupId), undefined);
  assert.equal(restorePending(JSON.stringify(saved), worldId, randomUUID()), undefined);
  assert.equal(restorePending('{broken', worldId, groupId), undefined);
  assert.equal(
    restorePending(JSON.stringify({ ...saved, ownerId: 'spoof' }), worldId, groupId),
    undefined,
  );
  assert.notEqual(
    localGroupKey(worldId, groupId, 'draft'),
    localGroupKey(worldId, groupId, 'pending'),
  );
});
test('unknown/failed/cancelled require explicit retry; running and succeeded never execute again', () => {
  const base: GroupTask = {
    id: randomUUID(),
    scope: { kind: 'world', worldId },
    status: 'queued',
    errorCode: null,
    resultVersion: null,
    createdAt: '2026-10-09T03:00:00.000Z',
    updatedAt: '2026-10-09T03:00:00.000Z',
  };
  assert.equal(mayExecute(base), true);
  for (const status of ['running', 'succeeded', 'failed', 'unknown', 'cancelled'] as const) {
    const t = { ...base, status };
    assert.equal(mayExecute(t), false);
    assert.equal(mayRetry(t), ['failed', 'unknown', 'cancelled'].includes(status));
  }
  assert.match(taskText({ ...base, status: 'unknown' }), /不能确认/);
  assert.equal(taskText({ ...base, status: 'succeeded' }), '');
});

test('late refresh cannot roll back history or a newer read receipt', () => {
  const detail = {
    group,
    version: 4,
    storyAt: '2026-10-09T03:00:00.000Z',
    messages: [],
    messageTimes: {},
    lastReadVersion: 4,
    unread: 0,
  };
  assert.equal(mergeGroupDetail(detail, { ...detail, version: 3 }), detail);
  assert.equal(mergeGroupDetail(detail, { ...detail, lastReadVersion: 0 }).lastReadVersion, 4);
  const message = {
    id: randomUUID(),
    ownerId: group.ownerId,
    worldId,
    sourceEventId,
    sourceVersion: 5,
    conversationId: groupId,
    sender: { kind: 'actor' as const, actorId },
    text: 'new',
    media: [],
  };
  const merged = mergeGroupDetail(detail, {
    ...detail,
    version: 5,
    lastReadVersion: 1,
    messages: [message],
    unread: 1,
  });
  assert.equal(merged.lastReadVersion, 4);
  assert.equal(merged.unread, 1);
});
