import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyInvitationSchedule } from '../src/modules/world/domain/history-invitations.ts';
import {
  validateHistoryConnections,
  createGenesisLinks,
} from '../src/modules/world/domain/genesis-links.ts';
import { genesisMessages } from '../src/modules/world/domain/genesis-messages.ts';
import { HistoryPlanner } from '../src/modules/world/infrastructure/history-planner.ts';
import type { WorldOpening } from '../src/contracts/world-build.ts';
import { randomUUID } from 'node:crypto';

const opening: WorldOpening = {
  identity: '合成修车铺成员',
  setting: '合成修车铺',
  actors: ['a', 'b'].map((key) => ({
    key,
    name: '同名朋友',
    relationship: 'NOT_PUBLIC_' + key,
    persona: 'SECRET_PERSONA_' + key,
  })),
  messages: [{ actorKey: 'a', text: '当前开场来信' }],
  notes: [{ title: 'Private', text: 'SECRET_NOTE' }],
};
const start = '2026-12-31T15:59:30.123Z';
const invitation = (body = '来铺子一起整理配件，愿意吗？', slotId = 'next_morning') => ({
  minutesBeforeStart: 1440,
  invitation: { slotId, body },
});
function response(
  first: unknown[],
  second: unknown[] = [{ text: '上次留下的工具还在这里。', minutesBeforeStart: 2880 }],
) {
  return {
    groups: [
      { actorIndex: 1, messages: second },
      { actorIndex: 0, messages: first },
    ],
  };
}

test('Q literal midnight, next-day, leap and century cases preserve subminute offsets', () => {
  for (const [t, expected] of [
    [start, ['2026-12-31T16:59:30.123Z', '2027-01-01T02:00:30.123Z', '2027-01-01T11:00:30.123Z']],
    [
      '2028-02-28T15:30:00.000Z',
      ['2028-02-28T16:30:00.000Z', '2028-02-29T02:00:00.000Z', '2028-02-29T11:00:00.000Z'],
    ],
    [
      '2027-02-28T15:30:00.000Z',
      ['2027-02-28T16:30:00.000Z', '2027-03-01T02:00:00.000Z', '2027-03-01T11:00:00.000Z'],
    ],
    [
      '1999-12-31T15:30:00.000Z',
      ['1999-12-31T16:30:00.000Z', '2000-01-01T02:00:00.000Z', '2000-01-01T11:00:00.000Z'],
    ],
    [
      '1900-02-28T15:30:00.000Z',
      ['1900-02-28T16:30:00.000Z', '1900-03-01T02:00:00.000Z', '1900-03-01T11:00:00.000Z'],
    ],
    [
      '2026-10-10T16:00:00.303Z',
      ['2026-10-10T17:00:00.303Z', '2026-10-12T02:00:00.303Z', '2026-10-12T11:00:00.303Z'],
    ],
  ] as const) {
    const schedule = historyInvitationSchedule(t);
    for (const [i, slot] of schedule.slots.entries()) {
      const rendered = schedule.render({
        slotId: slot.slotId,
        body: '来铺子一起整理配件，愿意吗？',
      });
      const offset = rendered.connection.calendar.minutesAfterStart;
      assert(Number.isInteger(offset));
      assert.equal(new Date(Date.parse(t) + offset * 60000).toISOString(), expected[i]);
      assert.equal(rendered.text, rendered.connection.quote);
      validateHistoryConnections(
        {
          version: 1,
          messages: [{ key: 'past_a', actorKey: 'a', minutesBeforeStart: 2880, ...rendered }],
        },
        t,
      );
    }
  }
  const schedule = historyInvitationSchedule(start);
  assert.deepEqual(
    schedule.slots.map((s) => s.label),
    ['2027年1月1日 00:59', '2027年1月1日 10:00', '2027年1月1日 19:00'],
  );
});

