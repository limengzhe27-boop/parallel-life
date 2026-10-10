import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryPlanner } from '../src/modules/world/infrastructure/history-planner.ts';
const at = '1998-12-31T15:30:00.000Z';
const quote =
  '1\u67081\u65e500:30\u4e00\u8d77\u6574\u7406\u914d\u4ef6\uff0c\u613f\u610f\u6765\u5417\uff1f';
const opening = {
  identity: 'Owner',
  setting: 'Local shop',
  actors: ['a', 'b'].map((key) => ({ key, name: key, relationship: 'hidden', persona: 'private' })),
  messages: [{ actorKey: 'a', text: 'Current' }],
  notes: [{ title: 'Private', text: 'Never send' }],
};
function response(slotId = 'soon', body = '一起整理配件，愿意来吗？') {
  return {
    groups: [
      { actorIndex: 1, messages: [{ text: 'Old B', minutesBeforeStart: 1441 }] },
      { actorIndex: 0, messages: [{ minutesBeforeStart: 1440, invitation: { slotId, body } }] },
    ],
  };
}
test('linked planner binds reordered cast, fixes explicit story date and keeps private input trimmed', async () => {
  let calls = 0;
  const result = await new HistoryPlanner(
    {
      async complete(messages) {
        calls++;
        assert(messages[0]!.content.includes('connection'));
        assert(!messages[1]!.content.includes('private'));
        assert(!messages[1]!.content.includes('hidden'));
        return JSON.stringify(response());
      },
    },
    true,
  ).propose(opening, at);
  assert.equal(calls, 1);
  assert.equal(result.messages.find((m) => m.connection)!.actorKey, 'a');
});
test('unknown slot and contradictory temporal body correct once without changing world or adding a phase', async () => {
  for (const bad of [response('unknown'), response('soon', '周末一起整理配件')]) {
    let calls = 0;
    const result = await new HistoryPlanner(
      {
        async complete() {
          return JSON.stringify(++calls === 1 ? bad : response());
        },
      },
      true,
    ).propose(opening, at);
    assert.equal(calls, 2);
    assert.equal(
      result.messages.find((m) => m.connection)!.connection!.calendar!.minutesAfterStart,
      60,
    );
  }
});
test('disabled mode refuses connection; transport unknown never pays for another output', async () => {
  let calls = 0;
  await assert.rejects(
    new HistoryPlanner({
      async complete() {
        calls++;
        return JSON.stringify(response());
      },
    }).propose(opening, at),
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    new HistoryPlanner(
      {
        async complete() {
          calls++;
          throw Object.assign(Error('unknown'), { code: 'TIMEOUT' });
        },
      },
      true,
    ).propose(opening, at),
  );
  assert.equal(calls, 1);
});

test('same actor-slot duplicates and mixed control fields fail; different actors may share a slot', async () => {
  const duplicate = response() as any;
  duplicate.groups[1]!.messages.push({
    minutesBeforeStart: 1441,
    invitation: { slotId: 'soon', body: '一起整理配件，愿意来吗？' },
  });
  const mixed = response();
  Object.assign(mixed.groups[1]!.messages[0]!, { text: 'separate text' });
  const hiddenTime = response() as any;
  Object.assign(hiddenTime.groups[1]!.messages[0]!.invitation, { minutesAfterStart: 60 });
  for (const bad of [duplicate, mixed, hiddenTime]) {
    let calls = 0;
    await assert.rejects(
      new HistoryPlanner(
        {
          async complete() {
            calls++;
            return JSON.stringify(bad);
          },
        },
        true,
      ).propose(opening, at),
    );
    assert.equal(calls, 2);
  }
  const shared = {
    groups: [0, 1].map((actorIndex) => ({
      actorIndex,
      messages: [
        {
          minutesBeforeStart: 1440,
          invitation: { slotId: 'soon', body: '一起整理自己这批配件，你愿意来吗？' },
        },
      ],
    })),
  };
  const result = await new HistoryPlanner(
    {
      async complete() {
        return JSON.stringify(shared);
      },
    },
    true,
  ).propose(opening, at);
  assert.equal(result.messages.filter((m) => m.connection?.calendar).length, 2);
  assert.equal(new Set(result.messages.map((m) => m.actorKey)).size, 2);
});

test('distinct activities by one actor are not merged; zero invitations and exact record-only quote remain legal', async () => {
  const distinct = response() as any;
  distinct.groups[1].messages.push({
    minutesBeforeStart: 1442,
    invitation: { slotId: 'soon', body: '一起核对旧轮胎，愿意来吗？' },
  });
  const result = await new HistoryPlanner(
    {
      async complete() {
        return JSON.stringify(distinct);
      },
    },
    true,
  ).propose(opening, at);
  assert.equal(result.messages.filter((m) => m.connection?.calendar).length, 2);
  const plain = {
    groups: [
      {
        actorIndex: 0,
        messages: [
          {
            text: '带来的配件已经单独收好',
            minutesBeforeStart: 1440,
            connection: { quote: '配件已经单独收好' },
          },
        ],
      },
      { actorIndex: 1, messages: [{ text: '旧来信乙', minutesBeforeStart: 1440 }] },
    ],
  };
  const records = await new HistoryPlanner(
    {
      async complete() {
        return JSON.stringify(plain);
      },
    },
    true,
  ).propose(opening, at);
  assert.equal(records.messages.filter((m) => m.connection).length, 1);
  assert.equal(records.messages.filter((m) => m.connection?.calendar).length, 0);
  delete (plain.groups[0]!.messages[0] as any).connection;
  const zero = await new HistoryPlanner(
    {
      async complete() {
        return JSON.stringify(plain);
      },
    },
    true,
  ).propose(opening, at);
  assert.equal(zero.messages.filter((m) => m.connection).length, 0);
});
