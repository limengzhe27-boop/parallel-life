import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chatMessageLayout,
  formatChatTimestamp,
  dialogueText,
  formatChatTime,
  monthDays,
  shiftMonth,
  rescheduleAt,
  dayKey,
  errorText,
  searchable,
} from '../src/features/phone/apps/helpers.ts';
test('world calendar uses fixed Beijing dates and handles leap months', () => {
  assert.equal(dayKey('2024-02-29T23:30:00-08:00'), '2024-03-01');
  const feb = monthDays('2024-02');
  assert.equal(feb.filter(Boolean).length, 29);
  assert.equal(feb[3], '2024-02-01');
  assert.equal(monthDays('2023-02').filter(Boolean).length, 28);
  assert.deepEqual(monthDays('2024-13'), []);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});
test('rescheduling converts Beijing wall time to an instant and refuses normalized impossible dates', () => {
  assert.equal(
    rescheduleAt('2026-10-02T09:15', '2026-09-26T14:00:00+08:00'),
    '2026-10-02T01:15:00.000Z',
  );
  assert.equal(rescheduleAt('2026-02-30T09:15', '2026-09-26T14:00:00Z'), null);
  assert.equal(rescheduleAt('2026-10-02T25:15', '2026-09-26T14:00:00Z'), null);
  assert.equal(rescheduleAt('', '2026-09-26T14:00:00Z'), null);
});
test('phone errors show actionable safe text without leaking upstream messages', () => {
  assert.match(errorText({ code: 'UNKNOWN', message: 'private upstream payload' }), /尚未确认/);
  assert.match(errorText({ code: 'VERSION_CONFLICT' }), /草稿/);
  assert.doesNotMatch(errorText(new Error('secret')), /secret/);
  assert.equal(searchable('  林  ', '林小满'), true);
  assert.equal(searchable('MAY', 'May'), true);
});

test('chat relative dates follow calendar days instead of a rolling 48-hour window', () => {
  assert.equal(formatChatTime('2026-09-28T09:10:00Z', '2026-09-28T09:10:00Z'), '17:10');
  assert.equal(formatChatTime('2026-09-26T23:50:00Z', '2026-09-28T00:10:00Z'), '昨天 07:50');
  assert.equal(formatChatTime('2026-09-27T00:00:00Z', '2026-09-28T23:59:00Z'), '9月27日');
  assert.equal(formatChatTime('2026-09-28T09:00:00Z', '2026-09-28T09:10:00Z'), '17:00');
  assert.equal(formatChatTime('2026-09-29T09:00:00Z', '2026-09-28T09:10:00Z'), '9月29日');
});

test('legacy structured NPC output is labelled invalid while user content remains intact', () => {
  const raw = '{"schemaVersion":1,"effects":[]}';
  assert.equal(dialogueText(raw, 'user'), raw);
  assert.match(dialogueText(raw, 'assistant'), /格式异常/);
  assert.equal(dialogueText('我们下午见。', 'assistant'), '我们下午见。');
});

test('an unchanged invitation edit preserves the original instant including seconds', () => {
  assert.equal(rescheduleAt('2026-10-03T00:01', '2026-10-02T16:01:42Z'), '2026-10-02T16:01:42Z');
  assert.equal(formatChatTime('2026-10-02T15:59:00Z', '2026-10-02T16:01:00Z'), '昨天 23:59');
  assert.equal(formatChatTime('2026-10-03T00:01:00+08:00', '2026-10-02T16:01:00Z'), '00:01');
});

test('chat timeline uses adjacent virtual times, independent of speaker and content', () => {
  const at = (minute: number, role = 'assistant') => ({
    at: `2026-10-09T17:${minute}:00+08:00`,
    role,
  });
  assert.deepEqual(chatMessageLayout(at(42)), { showTime: true, gap: 0 });
  assert.deepEqual(chatMessageLayout(at(44), at(42)), { showTime: false, gap: 6 });
  assert.deepEqual(chatMessageLayout(at(47), at(44)), { showTime: false, gap: 6 });
  assert.deepEqual(chatMessageLayout(at(52), at(47)), { showTime: true, gap: 0 });
  assert.deepEqual(chatMessageLayout(at(44, 'user'), at(42)), { showTime: false, gap: 12 });
  assert.deepEqual(
    chatMessageLayout(
      { at: '2026-10-10T00:00:00+08:00', role: 'assistant' },
      { at: '2026-10-09T23:59:59+08:00', role: 'assistant' },
    ),
    { showTime: true, gap: 0 },
  );
  assert.equal(
    chatMessageLayout({ at: '2026-10-09T17:46:59.999+08:00', role: 'assistant' }, at(42)).showTime,
    false,
  );
  // Loading a photo or retrying a saved message does not change its original at or layout.
  const saved = { ...at(44), photo: { status: 'pending' } };
  const ready = { ...saved, photo: { status: 'ready' } };
  assert.deepEqual(chatMessageLayout(saved, at(42)), chatMessageLayout(ready, at(42)));
  assert.deepEqual(
    chatMessageLayout(JSON.parse(JSON.stringify(saved)), at(42)),
    chatMessageLayout(saved, at(42)),
  );
  assert.equal(
    formatChatTimestamp('2025-10-09T17:42:00+08:00', '2026-10-26T12:00:00+08:00'),
    '2025年10月9日 17:42',
  );
});

test('timeline date labels keep time and use the world date including year boundaries', () => {
  const reference = '2026-10-26T12:00:00+08:00';
  assert.equal(formatChatTimestamp('2026-10-26T17:42:00+08:00', reference), '17:42');
  assert.equal(formatChatTimestamp('2026-10-25T17:42:00+08:00', reference), '昨天 17:42');
  assert.equal(formatChatTimestamp('2026-10-09T17:42:00+08:00', reference), '10月9日 17:42');
  assert.equal(
    formatChatTimestamp('2025-12-31T17:42:00+08:00', '2026-01-01T12:00:00+08:00'),
    '昨天 17:42',
  );
});
