import test from 'node:test';
import assert from 'node:assert/strict';
import {
  momentImages,
  momentVisible,
  type CommittedStatement,
} from '../src/modules/settings/domain/moment-visibility.ts';

const now = '2026-10-14T08:00:00Z';
const locked = {
  at: '2022-05-11T04:00:00Z',
  visibility: {
    kind: 'after_statement' as const,
    actorKey: 'shu_yating',
    statement: '你照看的这个孩子是我的儿子。',
  },
};
const confirmation: CommittedStatement = {
  actorKey: 'shu_yating',
  role: 'assistant',
  text: locked.visibility.statement,
  at: now,
  sourceEventId: 'committed-world-event',
};
test('all pictures remain ordered, legacy single pictures work, deletion does not restore old cover', () => {
  assert.deepEqual(momentImages({ image: 'a', images: ['a', 'b', 'c', 'b'] }), ['a', 'b', 'c']);
  assert.deepEqual(momentImages({ image: 'legacy' }), ['legacy']);
  assert.deepEqual(momentImages({ image: 'stale', images: [] }), []);
});
test('three-day window is inclusive at 72 hours, excludes future and expires with world time', () => {
  assert.equal(momentVisible({ at: '2026-10-11T08:00:00Z' }, 'three_days', now, []), true);
  assert.equal(momentVisible({ at: '2026-10-11T07:59:59.999Z' }, 'three_days', now, []), false);
  assert.equal(momentVisible({ at: '2026-10-14T08:00:00.001Z' }, 'all', now, []), false);
  assert.equal(momentVisible({ at: now }, 'three_days', '2026-10-17T08:00:00.001Z', []), false);
  assert.equal(momentVisible({ at: '2022-05-11T04:00:00Z' }, 'all', now, []), true);
});
test('identity post requires the designated NPC complete statement in a committed message', () => {
  assert.equal(momentVisible(locked, 'all', now, []), false);
  assert.equal(momentVisible(locked, 'all', now, [confirmation]), true);
  for (const changed of [
    { role: 'user' as const },
    { actorKey: 'other_actor' },
    { sourceEventId: '' },
    { at: '2026-10-15T08:00:00Z' },
    { text: `她说“${confirmation.text}”` },
    { text: `如果我说${confirmation.text}` },
  ])
    assert.equal(momentVisible(locked, 'all', now, [{ ...confirmation, ...changed }]), false);
});
test('time and identity restrictions combine; invalid time fails closed', () => {
  assert.equal(momentVisible(locked, 'three_days', now, [confirmation]), false);
  assert.equal(momentVisible(locked, 'all', 'invalid', [confirmation]), false);
  assert.equal(momentVisible({ at: 'invalid' }, 'all', now, []), false);
});
