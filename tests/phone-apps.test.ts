import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monthDays,
  shiftMonth,
  rescheduleAt,
  dayKey,
  errorText,
  searchable,
} from '../src/features/phone/apps/helpers.ts';
test('world calendar keeps date keys in world offset and handles leap months', () => {
  assert.equal(dayKey('2024-02-29T23:30:00-08:00'), '2024-02-29');
  const feb = monthDays('2024-02');
  assert.equal(feb.filter(Boolean).length, 29);
  assert.equal(feb[3], '2024-02-01');
  assert.equal(monthDays('2023-02').filter(Boolean).length, 28);
  assert.deepEqual(monthDays('2024-13'), []);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});
test('rescheduling preserves the world offset and refuses normalized impossible dates', () => {
  assert.equal(
    rescheduleAt('2026-10-02T09:15', '2026-09-26T14:00:00+08:00'),
    '2026-10-02T09:15:00+08:00',
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
