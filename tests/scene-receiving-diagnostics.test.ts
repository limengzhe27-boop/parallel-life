import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { progressionFixture } from './fixtures/matter-progression.ts';
import { resolveSceneStepProgress } from '../src/modules/world/domain/scene-step-progress.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import type { SceneAction } from '../src/modules/world/domain/experience-rules.ts';

function fixture() {
  const f = progressionFixture('county-yellow-hair');
  const event = { id: randomUUID(), version: f.world.version + 1, at: f.world.time };
  const input = '我将R17钥匙与维修单交给老周。';
  const observation = '你将R17钥匙与维修单交给老周。';
  const action: SceneAction = {
    id: randomUUID(),
    commandId: randomUUID(),
    ownerId: f.world.ownerId,
    worldId: f.world.id,
    sceneId: f.scene.id,
    kind: 'operate',
    intent: 'attempt',
    status: 'resolved',
    text: input,
    sourceEventId: randomUUID(),
    sourceVersion: f.world.version,
    relatedMatterIds: [sceneMatterId(f.scene.id, f.trigger.id)],
    resolution: {
      sourceEventId: event.id,
      sourceVersion: event.version,
      outcome: 'partial',
      observation,
    },
  };
  return {
    world: f.world,
    initial: f.initial,
    scene: f.scene,
    action,
    event,
    stepProposals: [
      {
        matterId: f.trigger.id,
        stepId: 'handed_over',
        inputQuote: input,
        observationQuote: observation,
        receiverId: f.actorId,
      },
    ],
    npcActions: [
      {
        matterId: f.trigger.id,
        actorId: f.actorId,
        kind: 'receive_r17' as const,
        quote: '我接过R17钥匙和维修单。',
      },
    ],
    dialogues: [{ actorId: f.actorId, text: '我接过R17钥匙和维修单。' }],
  };
}
const cases: [string, (c: ReturnType<typeof fixture>) => void][] = [
  [
    'handover_not_saved_or_current',
    (c) => {
      c.stepProposals = [];
    },
  ],
  [
    'execution_not_explicit',
    (c) => {
      c.npcActions[0]!.quote = 'R17钥匙和维修单在这里。';
    },
  ],
  [
    'keys_not_named',
    (c) => {
      c.npcActions[0]!.quote = '我接过R17维修单。';
    },
  ],
  [
    'paperwork_not_named',
    (c) => {
      c.npcActions[0]!.quote = '我接过R17钥匙。';
    },
  ],
];
for (const [code, mutate] of cases) {
  test(`receiving keeps its original rejection boundary with safe ${code}`, () => {
    const c = fixture();
    mutate(c);
    c.dialogues[0]!.text = c.npcActions[0]!.quote;
    const before = structuredClone(c);
    assert.throws(
      () => resolveSceneStepProgress(c),
      (error) => {
        const e = error as Error & { code: string };
        assert.equal(e.code, 'INVALID_PROPOSAL');
        assert.equal(
          e.message,
          `SCENE_STEPS: Receiving lacks actual handed objects;receiving_condition:${code}`,
        );
        for (const secret of [
          c.world.id,
          c.action.text,
          ...c.world.actors.flatMap((a) => [a.id, a.name]),
        ])
          assert.ok(!e.message.includes(secret));
        return true;
      },
    );
    assert.deepEqual(c, before);
  });
}
test('safe receiving diagnosis neither blocks valid actual receiving nor masks earlier quote rejection', () => {
  const c = fixture();
  const result = resolveSceneStepProgress(c);
  assert.deepEqual(
    result.matters
      .find((m) => m.id === c.stepProposals[0]!.matterId)!
      .stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'received'],
  );
  assert.deepEqual(result.completedMatterIds, []);
  c.npcActions[0]!.quote = '我接过R17钥匙和维修单';
  c.dialogues[0]!.text = '你说“我接过R17钥匙和维修单”。';
  assert.throws(() => resolveSceneStepProgress(c), /NPC action not owned\/witnessed\/quoted/);
});