test('Q P8 remains invalid and explicit wrong year cannot hide behind a matching month/day', () => {
  const time = '2026-10-10T08:18:15.303Z';
  const entry = {
    key: 'p8',
    actorKey: 'a',
    minutesBeforeStart: 2880,
    text: '咱们干脆周末一起去爬山吧',
    connection: { quote: '咱们干脆周末一起去爬山吧', calendar: { minutesAfterStart: 2880 } },
  };
  assert.throws(
    () => validateHistoryConnections({ version: 1, messages: [entry] }, time),
    /INVALID_GENESIS_LINKS/,
  );
  const r = historyInvitationSchedule(time).render({
    slotId: 'next_morning',
    body: '来铺子一起整理配件，愿意吗？',
  });
  for (const bad of [
    r.text.replace('2026年', '2025年'),
    r.text.replace('10:00', '11:00'),
    r.text + '，10月12日 10:00',
  ]) {
    assert.throws(
      () =>
        validateHistoryConnections(
          {
            version: 1,
            messages: [{ ...entry, text: bad, connection: { ...r.connection, quote: bad } }],
          },
          time,
        ),
      /INVALID_GENESIS_LINKS/,
    );
  }
  // Yearless legacy P persists under its old guard; no renderer is called on reads.
  const old = r.text.replace('2026年', '');
  validateHistoryConnections(
    {
      version: 1,
      messages: [{ ...entry, text: old, connection: { ...r.connection, quote: old } }],
    },
    time,
  );
});

test('Q scan rejects temporal syntax/controls without normalizing saved activity or silently truncating', () => {
  const schedule = historyInvitationSchedule(start);
  for (const body of [
    '下周二来整理配件',
    '三小时后一起整理',
    '礼拜天去爬山',
    'Ｔｏｍｏｒｒｏｗ来整理',
    '１９：００来整理',
    '１／２来整理',
    '明\u200b天来整理',
    '来\n整理配件',
    '来\u202e整理配件',
    '【时间】来整理',
    '<date>来整理',
    '你好！',
    '愿意吗？',
    '甲'.repeat(61),
  ])
    assert.throws(
      () => schedule.render({ slotId: 'next_morning', body }),
      /INVALID_HISTORY_INVITATION/,
    );
  for (const slotId of ['soon ', 'SOON', 'next_morning\u200b', 'weekend', ''])
    assert.throws(() => schedule.render({ slotId, body: '来铺子一起整理配件' }));
  const body = '去Ｃ区一起整理设备，你有空吗？';
  assert(schedule.render({ slotId: 'next_morning', body }).text.endsWith(body));
  assert.throws(() => schedule.render({ slotId: 'next_evening', body: '一起晨练吧' }));
  assert.throws(() => schedule.render({ slotId: 'next_morning', body: '一起去夜市吧' }));
  // This deliberately documents a bounded lexical gate, not general semantic proof.
  assert(
    schedule
      .render({ slotId: 'next_evening', body: '一起看太阳从地平线升起' })
      .text.includes('太阳'),
  );
});

