import assert from 'node:assert/strict';
import test from 'node:test';
import { withAmbientSticker } from '../src/modules/world/domain/ambient-sticker.ts';
import type { AgentProposal } from '../src/modules/world/domain/agent-runtime.ts';
const base = {
  statements: [{ text: '哈哈，今天这事真的有点好笑', dependsOnActionIds: [] }],
} as unknown as AgentProposal;
test('ambient sticker is semantic, structured, and never replaces real text', () => {
  const result = withAmbientSticker(base, {
    channelKind: 'private',
    origin: 'player',
    text: '哈哈，今天这事真的有点好笑',
  });
  assert.equal(result.statements.length, 2);
  assert.equal(result.statements[1]!.text, '');
  assert.equal(result.statements[1]!.stickerId, 'xswl');
  assert.deepEqual(result.statements[0], base.statements[0]);
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
    statements: [{ text: '', stickerId: 'hao', dependsOnActionIds: [] }],
  } as unknown as AgentProposal;
  assert.equal(
    withAmbientSticker(p, { channelKind: 'private', origin: 'player', text: '好' }).statements
      .length,
    1,
  );
});
test('a very short acknowledgement can become sticker-only', () => {
  const short = {
    statements: [{ text: '好', dependsOnActionIds: [] }],
  } as unknown as AgentProposal;
  const result = withAmbientSticker(short, {
    channelKind: 'private',
    origin: 'player',
    text: '好的',
  });
  assert.equal(result.statements.length, 1);
  assert.equal(result.statements[0]!.text, '');
  assert.equal(result.statements[0]!.stickerId, 'keyi');
});
