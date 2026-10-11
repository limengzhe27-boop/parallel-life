import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import { progressionFixture } from './fixtures/matter-progression.ts';
import type { ScenePlanningContext } from '../src/modules/world/application/scene-ports.ts';
function fixture(intent: 'attempt' | 'plan' = 'attempt') {
  const f = progressionFixture('county-yellow-hair');
  const scope = {
    worldId: f.world.id,
    ownerId: f.world.ownerId,
    sceneId: f.scene.id,
    sourceEventId: randomUUID(),
    sourceVersion: f.world.version,
  };
  const localId = sceneMatterId(f.scene.id, f.trigger.id);
  const c: ScenePlanningContext = {
    world: f.world,
    scene: f.scene,
    storyAt: f.world.time,
    appointmentTitle: f.trigger.title,
    entries: [],
    matters: [{ ...scope, id: localId, title: f.trigger.title, status: 'in_progress' }],
    action: {
      ...scope,
      id: randomUUID(),
      commandId: randomUUID(),
      status: 'pending',
      kind: 'operate',
      intent,
      relatedMatterIds: [localId],
      text: '我核对R17维修单，向老周说明电源接头检修，将R17钥匙和维修单交给老周。',
    },
  };
  const observation = '你核对R17维修单，向老周说明电源接头检修，将R17钥匙和维修单交给老周。';
  const director = {
    location: '修车店',
    narration: '维修单放在柜台上。',
    presentActorIds: [f.actorId],
    outcome: intent === 'attempt' ? 'succeeded' : null,
    observation: intent === 'attempt' ? observation : null,
    matterTitle: null,
    initialMatters: [],
    matterUpdates: [],
    dialogues: [],
    stepProposals:
      intent === 'attempt'
        ? [
            {
              matterId: f.trigger.id,
              stepId: 'handed_over',
              inputQuote: '将R17钥匙和维修单交给老周',
              observationQuote: observation,
              receiverId: f.actorId,
            },
          ]
        : [],
  };
  return { f, c, director };
}
async function run(
  f: ReturnType<typeof fixture>,
  onCall?: (messages: { content: string }[], index: number) => void,
) {
  let calls = 0;
  return new ScenePlanner({
    async complete(messages) {
      onCall?.(messages, calls);
      return JSON.stringify(
        calls++ === 0
          ? f.director
          : f.c.action
            ? { text: '先按维修单核对。', actions: [] }
            : { present: true, text: '你先看一下维修单。' },
      );
    },
  }).propose(f.c);
}
const cases: [string, (f: ReturnType<typeof fixture>) => void][] = [
  [
    'context',
    (f) => {
      f.c.matters = [];
      f.c.action!.relatedMatterIds = [];
    },
  ],
  [
    'matter_id',
    (f) => {
      f.director.stepProposals[0]!.matterId = f.c.matters[0]!.id;
    },
  ],
  [
    'step_id',
    (f) => {
      f.director.stepProposals[0]!.stepId = 'PRIVATE_BAD_STEP';
    },
  ],
  [
    'forbidden_npc_step',
    (f) => {
      f.director.stepProposals[0]!.stepId = 'received';
    },
  ],
  [
    'failed_outcome',
    (f) => {
      f.director.outcome = 'failed';
    },
  ],
  [
    'input_quote',
    (f) => {
      f.director.stepProposals[0]!.inputQuote = 'PRIVATE_BAD_INPUT_QUOTE';
    },
  ],
  [
    'observation_quote',
    (f) => {
      f.director.stepProposals[0]!.observationQuote = 'PRIVATE_BAD_OBSERVATION_QUOTE';
    },
  ],
  [
    'receiver',
    (f) => {
      f.director.stepProposals[0]!.receiverId = 'PRIVATE_BAD_RECEIVER';
    },
  ],
];
for (const [code, mutate] of cases) {
  test(`current player step rejection gives only a safe condition: ${code}`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(run(f), (error: unknown) => {
      const e = error as Error & { code: string; stage: string; diagnosticMessage: string };
      assert.equal(e.code, 'INVALID_PROPOSAL');
      assert.equal(e.stage, 'proposal');
      assert.equal(e.diagnosticMessage, `scene_step_evidence:${code}`);
      assert.equal(e.message, e.diagnosticMessage);
      assert.ok(!e.message.includes(f.f.trigger.id));
      assert.ok(!e.message.includes('PRIVATE_BAD'));
      assert.ok(!e.message.includes('老周'));
      return true;
    });
  });
}
test('valid execution retains world IDs and the director prompt distinguishes local IDs with Chinese observation', async () => {
  const f = fixture();
  const result = await run(f, (messages, index) => {
    if (index !== 0) return;
    assert.match(messages[0]!.content, /matterUpdates.id必须取worldMatterConditions.id/);
    assert.match(messages[0]!.content, /stepExecution.matterId/);
    assert.match(messages[0]!.content, /observation用中文/);
    assert.ok(!messages[0]!.content.includes('Observable result of this action'));
  });
  assert.equal(result.stepProposals?.[0]?.matterId, f.f.trigger.id);
  assert.notEqual(f.f.trigger.id, f.c.matters[0]!.id);
});
test('opening addressee stays unnamed player and only authorized visible identity facts enter the call', async () => {
  const f = fixture();
  delete f.c.action;
  f.c.scene.presence = f.c.scene.presence.filter((p) => p.participant.kind === 'player');
  f.director.stepProposals = [];
  f.director.outcome = null;
  f.director.observation = null;
  f.director.presentActorIds = [];
  f.c.world.facts.push(
    {
      id: 'public-player',
      text: '主角在修车铺工作。',
      kind: 'canonical',
      sourceEventId: 'genesis:public',
      visibility: { kind: 'actors', actorIds: [f.f.actorId] },
    },
    {
      id: 'private-player',
      text: 'PRIVATE_OWNER_IDENTITY',
      kind: 'canonical',
      sourceEventId: 'genesis:private',
      visibility: { kind: 'owner' },
    },
  );
  let actorCalls = 0;
  await run(f, (messages, index) => {
    if (index === 0) return;
    actorCalls++;
    const input = JSON.parse(messages[1]!.content);
    assert.deepEqual(input.addressee, { kind: 'player', name: null });
    assert.ok(input.visibleFacts.some((fact: { id: string }) => fact.id === 'public-player'));
    assert.ok(!messages[1]!.content.includes('PRIVATE_OWNER_IDENTITY'));
    assert.ok(!('playerIdentity' in input));
    assert.match(messages[0]!.content, /车主姓名不能当作玩家姓名/);
    assert.match(messages[0]!.content, /未给价格时不编金额/);
  });
  assert.equal(actorCalls, 1);
});
