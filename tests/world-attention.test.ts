import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextClockConversationFocus,
  validateClockActivity,
  activityMode,
} from '../src/modules/world/domain/clock-activity.ts';
const clientId = '12345678-1234-4123-8123-123456789012',
  input = { clientId, sequence: 1, mode: 'conversation' as const };
const target = { channel: 'private' as const, threadId: 'actual-actor' };
const previous = {
  clientId,
  sequence: 0,
  mode: 'conversation' as const,
  focus: target,
  expiresAt: '2026-10-15T08:00:45Z',
};
test('conversation heartbeat retains explicit business target while reading/thinking without changing the previous object', () => {
  const result = nextClockConversationFocus(input, previous);
  assert.deepEqual(result, target);
  assert.notEqual(result, target);
  assert.deepEqual(previous.focus, target);
});
test('explicit target end, browsing and away clear focus even if a target was supplied', () => {
  for (const value of [
    { ...input, focus: null },
    { ...input, mode: 'away' as const, focus: target },
    { ...input, mode: 'browsing' as const, focus: target },
  ])
    assert.equal(nextClockConversationFocus(value, previous), null);
});
test('legacy unscoped conversation remains 1x without inventing a known target', () => {
  assert.equal(nextClockConversationFocus(input), null);
  assert.equal(activityMode([{ ...previous, focus: null }], '2026-10-15T08:00:01Z').speed, 1);
});
test('explicit switch is exact; leaving conversation then returning without focus does not resurrect it', () => {
  const next = { channel: 'group' as const, threadId: 'group-id' };
  assert.deepEqual(nextClockConversationFocus({ ...input, focus: next }, previous), next);
  assert.equal(nextClockConversationFocus(input, { ...previous, mode: 'browsing' }), null);
});
test('business focus accepts only channel and thread ID, never injected actor IDs or a guessed channel', () => {
  validateClockActivity({ ...input, focus: target });
  validateClockActivity({ ...input, focus: null });
  for (const focus of [
    { ...target, actorIds: ['forged'] },
    { channel: 'direct', threadId: 'x' },
    { channel: 'scene', threadId: '' },
    [],
    { channel: 'group', threadId: 42 },
  ])
    assert.throws(() => validateClockActivity({ ...input, focus: focus as any }), {
      code: 'INVALID_COMMAND',
    });
});
