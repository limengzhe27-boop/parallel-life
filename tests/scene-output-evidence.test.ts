import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import { progressionFixture } from './fixtures/matter-progression.ts';
import { resolveSceneStepProgress } from '../src/modules/world/domain/scene-step-progress.ts';
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
  wire?: unknown,
) {
  let calls = 0;
  return new ScenePlanner({
    async complete(messages) {
      onCall?.(messages, calls);
      return JSON.stringify(
        calls++ === 0
          ? (wire ?? f.director)
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
function indexed(f: ReturnType<typeof fixture>) {
  return {
    ...f.director,
    evidenceFormat: 'indexed-observations-v1',
    observation: [f.director.observation!] as string[] | null,
    stepProposals: f.director.stepProposals.map(
      ({ observationQuote: _quote, receiverId, ...step }) => ({
        ...step,
        observationIndex: 0,
        ...(receiverId ? { receiverId } : {}),
      }),
    ),
  };
}
test('NPC distinguishes saved missing steps from this turn review candidate without marking it done', async () => {
  const f = fixture();
  f.c.action!.text = '我核对R17维修单。';
  const wire = indexed(f);
  wire.observation = ['你核对了R17维修单。'];
  wire.stepProposals = [
    {
      matterId: f.f.trigger.id,
      stepId: 'order_reviewed',
      inputQuote: f.c.action!.text,
      observationIndex: 0,
      receiverId: undefined,
    },
  ];
  let actorCalls = 0;
  const p = await run(
    f,
    (messages, index) => {
      if (!index) return;
      actorCalls++;
      const input = JSON.parse(messages[1]!.content),
        steps = input.stepExecution[0];
      assert.deepEqual(steps.savedCompletedSteps, []);
      assert.ok(steps.savedRemainingSteps.some((s: { id: string }) => s.id === 'order_reviewed'));
      assert.equal(steps.steps.find((s: { id: string }) => s.id === 'order_reviewed').done, false);
      assert.deepEqual(steps.currentTurnStepCandidates, [
        {
          matterId: f.f.trigger.id,
          stepId: 'order_reviewed',
          inputQuote: '我核对R17维修单。',
          observationQuote: '你核对了R17维修单。',
        },
      ]);
      assert.ok(!('completedSteps' in steps));
      assert.ok(!('missingSteps' in steps));
      assert.ok(!('candidatePlayerSteps' in steps));
      assert.match(messages[0]!.content, /提交前快照，不是本轮新增门槛/);
      assert.match(messages[0]!.content, /不再说“单号先核对清楚”/);
      assert.match(messages[0]!.content, /不得提前把候选markdone/);
      assert.ok(!messages[0]!.content.includes('{"text":"单号先核对清楚。","actions":[]}'));
    },
    wire,
  );
  assert.equal(actorCalls, 1);
  assert.deepEqual(p.npcActions, []);
  assert.ok(!f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress);
});
test('explicit indexed wire binds a segment exactly and keeps domain evidence validation', async () => {
  const f = fixture(),
    wire = indexed(f);
  wire.observation = ['你核对R17维修单。', f.director.observation!];
  wire.stepProposals[0]!.observationIndex = 1;
  const p = await run(f, undefined, wire);
  assert.equal(p.observation, wire.observation.join('\n'));
  assert.equal(p.stepProposals![0]!.observationQuote, wire.observation[1]);
  assert.ok(!('evidenceFormat' in p));
  assert.ok(!('observationIndex' in p.stepProposals![0]!));
  const event = { id: randomUUID(), version: f.c.world.version + 1, at: f.c.world.time };
  const result = resolveSceneStepProgress({
    world: f.c.world,
    initial: f.f.initial,
    scene: f.c.scene,
    action: {
      ...f.c.action!,
      status: 'resolved',
      resolution: {
        outcome: p.outcome!,
        observation: p.observation!,
        sourceEventId: event.id,
        sourceVersion: event.version,
      },
    },
    stepProposals: p.stepProposals!,
    npcActions: p.npcActions!,
    dialogues: p.dialogues,
    event,
  });
  assert.equal(
    result.matters.find((m) => m.id === f.f.trigger.id)?.stepProgress?.steps[0]?.observationQuote,
    wire.observation[1],
  );
  assert.deepEqual(result.completedMatterIds, []);
});
for (const index of [-1, 0.5, 8, 1, '0', null]) {
  test(`indexed wire rejects invalid or nonexistent index without content diagnostics: ${index}`, async () => {
    const f = fixture(),
      wire = indexed(f);
    Object.assign(wire.stepProposals[0]!, { observationIndex: index });
    await assert.rejects(run(f, undefined, wire), (e: unknown) => {
      assert.equal((e as Error).message, 'scene_step_evidence:observation_index');
      return true;
    });
  });
}
test('indexed null observation with steps is rejected and null without steps remains neutral', async () => {
  const f = fixture(),
    wire = indexed(f);
  wire.observation = null;
  await assert.rejects(run(f, undefined, wire), {
    message: 'scene_step_evidence:observation_index',
  });
  delete f.c.action;
  f.c.scene.presence = f.c.scene.presence.filter((p) => p.participant.kind === 'player');
  wire.stepProposals = [];
  wire.outcome = null;
  wire.presentActorIds = [];
  assert.equal((await run(f, undefined, wire)).observation, null);
});
test('unknown version, mixed quote, invalid array and canonical length never fallback or normalize', async () => {
  const mutations: ((wire: ReturnType<typeof indexed>) => void)[] = [
    (w) => {
      w.evidenceFormat = 'unknown-version';
    },
    (w) => {
      Object.assign(w.stepProposals[0]!, { observationQuote: 'PRIVATE_MIXED_QUOTE' });
    },
    (w) => {
      w.observation = [];
    },
    (w) => {
      w.observation = Array(9).fill('你核对维修单。');
    },
    (w) => {
      w.observation = [''];
    },
    (w) => {
      Object.assign(w, { observation: '你核对维修单。' });
    },
    (w) => {
      w.observation = ['你'.repeat(900), '你'.repeat(900)];
    },
    (w) => {
      Object.assign(w.stepProposals[0]!, { unexpected: 'PRIVATE_UNKNOWN_VALUE' });
    },
  ];
  for (const mutate of mutations) {
    const f = fixture(),
      wire = indexed(f);
    mutate(wire);
    await assert.rejects(run(f, undefined, wire), { code: 'INVALID_PROPOSAL' });
  }
  const f = fixture();
  f.director.stepProposals[0]!.observationQuote = 'PRIVATE_BAD_CLASSIC_QUOTE';
  await assert.rejects(run(f), { message: 'scene_step_evidence:observation_quote' });
});
test('indexed input, forbidden NPC step and false performer remain rejected', async () => {
  for (const mutate of [
    (w: ReturnType<typeof indexed>) => {
      w.stepProposals[0]!.inputQuote = 'PRIVATE_UNSAVED_INPUT';
    },
    (w: ReturnType<typeof indexed>) => {
      w.stepProposals[0]!.stepId = 'received';
    },
  ]) {
    const f = fixture(),
      wire = indexed(f);
    mutate(wire);
    await assert.rejects(run(f, undefined, wire), { code: 'INVALID_PROPOSAL' });
  }
  const f = fixture(),
    wire = indexed(f);
  wire.observation = ['老周核对R17维修单。'];
  const p = await run(f, undefined, wire);
  const event = { id: randomUUID(), version: f.c.world.version + 1, at: f.c.world.time };
  assert.throws(
    () =>
      resolveSceneStepProgress({
        world: f.c.world,
        initial: f.f.initial,
        scene: f.c.scene,
        action: {
          ...f.c.action!,
          status: 'resolved',
          resolution: {
            outcome: p.outcome!,
            observation: p.observation!,
            sourceEventId: event.id,
            sourceVersion: event.version,
          },
        },
        stepProposals: p.stepProposals!,
        npcActions: p.npcActions!,
        dialogues: p.dialogues,
        event,
      }),
    { code: 'INVALID_PROPOSAL' },
  );
});
test('action NPC also receives anonymous player addressee without private identity', async () => {
  const f = fixture();
  f.c.world.facts.push({
    id: 'owner',
    text: 'PRIVATE_OWNER_PROFILE',
    kind: 'canonical',
    sourceEventId: 'genesis:owner',
    visibility: { kind: 'owner' },
  });
  let actorCalls = 0;
  await run(
    f,
    (messages, index) => {
      if (!index) return;
      actorCalls++;
      const input = JSON.parse(messages[1]!.content);
      assert.deepEqual(input.addressee, { kind: 'player', name: null });
      assert.ok(!messages[1]!.content.includes('PRIVATE_OWNER_PROFILE'));
      assert.match(messages[0]!.content, /先前错称不构成身份来源/);
    },
    indexed(f),
  );
  assert.equal(actorCalls, 1);
});
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
