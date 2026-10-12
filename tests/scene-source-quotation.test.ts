import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { progressionFixture } from './fixtures/matter-progression.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import { resolveSceneStepProgress } from '../src/modules/world/domain/scene-step-progress.ts';

function fixture() {
  const f = progressionFixture('county-yellow-hair'),
    event = { id: randomUUID(), version: f.world.version + 1, at: f.world.time };
  const text = '我将R17钥匙和维修单交给老周。',
    quote = '我现在接过R17钥匙和维修单。';
  return {
    world: f.world,
    initial: f.initial,
    scene: f.scene,
    event,
    action: {
      id: randomUUID(),
      commandId: randomUUID(),
      ownerId: f.world.ownerId,
      worldId: f.world.id,
      sceneId: f.scene.id,
      kind: 'operate' as const,
      intent: 'attempt' as const,
      status: 'resolved' as const,
      text,
      sourceEventId: randomUUID(),
      sourceVersion: f.world.version,
      relatedMatterIds: [sceneMatterId(f.scene.id, f.trigger.id)],
      resolution: {
        sourceEventId: event.id,
        sourceVersion: event.version,
        outcome: 'partial' as const,
        observation: '你将R17钥匙和维修单交给老周。',
      },
    },
    stepProposals: [
      {
        matterId: f.trigger.id,
        stepId: 'handed_over',
        receiverId: f.actorId,
        inputQuote: text,
        observationQuote: '你将R17钥匙和维修单交给老周。',
      },
    ],
    npcActions: [
      { matterId: f.trigger.id, actorId: f.actorId, kind: 'receive_r17' as const, quote },
    ],
    dialogues: [{ actorId: f.actorId, text: quote }],
  };
}
for (const [open, close] of [
  ['“', '”'],
  ['「', '」'],
  ['『', '』'],
  ['"', '"'],
])
  test(`quoted receiving punctuation inside ${open}${close} remains quoted, not actual`, () => {
    const c = fixture();
    c.dialogues[0]!.text = `你说${open}${c.npcActions[0]!.quote}${close}`;
    const before = structuredClone(c);
    assert.throws(() => resolveSceneStepProgress(c), { code: 'INVALID_PROPOSAL' });
    assert.deepEqual(c, before);
  });
test('player input quoted handing with internal period cannot be extracted into an actual delivery', () => {
  const c = fixture();
  c.action.text = `我引用“${c.stepProposals[0]!.inputQuote}”`;
  c.npcActions = [];
  c.dialogues = [];
  assert.throws(() => resolveSceneStepProgress(c), { code: 'INVALID_PROPOSAL' });
});
test('player observation quoted handing with internal period cannot establish an actual delivery', () => {
  const c = fixture();
  c.action.resolution.observation = `你说“${c.stepProposals[0]!.observationQuote}”`;
  c.npcActions = [];
  c.dialogues = [];
  assert.throws(() => resolveSceneStepProgress(c), { code: 'INVALID_PROPOSAL' });
});
test('a separate later real receiver clause remains usable even when identical words appeared in an earlier quote', () => {
  const c = fixture();
  c.dialogues[0]!.text = `你说“${c.npcActions[0]!.quote}”\n${c.npcActions[0]!.quote}`;
  const p = resolveSceneStepProgress(c);
  assert.deepEqual(
    p.matters
      .find((m) => m.id === c.stepProposals[0]!.matterId)!
      .stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'received'],
  );
  assert.deepEqual(p.completedMatterIds, []);
});
test('a separate later real player input remains usable instead of being confused with an earlier identical quote', () => {
  const c = fixture();
  c.action.text = `我引用“${c.stepProposals[0]!.inputQuote}”\n${c.stepProposals[0]!.inputQuote}`;
  assert.deepEqual(
    resolveSceneStepProgress(c)
      .matters.find((m) => m.id === c.stepProposals[0]!.matterId)!
      .stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'received'],
  );
});
test('unterminated quoted receiving still gives no execution credit', () => {
  const c = fixture();
  c.dialogues[0]!.text = `你说“${c.npcActions[0]!.quote}`;
  assert.throws(() => resolveSceneStepProgress(c), { code: 'INVALID_PROPOSAL' });
});
test('future, denial and a different vehicle stay rejected with an independent quoted source earlier', () => {
  for (const real of [
    '我会接过R17钥匙和维修单。',
    '我没有接过R17钥匙和维修单。',
    '我现在接过R18钥匙和维修单。',
  ]) {
    const c = fixture();
    c.dialogues[0]!.text = `你说“我现在接过R17钥匙和维修单。”\n${real}`;
    c.npcActions[0]!.quote = real;
    assert.throws(() => resolveSceneStepProgress(c), { code: 'INVALID_PROPOSAL' });
  }
});
