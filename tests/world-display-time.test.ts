import test from 'node:test';
import assert from 'node:assert/strict';
import {
  worldDayKey,
  worldMonthKey,
  worldTimeLabel,
  worldDateTimeInput,
  worldDateTimeToInstant,
  worldWeekday,
  worldDateTimeLabel,
} from '../src/modules/world/domain/display-time.ts';

test('fixed UTC+08 crosses midnight, month and year without changing the instant', () => {
  assert.equal(worldDayKey('2026-10-02T15:59:00Z'), '2026-10-02');
  assert.equal(worldDateTimeLabel('2026-10-02T16:10:00Z'), '2026-10-03 00:10');
  assert.equal(worldWeekday('2026-10-02T16:10:00Z'), '星期六');
  assert.equal(worldMonthKey('2026-10-31T16:00:00Z'), '2026-11');
  assert.equal(worldDateTimeInput('2026-12-31T16:00:00Z'), '2027-01-01T00:00');
  assert.equal(worldTimeLabel('2026-12-31T16:00:00Z'), '00:00');
});

test('equivalent explicit offsets produce identical dates, labels and weekdays', () => {
  const values = ['2026-10-02T16:10:00Z', '2026-10-03T00:10:00+08:00', '2026-10-02T08:10:00-08:00'];
  for (const format of [
    worldDayKey,
    worldMonthKey,
    worldTimeLabel,
    worldDateTimeInput,
    worldWeekday,
  ])
    assert.deepEqual(
      values.map(format),
      values.map(() => format(values[0]!)),
    );
  assert.equal(worldTimeLabel('2026-10-03T05:55:00+05:45'), '08:10');
});

test('valid leap days and years below 100 do not use Date.UTC two-digit-year coercion', () => {
  assert.equal(worldDayKey('2024-02-28T16:00:00Z'), '2024-02-29');
  assert.equal(worldDateTimeToInstant('2000-02-29T09:00'), '2000-02-29T01:00:00.000Z');
  assert.equal(worldDateTimeToInstant('0099-01-01T08:00'), '0099-01-01T00:00:00.000Z');
  assert.equal(worldDateTimeToInstant('1900-02-29T09:00'), null);
});

test('invalid instants return empty labels, never normalize invalid calendar dates', () => {
  for (const value of [
    '',
    'invalid',
    '2026-10-02',
    '2026-10-02T09:00',
    '2026-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-00-01T00:00:00Z',
    '2026-01-00T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:60:00Z',
    '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+24:00',
    '2026-01-01T00:00:00+08:60',
    ' 2026-01-01T00:00:00Z',
    '9999-12-31T23:59:00Z',
  ])
    for (const format of [
      worldDayKey,
      worldMonthKey,
      worldTimeLabel,
      worldDateTimeInput,
      worldWeekday,
      worldDateTimeLabel,
    ])
      assert.equal(format(value), '', `${format.name}: ${value}`);
});

test('minute wall-clock input round-trips through UTC, with explicit seconds truncation', () => {
  for (const value of ['2026-10-03T09:15', '2027-01-01T00:00', '2024-02-29T00:05']) {
    const iso = worldDateTimeToInstant(value);
    assert.ok(iso);
    assert.equal(worldDateTimeInput(iso), value);
  }
  assert.equal(worldDateTimeToInstant('2026-10-03T09:15'), '2026-10-03T01:15:00.000Z');
  assert.equal(worldDateTimeInput('2026-10-03T01:15:59.987Z'), '2026-10-03T09:15');
  for (const value of [
    '',
    '2026-02-30T09:15',
    '2026-10-03T25:15',
    '2026-10-03T09:60',
    '2026-10-03T09:15Z',
    '2026-10-03T09:15:00',
    '0000-01-01T00:00',
  ])
    assert.equal(worldDateTimeToInstant(value), null);
});

test('output is independent of device timezone and uses fixed +08 even in historical summer', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      assert.equal(worldDateTimeInput('2026-10-02T16:10:00Z'), '2026-10-03T00:10');
      assert.equal(worldDateTimeToInstant('2026-10-03T09:15'), '2026-10-03T01:15:00.000Z');
      assert.equal(worldTimeLabel('1990-07-01T00:00:00Z'), '08:00');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
