import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authoredAppointments } from '../src/modules/settings/domain/authored-appointments.ts';

const base = () => ({
  actorIds: new Map([['a', 'actor-a']]),
  messageIds: new Map([['m1', 'msg-1']]),
  sourceEventId: 'genesis',
  newId: () => 'appointment-1',
});

test('必发事件且有开场未读消息时，物化为一条 proposed 约定', () => {
  const result = authoredAppointments({
    ...base(),
    candidates: [{ title: '今晚一起出差', actorKeys: ['a'], direction: { mode: 'required' } }],
    messages: [{ key: 'm1', actorKey: 'a', origin: 'current', at: '2026-10-14T00:00:00.000Z' }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.status, 'proposed');
  assert.equal(result[0]!.sourceMessageId, 'msg-1');
});

test('没有来源消息就不造约定', () => {
  const result = authoredAppointments({
    ...base(),
    candidates: [{ title: '今晚一起出差', actorKeys: ['a'], direction: { mode: 'required' } }],
    messages: [{ key: 'm1', actorKey: 'a', origin: 'history', at: '2026-10-14T00:00:00.000Z' }],
  });
  assert.deepEqual(result, []);
});

test('可选事件不会变成必发约定', () => {
  const result = authoredAppointments({
    ...base(),
    candidates: [{ title: '随便聊聊', actorKeys: ['a'], direction: { mode: 'optional' } }],
    messages: [{ key: 'm1', actorKey: 'a', origin: 'current', at: '2026-10-14T00:00:00.000Z' }],
  });
  assert.deepEqual(result, []);
});
