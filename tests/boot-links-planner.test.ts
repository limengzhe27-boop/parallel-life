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
function response(quoteValue = quote, minutes = 60) {
  return {
    groups: [
      { actorIndex: 1, messages: [{ text: 'Old B', minutesBeforeStart: 1441 }] },
      {
        actorIndex: 0,
        messages: [
          {
            text: quote,
            minutesBeforeStart: 1440,
            connection: { quote: quoteValue, calendar: { minutesAfterStart: minutes } },
          },
        ],
      },
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
test('exact quote and explicit date failures correct once without changing world or adding a phase', async () => {
  for (const bad of [response('unquoted'), response(quote, 120)]) {
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
