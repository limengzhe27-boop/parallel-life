import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  genesisMessages,
  validateMessageHistory,
  type MessageHistoryProposal,
} from '../src/modules/world/domain/genesis-messages.ts';
import {
  WorldOpeningSchema,
  MessageHistorySchema,
  WorldPhoneSchema,
} from '../src/contracts/world-build.ts';
import { actorContext } from '../src/modules/world/application/actor-context.ts';
import { projectMessageNotifications } from '../src/features/phone/notification-projection.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
const history = (): MessageHistoryProposal => ({
  version: 1,
  messages: [
    {
      key: 'a_old',
      actorKey: 'a',
      text: '上周保留的场地到周五，修改时间再告诉我。',
      minutesBeforeStart: 10080,
    },
    { key: 'b_old', actorKey: 'b', text: '器材已检查，借用时提前联系。', minutesBeforeStart: 3000 },
    {
      key: 'a_later',
      actorKey: 'a',
      text: '场地时间仍然保留。',
      minutesBeforeStart: 1440,
      replyToKey: 'a_old',
    },
  ],
});
const actors = new Map([
  ['a', 'actor-a'],
  ['b', 'actor-b'],
]);
const messages = () => {
  let n = 0;
  return genesisMessages({
    worldId: 'world',
    startAt: '1998-01-01T00:00:00.000Z',
    actors,
    history: history(),
    current: [{ actorKey: 'a', text: '今天要不要先看看场地？' }],
    newId: () => `message-${++n}`,
  });
};
test('runtime fixes all NPC history to one story start, maps references and orders dates across years', () => {
  const m = messages();
  assert.equal(m.length, 4);
  assert(m.every((x) => x.role === 'assistant'));
  assert(m.slice(0, 3).every((x) => x.initialRead === true));
  assert.equal(m[3]!.initialRead, false);
  assert.equal(m[0]!.at, '1997-12-25T00:00:00.000Z');
  assert.equal(m[3]!.at, '1997-12-31T23:55:00.000Z');
  assert.equal(m[2]!.history?.replyToMessageId, m[0]!.id);
  assert.equal(new Set(m.map((x) => x.id)).size, 4);
  assert(m.every((x) => x.sourceEventId === 'genesis:world'));
});
test('new write rejects missing history, actor gaps, duplicate keys/times, future/range/role/reference violations', () => {
  const base = history(),
    e = base.messages[0]!;
  const bad: unknown[] = [
    ...[undefined, 123].map((key) => ({
      ...base,
      messages: [{ ...e, key }, ...base.messages.slice(1)],
    })),
    { ...base, messages: [{ ...e, replyToKey: 123 }, ...base.messages.slice(1)] },
    undefined,
    { ...base, version: 2 },
    { ...base, messages: base.messages.filter((x) => x.actorKey === 'a') },
    { ...base, messages: [...base.messages, e] },
    { ...base, messages: [...base.messages, { ...e, key: 'duplicate_time' }] },
    ...[0, -1, 59, 43201, 1.2, NaN].map((minutesBeforeStart) => ({
      ...base,
      messages: [{ ...e, minutesBeforeStart }, ...base.messages.slice(1)],
    })),
    { ...base, messages: [{ ...e, actorKey: 'outsider' }, ...base.messages.slice(1)] },
    { ...base, messages: [{ ...e, role: 'user' }, ...base.messages.slice(1)] },
    ...['missing', 'b_old', 'a_later', 'a_old'].map((replyToKey) => ({
      ...base,
      messages: [{ ...e, replyToKey }, ...base.messages.slice(1)],
    })),
    {
      ...base,
      messages: [
        ...base.messages,
        ...Array.from({ length: 5 }, (_, i) => ({
          ...e,
          key: `extra_${i}`,
          minutesBeforeStart: 500 + i,
        })),
      ],
    },
  ];
  for (const value of bad)
    assert.throws(
      () => validateMessageHistory(value as MessageHistoryProposal, ['a', 'b']),
      /INVALID_MESSAGE_HISTORY/,
    );
});
test('versioned proposal strict fields refuse fabricated player input while legacy opening stays readable', () => {
  assert(MessageHistorySchema.safeParse(history()).success);
  assert(
    !MessageHistorySchema.safeParse({
      ...history(),
      messages: history().messages.map((x) => ({ ...x, role: 'user' })),
    }).success,
  );
  const legacy = {
    identity: '修车铺店主',
    setting: '老街',
    actors: [
      { key: 'a', name: '甲', relationship: '邻居', persona: '耐心' },
      { key: 'b', name: '乙', relationship: '同行', persona: '谨慎' },
    ],
    messages: [{ actorKey: 'a', text: '早。' }],
    notes: [{ title: '工具', text: '检查扳手' }],
  };
  assert(WorldOpeningSchema.safeParse(legacy).success);
  assert.equal(WorldOpeningSchema.parse(legacy).messageHistory, undefined);
});
test('fresh-browser notifications exclude initial history but current and later replies can notify', () => {
  const m = messages(),
    contacts = [
      { id: 'actor-a', name: '甲' },
      { id: 'actor-b', name: '乙' },
    ];
  assert.deepEqual(
    projectMessageNotifications(m, contacts, new Set(), (x) => x).map((x) => x.id),
    [m[3]!.id],
  );
  const later = { ...m[3]!, id: 'later', initialRead: undefined, at: '1998-01-02T00:00:00.000Z' };
  assert.deepEqual(
    projectMessageNotifications([...m, later], contacts, new Set([m[3]!.id]), (x) => x).map(
      (x) => x.id,
    ),
    ['later'],
  );
});
test('actor context remembers its own old messages and cannot retrieve another actor private thread', () => {
  const state: WorldState = {
    schemaVersion: 1,
    id: 'world',
    ownerId: 'owner',
    version: 0,
    title: '场地',
    time: '1998-01-01T00:00:00.000Z',
    actors: [
      { id: 'actor-a', name: '甲', persona: '自己的内心' },
      { id: 'actor-b', name: '乙', persona: '另一人的秘密' },
    ],
    messages: messages(),
    facts: [],
    appointments: [],
    mediaRequests: [],
  };
  const a = actorContext(state, 'actor-a', '场地'),
    b = actorContext(state, 'actor-b', '场地');
  assert(a.messages.some((x) => x.text.includes('上周保留')));
  assert(a.messages.every((x) => x.actorId === 'actor-a'));
  assert(b.messages.every((x) => x.actorId === 'actor-b'));
  assert(!JSON.stringify(b).includes('场地时间仍然保留'));
  const blocked = actorContext(state, 'actor-a', '场地', [], new Set(['genesis:world']));
  assert.deepEqual(blocked.messages, []);
});

test('current unread messages retain distinct visible minutes inside the last hour', () => {
  let n = 0;
  const startAt = '1998-01-01T00:00:00.000Z';
  const m = genesisMessages({
    worldId: 'world',
    startAt,
    actors,
    history: history(),
    current: Array.from({ length: 4 }, (_, i) => ({
      actorKey: i % 2 ? 'b' : 'a',
      text: '当前来信' + i,
    })),
    newId: () => String(++n),
  });
  const current = m.filter((x) => x.initialRead === false);
  assert.equal(new Set(current.map((x) => x.at.slice(0, 16))).size, 4);
  assert.deepEqual(
    current.map((x) => (Date.parse(startAt) - Date.parse(x.at)) / 60000),
    [45, 25, 12, 5],
  );
  assert(
    Math.max(...m.filter((x) => x.initialRead).map((x) => Date.parse(x.at))) <
      Math.min(...current.map((x) => Date.parse(x.at))),
  );
});
