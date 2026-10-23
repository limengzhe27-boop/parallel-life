import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import {
  reduceActorAgentState,
  type AgentValidationContext,
} from '../src/modules/world/domain/agent-kernel.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import { stickerMessageMeaning } from '../src/modules/world/domain/sticker-expression.ts';
function fixture(): AgentValidationContext {
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'def', 0);
  return {
    state,
    viewState: state,
    worldVersion: 0,
    storyAt: '2026-10-20T00:00:00.000Z',
    sources: [
      {
        id: 'input',
        kind: 'accepted_input',
        recordId: 'input',
        worldVersion: 0,
        at: '2026-10-20T00:00:00.000Z',
      },
    ],
    input: { sourceId: 'input', origin: 'player', text: '给我拍张自拍' },
    channel: { kind: 'private', threadId: 'a', allowedCapabilities: ['media.generate_image'] },
  };
}

const wire = (statements: unknown[]) => ({
  protocol: 'npc-wire-v15',
  statements,
  changes: null,
  executions: [],
});
const s = (text: string, stickerId?: string) => ({
  text,
  dependsOnActionIds: [],
  ...(stickerId ? { stickerId } : {}),
});
test('invalid sticker decoration preserves text and statement positions', () => {
  const c = fixture(),
    p = parseAgentProposal(c, wire([s('先说明事情。'), s('', 'bad_id'), s('好的', 'bad_id')]));
  assert.equal(p.statements.length, 3);
  assert.equal(p.statements[2]?.stickerId, undefined);
  const out = reduceActorAgentState(c, p, [], 1);
  assert.deepEqual(
    out.statements.map((x) => x.text),
    ['先说明事情。', '好的'],
  );
  assert.throws(() => parseAgentProposal(c, wire([s('', 'bad_id')])));
});
test('valid pure sticker, mixed caption and legacy marker survive without replacing dialogue', () => {
  const c = fixture(),
    p = parseAgentProposal(
      c,
      wire([s('事情还没有完成。'), s('', 'jiayou'), s('一起努力', 'zan'), s('[[sticker:hao]]')]),
    );
  assert.equal(p.statements.length, 4);
  assert.equal(p.statements[3]?.stickerId, 'hao');
  const out = reduceActorAgentState(c, p, [], 1);
  assert.equal(out.statements.length, 4);
});
test('player sticker is meaningful without claiming physical action', () => {
  assert.match(stickerMessageMeaning('[[sticker:chong]]'), /不等于已行动/);
  assert.match(stickerMessageMeaning('说句话', 'zan'), /说句话.*欣赏/);
  assert.equal(stickerMessageMeaning('[[sticker:missing]]'), '[[sticker:missing]]');
});
