import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupNotifications,
  latestNotification,
  projectMessageNotifications,
} from '../src/features/phone/notification-projection.ts';
import { arrivingIds } from '../src/features/phone/notification-state.ts';
import type { PhoneNotification } from '../src/features/phone/phone-shell.tsx';

const notification = (
  id: string,
  target: string | undefined,
  at: string,
  extra: Partial<PhoneNotification> = {},
): PhoneNotification => ({
  id,
  title: '阿宁',
  summary: `真实消息 ${id}`,
  app: 'messages',
  conversationKind: 'private',
  ...(target ? { target } : {}),
  at,
  timeLabel: at.slice(11, 16),
  ...extra,
});

test('all persisted unread messages survive projection across dates and opening limits', () => {
  const messages: Array<{
    id: string;
    actorId: string;
    role: 'user' | 'assistant';
    text: string;
    at: string;
  }> = Array.from({ length: 12 }, (_, index) => ({
    id: `m${index}`,
    actorId: index % 2 ? 'actor-b' : 'actor-a',
    role: 'assistant',
    text: `原文 ${index}`,
    at: new Date(Date.UTC(2026, 9, 1 + index, 9)).toISOString(),
  }));
  messages.push({
    id: 'my-message',
    actorId: 'actor-a',
    role: 'user',
    text: '用户自己发送',
    at: '2026-10-09T10:00:00.000Z',
  });
  const result = projectMessageNotifications(
    messages,
    [
      { id: 'actor-a', name: '阿宁' },
      { id: 'actor-b', name: '阿宁' },
    ],
    new Set(['m2']),
    (at) => at.slice(0, 10),
  );
  assert.equal(result.length, 11);
  assert.equal(result[0]?.id, 'm11');
  assert.equal(result.at(-1)?.id, 'm0');
  assert.ok(result.every((item) => item.summary.startsWith('原文 ')));
  const groups = groupNotifications(result, '2026-10-15T00:00:00.000Z');
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.target).sort(), ['actor-a', 'actor-b']);
  assert.equal(
    groups.reduce((sum, group) => sum + group.items.length, 0),
    11,
  );
});

test('same-name contacts, private/group threads and targetless items never merge', () => {
  const groups = groupNotifications([
    notification('a', 'actor-a', '2026-10-06T09:00:00.000Z'),
    notification('b', 'actor-b', '2026-10-06T10:00:00.000Z'),
    notification('c', 'actor-a', '2026-10-06T11:00:00.000Z', { conversationKind: 'group' }),
    notification('d', undefined, '2026-10-06T12:00:00.000Z'),
    notification('e', undefined, '2026-10-06T13:00:00.000Z'),
  ]);
  assert.equal(groups.length, 5);
  assert.equal(new Set(groups.map((group) => group.key)).size, 5);
  assert.equal(groups[0]?.latest.id, 'e');
  assert.equal(groups[4]?.latest.id, 'a');
});

test('one thread expands in chronological order and new IDs remain detectable', () => {
  const previous = [notification('old', 'actor-a', '2026-10-06T09:00:00.000Z')];
  const incoming = notification('new', 'actor-a', '2026-10-09T09:00:00.000Z');
  const groups = groupNotifications([...previous, incoming]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]?.items.map((item) => item.id),
    ['old', 'new'],
  );
  assert.equal(groups[0]?.latest.id, 'new');
  assert.deepEqual(arrivingIds(new Set(previous.map((item) => item.id)), ['new', 'old']), ['new']);
  assert.equal(latestNotification([previous[0]!, incoming])?.id, 'new');
  assert.equal(
    latestNotification([
      notification('no-time-old', 'actor-a', ''),
      notification('no-time-new', 'actor-a', ''),
    ])?.id,
    'no-time-new',
  );
});

test('verified future action can lead; expired action and urgency words do not', () => {
  const groups = groupNotifications(
    [
      notification('old-crisis', 'actor-a', '2026-10-01T09:00:00.000Z', {
        summary: '急！出事了！',
        actionableUntil: '2026-10-02T09:00:00.000Z',
      }),
      notification('current', 'actor-b', '2026-10-09T09:00:00.000Z'),
      notification('calendar', 'appointment', '2026-10-08T09:00:00.000Z', {
        app: 'calendar',
        conversationKind: undefined,
        actionableUntil: '2026-10-10T09:00:00.000Z',
      }),
    ],
    '2026-10-09T12:00:00.000Z',
  );
  assert.deepEqual(
    groups.map((group) => group.latest.id),
    ['calendar', 'current', 'old-crisis'],
  );
  assert.equal(groups[0]?.actionable, true);
  assert.equal(groups[2]?.actionable, false);
});

test('duplicate projection rows do not invent notification counts', () => {
  const item = notification('stored-id', 'actor-a', '2026-10-09T09:00:00.000Z');
  assert.equal(groupNotifications([item, item])[0]?.items.length, 1);
});
