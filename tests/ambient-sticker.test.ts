import assert from 'node:assert/strict';
import test from 'node:test';
import { withAmbientSticker } from '../src/modules/world/domain/ambient-sticker.ts';
import type { AgentProposal } from '../src/modules/world/domain/agent-runtime.ts';
const base = {
  statements: [{ text: '哈哈，今天这事真的有点好笑', dependsOnActionIds: [] }],
} as unknown as AgentProposal;
test('ambient sticker is semantic and never replaces the text', () => {
  const result = withAmbientSticker(base, {
    channelKind: 'private',
    origin: 'player',
    text: '哈哈，今天这事真的有点好笑',
  });
  assert.equal(result.statements.length, 2);
  assert.match(result.statements[1]!.text, /^\[\[sticker:xswl\]\]$/);
});
test('ambient sticker does not fire in group or without a cue', () => {
  assert.equal(
    withAmbientSticker(base, { channelKind: 'group', origin: 'player', text: '哈哈' }).statements
      .length,
    1,
  );
  assert.equal(
    withAmbientSticker(base, { channelKind: 'private', origin: 'player', text: '明天见' })
      .statements.length,
    1,
  );
});
test('explicit sticker is not duplicated', () => {
  const p = {
    statements: [{ text: '[[sticker:hao]]', dependsOnActionIds: [] }],
  } as unknown as AgentProposal;
  assert.equal(
    withAmbientSticker(p, { channelKind: 'private', origin: 'player', text: '好' }).statements
      .length,
    1,
  );
});
