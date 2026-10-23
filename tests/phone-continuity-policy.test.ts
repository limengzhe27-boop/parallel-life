import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHONE_RUNTIME_POLICY,
  idleCheckDue,
  phoneCheckHistory,
  observePhoneIncoming,
  phoneTimeMode,
  phoneConversationFocus,
} from '../src/features/phone/time-experience-policy.ts';

test('checks reserve processing time before the delivery target, independently of clock speed', () => {
  const policy = PHONE_RUNTIME_POLICY;
  assert.ok(policy.deliveryTargetMs >= 45_000 && policy.deliveryTargetMs <= 60_000);
  assert.ok(policy.preparationReserveMs >= 20_000);
  const startsAt = policy.deliveryTargetMs - policy.preparationReserveMs;
  assert.equal(idleCheckDue(startsAt - 1, 0, 0), false);
  assert.equal(idleCheckDue(startsAt, 0, 0), true);
  assert.ok(startsAt + policy.checkEveryMs + policy.preparationReserveMs <= 60_000);
});

test('refresh, remount and short leave preserve the original silence window', () => {
  let history = phoneCheckHistory(1_000);
  history = observePhoneIncoming(history, ['old-message'], 1_000);
  for (const at of [10_000, 20_000, 30_000, 35_000])
    history = phoneCheckHistory(at, JSON.parse(JSON.stringify(history)));
  assert.equal(history.lastActivityAt, 1_000);
  assert.equal(idleCheckDue(36_000, history.lastActivityAt, history.lastCheckAt), true);
});

test('long absence is already due when resumed; no extra fixed window starts', () => {
  const history = phoneCheckHistory(600_000, {
    lastActivityAt: 1_000,
    lastCheckAt: 2_000,
    incomingIds: [],
  });
  assert.equal(idleCheckDue(600_000, history.lastActivityAt, history.lastCheckAt), true);
});

test('incoming messages preserve observation time without blocking an overdue world check', () => {
  let history = observePhoneIncoming(phoneCheckHistory(0), ['old'], 0);
  history = observePhoneIncoming(history, ['old', 'new'], 40_000);
  assert.equal(history.lastActivityAt, 40_000);
  assert.equal(idleCheckDue(60_000, history.lastActivityAt, history.lastCheckAt), true);
  assert.equal(idleCheckDue(75_000, history.lastActivityAt, history.lastCheckAt), true);
});

test('initial history, duplicate reads, reordered IDs and an unchanged attachment are not new messages', () => {
  let history = observePhoneIncoming(phoneCheckHistory(0), ['history', 'existing'], 5_000);
  assert.equal(history.lastActivityAt, 0);
  history = observePhoneIncoming(history, ['existing', 'history', 'existing'], 20_000);
  history = observePhoneIncoming(history, ['history', 'existing'], 34_000);
  assert.equal(history.lastActivityAt, 0);
  assert.equal(idleCheckDue(35_000, history.lastActivityAt, history.lastCheckAt), true);
});

test('quiet checks throttle execution attempts without pretending a message was delivered', () => {
  const history = phoneCheckHistory(0);
  history.lastCheckAt = 35_000;
  assert.equal(idleCheckDue(40_000, history.lastActivityAt, history.lastCheckAt), false);
  assert.equal(idleCheckDue(50_000, history.lastActivityAt, history.lastCheckAt), true);
  assert.equal(history.lastActivityAt, 0);
});

test('processing reserve, probe frequency and retry interval are separately configurable', () => {
  const policy = {
    checkEveryMs: 2_000,
    deliveryTargetMs: 50_000,
    preparationReserveMs: 25_000,
    recheckAfterMs: 10_000,
  };
  assert.equal(idleCheckDue(25_000, 0, 0, policy), true);
  assert.equal(idleCheckDue(30_000, 0, 25_000, policy), false);
  assert.equal(idleCheckDue(35_000, 0, 25_000, policy), true);
});

test('corrupt or future browser metadata cannot indefinitely suppress checks', () => {
  const now = 1_000;
  for (const saved of [
    null,
    'bad',
    { lastActivityAt: Infinity, lastCheckAt: NaN },
    { lastActivityAt: now + 1, lastCheckAt: now + 1, incomingIds: [false] },
  ]) {
    const history = phoneCheckHistory(now, saved);
    assert.deepEqual(history, { lastActivityAt: now, lastCheckAt: 0, incomingIds: null });
  }
});

test('a bounded message cursor does not change conversation focus or speed', () => {
  const ids = Array.from({ length: 300 }, (_, i) => `msg-${i}`);
  const history = observePhoneIncoming(phoneCheckHistory(0), ids, 10_000);
  assert.equal(history.incomingIds!.length, 256);
  const reread = observePhoneIncoming(history, ids, 20_000);
  assert.equal(reread.lastActivityAt, 0);
  const actor = '12345678-1234-4234-8234-123456789012';
  assert.equal(phoneTimeMode(false, { app: 'messages', target: actor }), 'conversation');
  assert.deepEqual(phoneConversationFocus({ app: 'messages', target: actor }), {
    channel: 'private',
    threadId: actor,
  });
  assert.equal(phoneTimeMode(false, { app: 'calendar' }), 'browsing');
});

test('continuous conversation cannot starve independent actors while checks remain bounded', () => {
  let history = observePhoneIncoming(phoneCheckHistory(1_000), ['initial'], 1_000);
  history.lastCheckAt = 1_000;
  for (const at of [6_000, 11_000, 16_000, 21_000, 26_000, 31_000]) {
    history = observePhoneIncoming(history, [...history.incomingIds!, `reply-${at}`], at);
    assert.equal(idleCheckDue(at, history.lastActivityAt, history.lastCheckAt), false);
  }
  history = observePhoneIncoming(history, [...history.incomingIds!, 'reply-36000'], 36_000);
  assert.equal(idleCheckDue(36_000, history.lastActivityAt, history.lastCheckAt), true);
  history.lastCheckAt = 36_000;
  // Another tab's original check timestamp survives navigation and new incoming messages.
  history = phoneCheckHistory(41_000, JSON.parse(JSON.stringify(history)));
  assert.equal(idleCheckDue(41_000, history.lastActivityAt, history.lastCheckAt), false);
  history = observePhoneIncoming(history, [...history.incomingIds!, 'reply-71000'], 71_000);
  assert.equal(idleCheckDue(71_000, history.lastActivityAt, history.lastCheckAt), true);
});
