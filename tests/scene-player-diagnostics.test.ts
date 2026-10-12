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
const mutations: [string, (c: ReturnType<typeof fixture>) => void][] = [
  [
    'unsupported_step',
    (c) => {
      c.stepProposals[0]!.stepId = 'unknown';
    },
  ],
  [
    'npc_only_step',
    (c) => {
      c.stepProposals[0]!.stepId = 'received';
    },
  ],
  [
    'action_failed',
    (c) => {
      c.action.resolution.outcome = 'failed' as never;
    },
  ],
  [
    'input_not_actual',
    (c) => {
      c.stepProposals[0]!.inputQuote = '我将不存在的钥匙交给老周。';
    },
  ],
  [
    'observation_not_actual',
    (c) => {
      c.stepProposals[0]!.observationQuote = '你将不存在的钥匙交给老周。';
    },
  ],
  [
    'input_condition_1',
    (c) => {
      c.stepProposals[0]!.inputQuote = '交给老周。';
    },
  ],
  [
    'observation_condition_1',
    (c) => {
      c.stepProposals[0]!.observationQuote = '交给老周。';
    },
  ],
  [
    'observation_not_player',
    (c) => {
      c.action.resolution.observation = c.stepProposals[0]!.inputQuote;
      c.stepProposals[0]!.observationQuote = c.stepProposals[0]!.inputQuote;
    },
  ],
];
for (const [code, mutate] of mutations)
  test(`player source condition diagnostic ${code} retains rejection and reveals no raw values`, () => {
    const c = fixture();
    mutate(c);
    const before = structuredClone(c);
    assert.throws(
      () => resolveSceneStepProgress(c),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(
          e.message,
          `SCENE_STEPS: Unsupported player execution quote;player_step_condition:${code}`,
        );
        assert.ok(!e.message.includes(c.world.id));
        assert.ok(!e.message.includes('老周'));
        assert.ok(!e.message.includes(c.action.text));
        return true;
      },
    );
    assert.deepEqual(c, before);
  });
test('fixed player diagnosis keeps valid actual handover plus independent receiving accepted', () => {
  const c = fixture(),
    p = resolveSceneStepProgress(c);
  assert.deepEqual(
    p.matters
      .find((m) => m.id === c.stepProposals[0]!.matterId)!
      .stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'received'],
  );
  assert.deepEqual(p.completedMatterIds, []);
});
