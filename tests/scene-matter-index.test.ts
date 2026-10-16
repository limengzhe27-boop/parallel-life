import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import { resolveSceneStepProgress } from '../src/modules/world/domain/scene-step-progress.ts';
import { progressionFixture } from './fixtures/matter-progression.ts';
import type { ScenePlanningContext } from '../src/modules/world/application/scene-ports.ts';

function fixture() {
  const f = progressionFixture('county-yellow-hair');
  const scope = {
    ownerId: f.world.ownerId,
    worldId: f.world.id,
    sceneId: f.scene.id,
    sourceEventId: randomUUID(),
    sourceVersion: f.world.version,
  };
  const local = sceneMatterId(f.scene.id, f.trigger.id);
  const c: ScenePlanningContext = {
    world: f.world,
    scene: f.scene,
    storyAt: f.world.time,
    appointmentTitle: f.trigger.title,
    entries: [],
    matters: [{ ...scope, id: local, title: f.trigger.title, status: 'in_progress' }],
    action: {
      ...scope,
      id: randomUUID(),
      commandId: randomUUID(),
      status: 'pending',
      kind: 'operate',
      intent: 'attempt',
      relatedMatterIds: [local],
      text: '我核对R17维修单。',
    },
  };
  const wire = {
    evidenceFormat: 'indexed-observations-v2',
    location: '修车铺',
    narration: '维修单在柜台上。',
    presentActorIds: [f.actorId],
    outcome: 'partial',
    observation: ['你核对R17维修单。'],
    matterUpdates: [],
    dialogues: [],
    stepProposals: [
      { matterIndex: 0, stepId: 'order_reviewed', inputQuote: c.action!.text, observationIndex: 0 },
    ],
  };
  return { f, c, wire };
}
async function run(x: ReturnType<typeof fixture>, wire: unknown = x.wire) {
  let calls = 0;
  const planner = new ScenePlanner({
    async complete(messages) {
      if (calls++ === 0) {
        const payload = JSON.parse(messages[1]!.content.split('\nCURRENT TASK:')[0]!);
        assert.equal(
          payload.structuredStepContexts[0]?.matterIndex,
          x.c.action?.intent === 'attempt' ? 0 : undefined,
        );
        return JSON.stringify(wire);
      }
      return JSON.stringify({ text: '单据看过了。', actions: [] });
    },
  });
  return { result: await planner.propose(x.c), calls };
}
test('explicit v2 binds the selected existing WORLD matter and exact observation without a model ID', async () => {
  const x = fixture(),
    { result, calls } = await run(x);
  assert.equal(calls, 2);
  assert.equal(result.stepProposals![0]!.matterId, x.f.trigger.id);
  assert.notEqual(result.stepProposals![0]!.matterId, x.c.matters[0]!.id);
  assert.equal(result.stepProposals![0]!.observationQuote, x.wire.observation[0]);
  assert.ok(!('matterIndex' in result.stepProposals![0]!));
  const event = { id: randomUUID(), version: x.f.world.version + 1, at: x.f.world.time };
  const progress = resolveSceneStepProgress({
    world: x.f.world,
    initial: x.f.initial,
    scene: x.c.scene,
    action: {
      ...x.c.action!,
      status: 'resolved',
      resolution: {
        outcome: result.outcome!,
        observation: result.observation!,
        sourceEventId: event.id,
        sourceVersion: event.version,
      },
    },
    stepProposals: result.stepProposals!,
    npcActions: [],
    dialogues: [],
    event,
  });
  assert.equal(progress.completedMatterIds.length, 0);
});
for (const index of [-1, 0.5, 32, 1, '0', null, undefined]) {
  test(`v2 rejects an invalid or nonexistent matter index ${String(index)}`, async () => {
    const x = fixture();
    const step = { ...x.wire.stepProposals[0], matterIndex: index };
    await assert.rejects(
      run(x, { ...x.wire, stepProposals: [step] }),
      (error: any) =>
        error.message === 'scene_step_evidence:matter_index' &&
        !error.message.includes(x.f.trigger.id),
    );
  });
}
test('v2 cannot mix IDs, repair a bad original input or accept an invented step', async () => {
  for (const patch of [
    { matterId: 'PRIVATE_UNKNOWN_ID' },
    { inputQuote: '我已经成功了' },
    { stepId: 'received' },
    { stepId: 'PRIVATE_UNKNOWN_STEP' },
    { receiverId: 'foreign' },
  ]) {
    const x = fixture();
    await assert.rejects(
      run(x, { ...x.wire, stepProposals: [{ ...x.wire.stepProposals[0], ...patch }] }),
    );
  }
});
test('old v1 wrong matter ID remains rejected instead of being repaired by v2 mapping', async () => {
  const x = fixture();
  await assert.rejects(
    run(x, {
      ...x.wire,
      evidenceFormat: 'indexed-observations-v1',
      stepProposals: [
        {
          matterId: x.c.matters[0]!.id,
          stepId: 'order_reviewed',
          inputQuote: x.c.action!.text,
          observationIndex: 0,
        },
      ],
    }),
    /scene_step_evidence:matter_id/,
  );
});
test('a valid v2 index still cannot turn a deferred player clause into completion', async () => {
  const x = fixture();
  x.c.action!.text = '我打算核对R17维修单。';
  const { result } = await run(x, {
    ...x.wire,
    stepProposals: [{ ...x.wire.stepProposals[0], inputQuote: x.c.action!.text }],
  });
  const event = { id: randomUUID(), version: x.f.world.version + 1, at: x.f.world.time };
  assert.throws(
    () =>
      resolveSceneStepProgress({
        world: x.f.world,
        initial: x.f.initial,
        scene: x.c.scene,
        action: {
          ...x.c.action!,
          status: 'resolved',
          resolution: {
            outcome: result.outcome!,
            observation: result.observation!,
            sourceEventId: event.id,
            sourceVersion: event.version,
          },
        },
        stepProposals: result.stepProposals!,
        npcActions: [],
        dialogues: [],
        event,
      }),
    /SCENE_STEPS: Unsupported player execution quote/,
  );
});
