import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyInvitationSchedule } from '../src/modules/world/domain/history-invitations.ts';
import { validateHistoryConnections } from '../src/modules/world/domain/genesis-links.ts';

test('late-night fixed story time offers next-day daytime across year and preserves subminute precision', () => {
  const start = '1998-12-31T15:30:12.345Z',
    schedule = historyInvitationSchedule(start);
  assert.deepEqual(schedule.slots, [
    { slotId: 'soon', label: '1999年1月1日 00:30' },
    { slotId: 'next_morning', label: '1999年1月1日 10:00' },
    { slotId: 'next_evening', label: '1999年1月1日 19:00' },
  ]);
  for (const [slotId, expected] of [
    ['soon', '1998-12-31T16:30:12.345Z'],
    ['next_morning', '1999-01-01T02:00:12.345Z'],
    ['next_evening', '1999-01-01T11:00:12.345Z'],
  ]) {
    const message = schedule.render({
      slotId: slotId!,
      body: '来修车铺一起整理新配件，愿意来吗？',
    });
    const minutes = message.connection.calendar.minutesAfterStart;
    assert(Number.isInteger(minutes));
    assert.equal(new Date(Date.parse(start) + minutes * 60000).toISOString(), expected);
    assert.equal(message.connection.quote, message.text);
    validateHistoryConnections(
      { version: 1, messages: [{ key: 'a', actorKey: 'a', minutesBeforeStart: 1440, ...message }] },
      start,
    );
  }
  assert.throws(() => {
    (schedule.slots[0] as any).label = 'model altered';
  });
  assert.throws(() => {
    (schedule.slots as any).push({ slotId: 'other', label: 'fake' });
  });
});

test('month end, leap day, small years and host timezone do not move story slots', () => {
  for (const [start, label] of [
    ['2024-02-28T15:59:59.999Z', '2024年2月29日 10:00'],
    ['2023-02-28T15:59:00.000Z', '2023年3月1日 10:00'],
    ['2026-04-30T15:59:00.000Z', '2026年5月1日 10:00'],
    ['0099-12-31T15:59:00.000Z', '0100年1月1日 10:00'],
  ]) {
    const old = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      const a = historyInvitationSchedule(start!);
      process.env.TZ = 'Asia/Tokyo';
      assert.deepEqual(historyInvitationSchedule(start!).slots, a.slots);
      assert.equal(a.slots[1]!.label, label);
    } finally {
      if (old === undefined) delete process.env.TZ;
      else process.env.TZ = old;
    }
  }
  for (const bad of [
    '2026-02-30T00:00:00.000Z',
    'no-date',
    '2026-10-10T10:00:00',
    '9999-12-31T15:59:00.000Z',
  ])
    assert.throws(() => historyInvitationSchedule(bad));
});

test('ambiguous dates, invented slots, control fields and long content are rejected without stripping or truncation', () => {
  const schedule = historyInvitationSchedule('2026-10-10T08:18:15.303Z');
  for (const body of [
    '周末一起爬山吧',
    '明天来修车',
    '10月12日一起散步',
    '2025年一起准备',
    '下午一起修车',
    '19:00来一下',
    '晚上整理配件',
    '{{date}}一起吃饭',
    '[slot]一起吃饭',
    '三点一起整理',
    '   ',
    '好',
    '嗯！',
    '你好。',
    '随时都行',
    '甲'.repeat(61),
    '明\u200b天一起修车',
    '１０月１２日一起修车',
    '１９：００一起修车',
    'tomorrow一起修车',
    'weekend来修车',
    'Next week来修车',
    '月底一起盘点',
    '过完年一起修车',
  ])
    assert.throws(() => schedule.render({ slotId: 'next_morning', body }));
  assert.throws(() => schedule.render({ slotId: 'weekend', body: '来帮忙修一下自行车，愿意吗？' }));
  assert.throws(() =>
    schedule.render({ slotId: 'soon', body: '一起整理配件', status: 'confirmed' } as any),
  );
  const body = '甲'.repeat(60),
    result = schedule.render({ slotId: 'next_morning', body });
  assert(result.text.endsWith(body));
  assert(result.text.length <= 80);
  assert.equal(result.connection.quote, result.text);
});

test('literal activity periods reject obvious mismatches without claiming unrestricted semantics', () => {
  const schedule = historyInvitationSchedule('2026-10-10T15:30:12.345Z');
  assert.throws(() => schedule.render({ slotId: 'next_evening', body: '来吃早餐，你愿意吗？' }));
  assert.throws(() => schedule.render({ slotId: 'next_morning', body: '一起午休吧，愿意吗？' }));
  assert.throws(() => schedule.render({ slotId: 'next_morning', body: '一起吃晚饭，愿意吗？' }));
  assert(
    schedule
      .render({ slotId: 'next_morning', body: '来吃早餐，你愿意吗？' })
      .text.endsWith('来吃早餐，你愿意吗？'),
  );
  assert(
    schedule
      .render({ slotId: 'next_evening', body: '一起吃晚饭，愿意吗？' })
      .text.endsWith('一起吃晚饭，愿意吗？'),
  );
});
