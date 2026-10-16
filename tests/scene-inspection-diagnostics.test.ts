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
const cases: [string, (c: ReturnType<typeof fixture>) => void][] = [
  [
    'handover_or_request_missing',
    (c) => {
      c.stepProposals = [];
    },
  ],
  [
    'object_not_named',
    (c) => {
      c.npcActions[0]!.quote = '我检查了线路。';
      c.dialogues[0]!.text = c.npcActions[0]!.quote;
    },
  ],
  [
    'execution_not_explicit',
    (c) => {
      c.npcActions[0]!.quote = '我接过R17钥匙和维修单。';
      c.dialogues[0]!.text = c.npcActions[0]!.quote;
    },
  ],
];
for (const [code, mutate] of cases)
  test(`inspection diagnostic ${code} retains the original failure boundary`, () => {
    const c = fixture();
    c.npcActions[0]!.kind = 'inspect_r17' as never;
    c.npcActions[0]!.quote = '我检查了R17接头。';
    c.dialogues[0]!.text = c.npcActions[0]!.quote;
    mutate(c);
    const before = structuredClone(c);
    assert.throws(
      () => resolveSceneStepProgress(c),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(
          e.message,
          `SCENE_STEPS: Inspection lacks bounded object/request;inspection_condition:${code}`,
        );
        assert.ok(!e.message.includes('老周'));
        assert.ok(!e.message.includes(c.world.id));
        return true;
      },
    );
    assert.deepEqual(c, before);
  });
test('valid actual bounded inspection remains optional and does not replace receiving', () => {
  const c = fixture();
  c.npcActions[0]!.kind = 'inspect_r17' as never;
  c.npcActions[0]!.quote = '我检查了R17接头。';
  c.dialogues[0]!.text = c.npcActions[0]!.quote;
  const p = resolveSceneStepProgress(c);
  assert.deepEqual(
    p.matters
      .find((m) => m.id === c.stepProposals[0]!.matterId)!
      .stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'receiver_inspected'],
  );
  assert.deepEqual(p.completedMatterIds, []);
});
