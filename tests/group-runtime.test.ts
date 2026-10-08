import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGroupWorldEvent,
  reduceGroupEvent,
  groupHistory,
  selectGroupSpeakers,
  type GroupEvent,
} from '../src/modules/world/domain/group-runtime.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import type { ExperienceContext } from '../src/modules/world/domain/experience-rules.ts';
import { assertGroupConversation } from '../src/modules/world/domain/experience-rules.ts';
const world: WorldState = {
  schemaVersion: 1,
  id: 'w',
  ownerId: 'u',
  version: 0,
  title: '试拍',
  time: '2026-10-08T00:00:00.000Z',
  actors: [
    { id: 'a', name: '小陈', persona: '摄影搭档负责镜头' },
    { id: 'b', name: '小王', persona: '录音搭档负责声音' },
    { id: 'c', name: '小王', persona: '场地' },
  ],
  facts: [],
  messages: [],
  appointments: [],
  mediaRequests: [],
};
function base(version: number) {
  return {
    schemaVersion: 1 as const,
    id: `e${version}`,
    ownerId: 'u',
    worldId: 'w',
    commandId: `cmd${version}`,
    version,
    occurredAt: world.time,
    storyAt: world.time,
  };
}
function context(version: number): ExperienceContext {
  return {
    world: { ...world, version },
    events: Array.from({ length: version }, (_, i) => ({
      id: `e${i + 1}`,
      version: i + 1,
      ownerId: 'u',
      worldId: 'w',
    })),
  };
}
const creation: GroupEvent = {
  ...base(1),
  type: 'group.created',
  data: { groupId: 'g', title: '拍摄群', actorIds: ['a'] },
};
test('group event projections reject foreign actors, forged sources, scope and nonmember replies', () => {
  const first = reduceGroupEvent(context(1), undefined, creation);
  assert.equal(first.group.memberships.length, 2);
  assert.throws(() =>
    reduceGroupEvent(context(1), undefined, {
      ...creation,
      data: { ...creation.data, actorIds: ['foreign'] },
    }),
  );
  assert.throws(() => reduceGroupEvent(context(1), undefined, { ...creation, ownerId: 'other' }));
  assert.throws(() => reduceGroupEvent({ ...context(1), events: [] }, undefined, creation));
  assert.throws(() =>
    reduceGroupEvent(context(2), first.group, {
      ...base(2),
      type: 'group.turn_resolved',
      data: { groupId: 'g', replies: [{ actorId: 'b', text: '我不在群中' }] },
    }),
  );
});
test('join/leave/rejoin give player and model identical history boundaries, no gap history', () => {
  let group = reduceGroupEvent(context(1), undefined, creation).group;
  const old = reduceGroupEvent(context(2), group, {
    ...base(2),
    type: 'group.message_sent',
    data: { groupId: 'g', text: '旧消息' },
  }).messages;
  group = reduceGroupEvent(context(3), group, {
    ...base(3),
    type: 'group.membership_changed',
    data: { groupId: 'g', participant: { kind: 'actor', actorId: 'b' }, action: 'join' },
  }).group;
  const visible = reduceGroupEvent(context(4), group, {
    ...base(4),
    type: 'group.message_sent',
    data: { groupId: 'g', text: '加入后消息' },
  }).messages;
  group = reduceGroupEvent(context(5), group, {
    ...base(5),
    type: 'group.membership_changed',
    data: { groupId: 'g', participant: { kind: 'actor', actorId: 'b' }, action: 'leave' },
  }).group;
  const gap = reduceGroupEvent(context(6), group, {
    ...base(6),
    type: 'group.message_sent',
    data: { groupId: 'g', text: '退出期间消息' },
  }).messages;
  assert.deepEqual(
    groupHistory(context(6), group, [...old, ...visible, ...gap], { kind: 'actor', actorId: 'b' }),
    [],
  );
  group = reduceGroupEvent(context(7), group, {
    ...base(7),
    type: 'group.membership_changed',
    data: { groupId: 'g', participant: { kind: 'actor', actorId: 'b' }, action: 'join' },
  }).group;
  const rejoined = reduceGroupEvent(context(8), group, {
    ...base(8),
    type: 'group.message_sent',
    data: { groupId: 'g', text: '重入后消息' },
  }).messages;
  assert.deepEqual(
    groupHistory(context(8), group, [...old, ...visible, ...gap, ...rejoined], {
      kind: 'actor',
      actorId: 'b',
    }).map((m) => m.text),
    ['加入后消息', '重入后消息'],
  );
});
test('speaker selection is relevant and bounded, mentions never force all and duplicate names are not identities', () => {
  const group = reduceGroupEvent(context(1), undefined, {
    ...creation,
    data: { ...creation.data, actorIds: ['a', 'b', 'c'] },
  }).group;
  assert.deepEqual(selectGroupSpeakers(world, group, '@b 声音怎么录'), ['b']);
  assert.equal(selectGroupSpeakers(world, group, '@a @b @c 各位有意见吗', 99).length, 2);
  assert.deepEqual(selectGroupSpeakers(world, group, '不用回复'), []);
  assert.deepEqual(selectGroupSpeakers(world, group, '@小王', 2), ['a']);
  assert.equal(selectGroupSpeakers(world, group, '@a @b', Number.NaN).length, 1);
});
test('past invitations and membership growth cannot leave an unreadable saved projection', () => {
  const group = reduceGroupEvent(context(1), undefined, creation).group;
  assert.throws(
    () =>
      reduceGroupEvent(context(2), group, {
        ...base(2),
        type: 'group.turn_resolved',
        data: {
          groupId: 'g',
          replies: [
            { actorId: 'a', text: '约一下？', invitation: { title: '过期邀请', at: world.time } },
          ],
        },
      }),
    { code: 'INVALID_COMMAND' },
  );
  const atLimit = {
    ...group,
    memberships: Array.from({ length: 1000 }, (_, i) => ({
      participant: { kind: 'player' as const },
      joinedVersion: 2 * i + 1,
      ...(i === 999 ? {} : { leftVersion: 2 * i + 2 }),
      sourceVersion: 2 * i + 1,
      sourceEventId: `e${2 * i + 1}`,
    })),
  };
  assertGroupConversation(context(2000), atLimit);
  assert.throws(
    () =>
      reduceGroupEvent(context(2001), atLimit, {
        ...base(2001),
        type: 'group.membership_changed',
        data: { groupId: 'g', participant: { kind: 'actor', actorId: 'b' }, action: 'join' },
      }),
    { code: 'INVALID_COMMAND' },
  );
  assert.equal(atLimit.memberships.length, 1000);
});
test('World extension preserves private history and version/time, invitation remains proposed', () => {
  const event: GroupEvent = {
    ...base(1),
    type: 'group.turn_resolved',
    data: {
      groupId: 'g',
      replies: [
        {
          actorId: 'a',
          text: '明天一起试拍？',
          invitation: { title: '试拍', at: '2026-10-09T00:00:00.000Z' },
        },
      ],
    },
  };
  const next = applyGroupWorldEvent(world, event);
  assert.equal(next.version, 1);
  assert.deepEqual(next.messages, world.messages);
  assert.equal(next.appointments[0]!.status, 'proposed');
  assert.throws(() => applyGroupWorldEvent(world, { ...event, version: 4 }));
  assert.throws(() =>
    applyGroupWorldEvent(world, { ...event, storyAt: '2026-10-07T00:00:00.000Z' }),
  );
});