test('Q adapter enforces union/cast/count/source while distinguishing same-slot different proposals', async () => {
  let calls = 0;
  const body1 = '来铺子一起整理配件，愿意吗？',
    body2 = '一起去步道试试相机，可以吗？';
  const history = await new HistoryPlanner(
    {
      async complete(messages) {
        calls++;
        const input = JSON.parse(messages[1]!.content);
        assert.equal(input.invitationSlots.length, 3);
        assert(
          input.invitationSlots.every(
            (s: object) => Object.keys(s).sort().join(',') === 'label,slotId',
          ),
        );
        assert(!JSON.stringify(input).includes('SECRET_'));
        assert(!JSON.stringify(input).includes('NOT_PUBLIC_'));
        return JSON.stringify(
          response([invitation(body1), { ...invitation(body2), minutesBeforeStart: 2880 }]),
        );
      },
    },
    true,
  ).propose(opening, start);
  assert.equal(calls, 1);
  assert.equal(history.messages.length, 3);
  assert(!JSON.stringify(history).includes('slotId'));
  assert(!JSON.stringify(history).includes('invitation'));
  const worldId = randomUUID(),
    actors = new Map([
      ['a', randomUUID()],
      ['b', randomUUID()],
    ]),
    messages = genesisMessages({
      worldId,
      startAt: start,
      actors,
      history,
      current: opening.messages,
      newId: randomUUID,
    }),
    links = createGenesisLinks({
      worldId,
      seedId: randomUUID(),
      startAt: start,
      actorIds: actors,
      history,
      messages,
      newId: randomUUID,
    });
  assert.equal(links.appointments.length, 2);
  assert.notEqual(links.appointments[0]!.id, links.appointments[1]!.id);
  assert.equal(links.appointments[0]!.at, links.appointments[1]!.at);
  assert.equal(messages.filter((m) => m.initialRead === true).length, 3);
  assert.equal(messages.filter((m) => m.initialRead === false).length, 1);
  assert.equal(messages.filter((m) => m.role === 'user').length, 0);
  for (const item of links.genesisLinks.entries) {
    const m = messages.find((m) => m.id === item.messageId)!;
    assert.equal(m.actorId, item.actorId);
    assert.equal(m.sourceEventId, 'genesis:' + worldId);
    assert.equal(
      m.at,
      new Date(
        Date.parse(start) - (m.history!.key.endsWith('_0') ? 1440 : 2880) * 60000,
      ).toISOString(),
    );
  }
  for (const invalid of [
    response([{ ...invitation(), text: '不能混普通正文' }]),
    response([
      {
        text: '来整理',
        minutesBeforeStart: 1440,
        connection: { quote: '来整理', calendar: { minutesAfterStart: 60 } },
      },
    ]),
    response([{ minutesBeforeStart: 1440, invitation: { slotId: 'soon' } }]),
    response([invitation(), { ...invitation(), minutesBeforeStart: 2880 }]),
    response([invitation(), invitation(body2)]),
    response(
      [invitation(), { ...invitation(body2), minutesBeforeStart: 2880 }],
      [{ minutesBeforeStart: 4320, invitation: { slotId: 'soon', body: '一起检查备用工具吧' } }],
    ),
    { groups: [{ actorIndex: 0, messages: [invitation()] }] },
    {
      groups: [
        { actorIndex: 0, messages: [invitation()] },
        { actorIndex: 2, messages: [invitation()] },
      ],
    },
    {
      groups: [
        { actorIndex: 0, messages: [invitation()] },
        { actorIndex: 0, messages: [invitation()] },
      ],
    },
    response(
      Array.from({ length: 7 }, (_, i) => ({ text: '普通来信', minutesBeforeStart: 60 + i })),
    ),
  ]) {
    let attempts = 0;
    await assert.rejects(
      new HistoryPlanner(
        {
          async complete() {
            attempts++;
            return JSON.stringify(invalid);
          },
        },
        true,
      ).propose(opening, start),
      { code: 'INVALID_RESPONSE' },
    );
    assert.equal(attempts, 2);
  }
});

test('Q zero/record-only and N compatibility remain honest; correction uses same slots, unknown never retries', async () => {
  const ordinary = { text: '周末那本维修手册还在柜子里。', minutesBeforeStart: 1440 };
  const zero = await new HistoryPlanner(
    {
      async complete() {
        return JSON.stringify(response([ordinary]));
      },
    },
    true,
  ).propose(opening, start);
  assert(zero.messages.every((m) => !m.connection));
  const record = await new HistoryPlanner(
    {
      async complete() {
        return JSON.stringify(
          response([{ ...ordinary, connection: { quote: '维修手册还在柜子里' } }]),
        );
      },
    },
    true,
  ).propose(opening, start);
  assert.equal(record.messages.find((m) => m.actorKey === 'a')!.connection!.calendar, undefined);
  const legacy = await new HistoryPlanner(
    {
      async complete(messages) {
        assert(!messages[1]!.content.includes('invitationSlots'));
        return JSON.stringify(response([ordinary]));
      },
    },
    false,
  ).propose(opening, start);
  assert.deepEqual(legacy, zero);
  let count = 0,
    input0 = '';
  await new HistoryPlanner(
    {
      async complete(messages) {
        count++;
        const input = messages[1]!.content;
        if (count === 1) {
          input0 = input;
          return JSON.stringify(response([invitation('周末一起爬山')]));
        }
        assert.equal(input, input0);
        return JSON.stringify(response([invitation()]));
      },
    },
    true,
  ).propose(opening, start);
  assert.equal(count, 2);
  let requests = 0;
  const unknown = Object.assign(Error('explicit transport fixture'), { code: 'UNKNOWN' });
  await assert.rejects(
    new HistoryPlanner(
      {
        async complete() {
          requests++;
          throw unknown;
        },
      },
      true,
    ).propose(opening, start),
    (e) => e === unknown,
  );
  assert.equal(requests, 1);
  const controller = new AbortController();
  controller.abort();
  requests = 0;
  await assert.rejects(
    new HistoryPlanner(
      {
        async complete() {
          requests++;
          return '{}';
        },
      },
      true,
    ).propose(opening, start, controller.signal),
  );
  assert.equal(requests, 0);
});
