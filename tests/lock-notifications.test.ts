import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockScreenNotifications } from '../src/features/phone/notification-projection.ts';
import type { PhoneNotification } from '../src/features/phone/phone-shell.tsx';

const at = (value: string) => value;
const message = (id: string, target: string, time: string): PhoneNotification => ({
  id,
  title: target,
  summary: `消息 ${id}`,
  app: 'messages',
  target,
  at: time,
  timeLabel: time,
});
const invitation = (
  id: string,
  title: string,
  time: string,
  status: 'proposed' | 'confirmed' | 'cancelled' | 'attended' | 'missed',
) => ({ id, title, at: time, status });

test('lock screen is capped at three high-stakes items, with overdue and due dates before chat', () => {
  const items = lockScreenNotifications(
    [
      message('m1', 'actor-a', at('2026-10-20T17:55:00Z')),
      message('m2', 'actor-b', at('2026-10-20T17:58:00Z')),
      message('m3', 'actor-c', at('2026-10-20T17:59:00Z')),
      message('m4', 'actor-d', at('2026-10-20T17:57:00Z')),
    ],
    [
      invitation('late', '晚饭', at('2026-10-20T15:00:00Z'), 'confirmed'),
      invitation('due', '看展', at('2026-10-20T17:30:00Z'), 'confirmed'),
      invitation('soon', '咖啡', at('2026-10-20T19:00:00Z'), 'confirmed'),
    ],
    '2026-10-20T18:00:00Z',
    (value) => `T:${value}`,
  );
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((item) => item.id),
    ['lock-appointment:late', 'lock-appointment:due', 'lock-appointment:soon'],
  );
  assert.equal(items[0]!.app, 'calendar');
  assert.match(items[0]!.summary, /还没有结果记录/);
  assert.equal(items[0]!.timeLabel, 'T:2026-10-20T15:00:00Z');
});

test('chat cannot fill the lock screen with one actor burst, and old dates are not resurrected', () => {
  const items = lockScreenNotifications(
    [
      message('m1', 'actor-a', at('2026-10-20T17:55:00Z')),
      message('m2', 'actor-a', at('2026-10-20T17:56:00Z')),
      message('m3', 'actor-b', at('2026-10-20T17:57:00Z')),
      message('m4', 'actor-c', at('2026-10-20T17:58:00Z')),
    ],
    [invitation('old', '上周的约', at('2026-10-18T10:00:00Z'), 'confirmed')],
    '2026-10-20T18:00:00Z',
    (value) => value,
  );
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((item) => item.target),
    ['actor-c', 'actor-b', 'actor-a'],
  );
});

test('content-free waiting noise does not take a lock-screen slot', () => {
  const items = lockScreenNotifications(
    [
      {
        ...message('filler', 'actor-a', at('2026-10-20T17:55:00Z')),
        summary: '我就继续观察着，等有啥具体情况了再说。',
      },
      {
        ...message('useful', 'actor-b', at('2026-10-20T17:54:00Z')),
        summary: '七点我到店门口，车钥匙带了吗',
      },
    ],
    [],
    '2026-10-20T18:00:00Z',
    (value) => value,
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ['useful'],
  );
});

test('a quiet lock screen stays quiet and the input array is not mutated', () => {
  const input = [message('m1', 'actor-a', at('2026-10-20T17:55:00Z'))];
  const before = JSON.stringify(input);
  assert.deepEqual(
    lockScreenNotifications(input, [], '2026-10-20T18:00:00Z', (value) => value),
    input,
  );
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(
    lockScreenNotifications([], [], '2026-10-20T18:00:00Z', (value) => value),
    [],
  );
});

test('a proposed future invitation is visible, while a cancelled or far date is not', () => {
  const items = lockScreenNotifications(
    [],
    [
      invitation('ask', '周末去走走', at('2026-10-22T10:00:00Z'), 'proposed'),
      invitation('cancelled', '取消的约', at('2026-10-20T19:00:00Z'), 'cancelled'),
      invitation('far', '下个月的约', at('2026-11-20T10:00:00Z'), 'confirmed'),
    ],
    '2026-10-20T18:00:00Z',
    (value) => value,
  );
  assert.deepEqual(
    items.map((item) => item.target),
    ['ask'],
  );
});
