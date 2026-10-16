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
  const input = '我向老周说明R17接头检修细节。';
  const observation = '你向老周说明R17接头检修细节。';
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
        stepId: 'repair_explained',
        inputQuote: input,
        observationQuote: observation,
        receiverId: f.actorId,
      },
    ],
    npcActions: [],
    dialogues: [],
  };
}

const cases: [string, (c: ReturnType<typeof fixture>) => void][] = [
  [
    'not_found',
    (c) => {
      c.stepProposals[0]!.receiverId = randomUUID();
    },
  ],
  [
    'not_related',
    (c) => {
      c.stepProposals[0]!.receiverId = c.world.actors.find(
        (a) => a.id !== c.stepProposals[0]!.receiverId,
      )!.id;
    },
  ],
  [
    'not_present',
    (c) => {
      c.scene.presence = c.scene.presence.filter((p) => p.participant.kind === 'player');
    },
  ],
  [
    'input_not_named',
    (c) => {
      c.action.text = '我说明R17接头检修细节。';
      c.stepProposals[0]!.inputQuote = c.action.text;
    },
  ],
  [
    'observation_not_named',
    (c) => {
      c.action.resolution!.observation = '你说明R17接头检修细节。';
      c.stepProposals[0]!.observationQuote = c.action.resolution!.observation;
    },
  ],
];
for (const [code, mutate] of cases) {
  test(`receiver rejection retains its boundary and exposes only fixed ${code}`, () => {
    const c = fixture();
    mutate(c);
    const before = structuredClone(c);
    assert.throws(
      () => resolveSceneStepProgress(c),
      (error) => {
        const e = error as Error & { code: string };
        assert.equal(e.code, 'INVALID_PROPOSAL');
        assert.equal(
          e.message,
          `SCENE_STEPS: Receiver not actually addressed/present;receiver_condition:${code}`,
        );
        for (const value of [
          c.world.id,
          c.action.text,
          ...c.world.actors.map((a) => a.id),
          ...c.world.actors.map((a) => a.name),
        ])
          assert.ok(!e.message.includes(value));
        return true;
      },
    );
    assert.deepEqual(c, before);
  });
}
test('receiver diagnosis keeps successful original evidence and deterministic first rejection', () => {
  const c = fixture();
  const result = resolveSceneStepProgress(c);
  const step = result.matters.find((m) => m.id === c.stepProposals[0]!.matterId)!.stepProgress!
    .steps[0]!;
  assert.equal(step.stepId, 'repair_explained');
  assert.equal(step.receiverId, c.stepProposals[0]!.receiverId);
  c.stepProposals[0]!.receiverId = randomUUID();
  c.scene.presence = [];
  // Player-not-present is an earlier independent boundary; receiver codes cannot mask it.
  assert.throws(() => resolveSceneStepProgress(c), /Player not present/);
});
