import test from 'node:test';
import assert from 'node:assert/strict';
import {
  episodeAttentionAllows,
  episodeExecutionAllows,
} from '../src/modules/world/infrastructure/agent-episode-attention.ts';
import type { WorldAttention } from '../src/modules/world/infrastructure/world-attention-repository.ts';

const privateFocus: WorldAttention = {
  focus: [{ channel: 'private', threadId: 'actor-a', actorIds: ['actor-a'] }],
  conversationWithoutTarget: false,
};

test('reading actor A permits actor B work but not an immediate interruption', () => {
  assert.equal(episodeExecutionAllows(privateFocus), true);
  assert.equal(episodeAttentionAllows(privateFocus, 'actor-a'), true);
  assert.equal(episodeAttentionAllows(privateFocus, 'actor-b'), false);
});

for (const channel of ['group', 'scene'] as const)
  test(`authenticated ${channel} focus preserves work without treating it as a private recipient`, () => {
    const attention: WorldAttention = {
      focus: [{ channel, threadId: 'thread', actorIds: ['actor-a', 'actor-b'] }],
      conversationWithoutTarget: false,
    };
    assert.equal(episodeExecutionAllows(attention), true);
    assert.equal(episodeAttentionAllows(attention, 'actor-a'), false);
    assert.equal(episodeAttentionAllows(attention, 'actor-b'), false);
  });

test('unresolved or revoked focus remains deferred even with another valid focus', () => {
  for (const focus of [[], privateFocus.focus]) {
    const attention = { focus, conversationWithoutTarget: true };
    assert.equal(episodeExecutionAllows(attention), false);
    assert.equal(episodeAttentionAllows(attention, 'actor-a'), false);
  }
});

test('browsing allows execution and ordinary presentation without changing attention', () => {
  const attention: WorldAttention = { focus: [], conversationWithoutTarget: false };
  const before = structuredClone(attention);
  assert.equal(episodeExecutionAllows(attention), true);
  assert.equal(episodeAttentionAllows(attention, 'actor-b'), true);
  assert.deepEqual(attention, before);
});
