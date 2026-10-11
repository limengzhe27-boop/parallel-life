import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import { progressionFixture } from './fixtures/matter-progression.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import {
  resolveSceneStepProgress,
  completeSceneSteps,
} from '../src/modules/world/domain/scene-step-progress.ts';
import type {
  ScenePlanningContext,
  SceneProposal,
} from '../src/modules/world/application/scene-ports.ts';

type Mode = 'explain' | 'handover' | 'inspect';
function fixture(mode: Mode = 'explain') {
  const f = progressionFixture('county-yellow-hair');
  const lines = {
    explain: ['我向老周说明R17电源接头检修。', '你向老周说明R17电源接头检修。'],
    handover: ['我将R17钥匙和维修单交给老周。', '你将R17钥匙和维修单交给老周。'],
    inspect: ['老周，请你检查R17接头。', '你请老周检查R17接头，等待他决定。'],
  };
  const [input, observation] = lines[mode];
  const localId = sceneMatterId(f.scene.id, f.trigger.id);
  const scope = {
    worldId: f.world.id,
    ownerId: f.world.ownerId,
    sceneId: f.scene.id,
    sourceEventId: randomUUID(),
    sourceVersion: f.world.version,
  };
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
      intent: 'attempt',
      relatedMatterIds: [localId],
      text: input!,
    },
  };
  const director: SceneProposal = {
    location: '修车店',
    narration: '维修单放在柜台。',
    presentActorIds: [f.actorId],
    outcome: 'partial',
    observation: observation!,
    matterTitle: null,
    initialMatters: [],
    matterUpdates: [],
    dialogues: [],
    stepProposals:
      mode === 'inspect'
        ? []
        : [
            {
              matterId: f.trigger.id,
              stepId: mode === 'handover' ? 'handed_over' : 'repair_explained',
              inputQuote: input!,
              observationQuote: observation!,
              receiverId: f.actorId,
            },
          ],
  };
  return { f, c, director };
}
async function propose(
  f: ReturnType<typeof fixture>,
  reply: unknown = {
    actionFormat: 'indexed-npc-actions-v1',
    text: '这次说明我听清了。',
    actions: [],
  },
) {
  const calls: { role: string; content: string }[][] = [];
  const proposal = await new ScenePlanner({
    async complete(messages) {
      calls.push(messages);
      return JSON.stringify(calls.length === 1 ? f.director : reply);
    },
  }).propose(f.c);
  return { proposal, calls, npc: JSON.parse(calls[1]![1]!.content), prompt: calls[1]![0]!.content };
}
const received = '我接过R17钥匙和维修单。';
const inspected = '我检查了R17接头。';
const indexed = (text = received, actionIndex: unknown = 0) => ({
  actionFormat: 'indexed-npc-actions-v1',
  text,
  actions: [{ actionIndex, quote: text }],
});
function saveHandover(f: ReturnType<typeof fixture>, receipt = false, inspection = false) {
  const hand = fixture('handover');
  hand.c.world = f.c.world;
  hand.c.scene = f.c.scene;
  const event = { id: randomUUID(), version: f.c.world.version + 1, at: f.c.world.time };
  const action = {
    ...f.c.action!,
    text: hand.c.action!.text,
    status: 'resolved' as const,
    resolution: {
      sourceEventId: event.id,
      sourceVersion: event.version,
      outcome: 'partial' as const,
      observation: hand.director.observation!,
    },
  };
  const step = {
    ...hand.director.stepProposals![0]!,
    matterId: f.f.trigger.id,
    receiverId: f.f.actorId,
  };
  const text = [receipt ? received : '', inspection ? inspected : ''].filter(Boolean).join('');
  const progress = resolveSceneStepProgress({
    world: f.c.world,
    initial: f.f.initial,
    scene: f.c.scene,
    action,
    stepProposals: [step],
    npcActions: [
      ...(receipt
        ? [
            {
              matterId: f.f.trigger.id,
              actorId: f.f.actorId,
              kind: 'receive_r17' as const,
              quote: received,
            },
          ]
        : []),
      ...(inspection
        ? [
            {
              matterId: f.f.trigger.id,
              actorId: f.f.actorId,
              kind: 'inspect_r17' as const,
              quote: inspected,
            },
          ]
        : []),
    ],
    dialogues: text ? [{ actorId: f.f.actorId, text }] : [],
    event,
  });
  f.c.world = { ...f.c.world, matters: progress.matters, version: event.version };
  f.c.action!.sourceVersion = event.version;
}
test('ordinary repair explanation emits explicit empty action slots and accepts honest no-action reply', async () => {
  const r = await propose(fixture());
  assert.deepEqual(r.npc.allowedActions, []);
  assert.deepEqual(r.proposal.npcActions, []);
  assert.ok(r.prompt.includes('indexed-npc-actions-v1'));
  assert.ok(!r.prompt.includes('"kind":"receive_r17"'));
  assert.ok(!r.prompt.includes('"kind":"inspect_r17"'));
});
test('actual handover exposes two actor-owned slots and binds indexed receipt without model IDs or kind', async () => {
  const f = fixture('handover');
  const r = await propose(f, indexed());
  assert.deepEqual(
    r.npc.allowedActions.map((a: { actionIndex: number; kind: string; matterId: string }) => [
      a.actionIndex,
      a.kind,
      a.matterId,
    ]),
    [
      [0, 'receive_r17', f.f.trigger.id],
      [1, 'inspect_r17', f.f.trigger.id],
    ],
  );
  assert.deepEqual(r.proposal.npcActions, [
    { matterId: f.f.trigger.id, actorId: f.f.actorId, kind: 'receive_r17', quote: received },
  ]);
  assert.equal(r.calls.length, 2);
  assert.deepEqual(r.proposal.matterUpdates, []);
  assert.equal(completeSceneSteps(f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!), false);
});
test('specific request enables only inspection, never unhanded receiving', async () => {
  const f = fixture('inspect');
  const r = await propose(f, indexed(inspected));
  assert.deepEqual(
    r.npc.allowedActions.map((a: { kind: string }) => a.kind),
    ['inspect_r17'],
  );
  assert.equal(r.proposal.npcActions![0]!.kind, 'inspect_r17');
});
test('prior witnessed sourced handover permits actual receiving in a later turn', async () => {
  const f = fixture();
  saveHandover(f);
  const r = await propose(f, indexed());
  assert.equal(r.proposal.npcActions![0]!.kind, 'receive_r17');
  assert.deepEqual(
    r.npc.allowedActions.map((a: { kind: string }) => a.kind),
    ['receive_r17', 'inspect_r17'],
  );
});
test('canonical received or inspected suppresses repeat slots even if its source is private to another witness', async () => {
  const f = fixture();
  saveHandover(f, true, true);
  const matter = f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!;
  for (const e of matter.stepProgress!.steps.filter((e) => e.performer === 'actor'))
    e.witnessActorIds = [];
  const r = await propose(f);
  assert.deepEqual(r.npc.allowedActions, []);
});
for (const reason of [
  'unwitnessed',
  'blocked-input',
  'blocked-result',
  'blocked-action',
  'wrong-receiver',
] as const) {
  test(`prior handover does not permit a slot when ${reason}`, async () => {
    const f = fixture();
    saveHandover(f);
    const step = f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress!.steps[0]!;
    if (reason === 'unwitnessed') step.witnessActorIds = [];
    else if (reason === 'wrong-receiver') step.receiverId = 'other';
    else
      f.c.blockedSourcesByActor = {
        [f.f.actorId]: [
          reason === 'blocked-input'
            ? step.inputEventId
            : reason === 'blocked-result'
              ? step.eventId
              : step.actionId,
        ],
      };
    const r = await propose(f);
    assert.deepEqual(r.npc.allowedActions, []);
  });
}
for (const line of [
  '老周，请你检查R18接头。',
  '老周，我明天请你检查R17接头。',
  '老周，我不会请你检查R17接头。',
  '我说“老周，请你检查R17接头”。',
  '请阿杰检查R17接头。',
  '老周，你先检查一下吧。',
]) {
  test(`request without current explicit bounded object and receiver gives no slot: ${line}`, async () => {
    const f = fixture('inspect');
    f.c.action!.text = line;
    const r = await propose(f);
    assert.deepEqual(r.npc.allowedActions, []);
  });
}
for (const bad of ['0', -1, 0.5, 16, 1, null]) {
  test(`reject invalid or nonexistent action index ${JSON.stringify(bad)}`, async () => {
    const f = fixture('inspect');
    await assert.rejects(propose(f, indexed(inspected, bad)), { code: 'INVALID_PROPOSAL' });
  });
}
for (const key of ['matterId', 'kind', 'actorId']) {
  test(`explicit wire rejects mixed legacy ${key}`, async () => {
    const f = fixture('handover');
    const r = indexed();
    Object.assign(r.actions[0]!, { [key]: 'SECRET_BAD_VALUE' });
    await assert.rejects(propose(f, r), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.ok(!e.message.includes('SECRET_BAD_VALUE'));
      return true;
    });
  });
}
test('unknown action format, old malformed kind, no explicit format and duplicate indexed actions reject', async () => {
  const f = fixture('handover');
  for (const r of [
    { ...indexed(), actionFormat: 'v99' },
    { text: received, actions: [{ matterId: f.f.trigger.id, kind: 'receive', quote: received }] },
    { text: received, actions: [{ actionIndex: 0, quote: received }] },
    {
      ...indexed(),
      actions: [
        { actionIndex: 0, quote: received },
        { actionIndex: 0, quote: received },
      ],
    },
  ])
    await assert.rejects(propose(f, r), { code: 'INVALID_PROPOSAL' });
});
test('empty slots cannot be indexed into a forged receipt; no executed claim may be dropped into no-action success', async () => {
  await assert.rejects(propose(fixture(), indexed()), { code: 'INVALID_PROPOSAL' });
  const f = fixture();
  await assert.rejects(
    propose(f, {
      text: received,
      actions: [{ matterId: f.f.trigger.id, kind: 'receive_r17', quote: received }],
    }),
    { code: 'INVALID_PROPOSAL' },
  );
  await assert.rejects(
    propose(fixture(), { actionFormat: 'indexed-npc-actions-v1', text: received, actions: [] }),
    { code: 'INVALID_PROPOSAL' },
  );
});
test('future, negated, wrong-object and not-in-text quotes remain rejected by adapter or original runtime', async () => {
  for (const text of [
    '我会接过R17钥匙和维修单。',
    '我没有接过R17钥匙和维修单。',
    '我接过R18钥匙和维修单。',
  ]) {
    const f = fixture('handover');
    try {
      const r = await propose(f, indexed(text));
      const event = { id: randomUUID(), version: f.c.world.version + 1, at: f.c.world.time };
      const action = {
        ...f.c.action!,
        status: 'resolved' as const,
        resolution: {
          sourceEventId: event.id,
          sourceVersion: event.version,
          outcome: r.proposal.outcome!,
          observation: r.proposal.observation!,
        },
      };
      assert.throws(
        () =>
          resolveSceneStepProgress({
            world: f.c.world,
            initial: f.f.initial,
            scene: f.c.scene,
            action,
            stepProposals: r.proposal.stepProposals!,
            npcActions: r.proposal.npcActions!,
            dialogues: r.proposal.dialogues,
            event,
          }),
        { code: 'INVALID_PROPOSAL' },
      );
    } catch (e) {
      assert.equal((e as { code: string }).code, 'INVALID_PROPOSAL');
    }
  }
  const f = fixture('handover');
  await assert.rejects(propose(f, { ...indexed(), text: '好的。' }), { code: 'INVALID_PROPOSAL' });
});
test('classic correct receiving stays compatible with original canonical execution schema', async () => {
  const f = fixture('handover');
  const r = await propose(f, {
    text: received,
    actions: [{ matterId: f.f.trigger.id, kind: 'receive_r17', quote: received }],
  });
  assert.equal(r.proposal.npcActions![0]!.actorId, f.f.actorId);
});
test('invalid current handover evidence cannot generate usable receipt slots', async () => {
  const f = fixture('handover');
  f.c.action!.text = '我明天将R17钥匙和维修单交给老周。';
  await assert.rejects(propose(f, indexed()), { code: 'INVALID_PROPOSAL' });
});

test('mentioning this actor alongside a request to another receiver grants no inspection slot', async () => {
  const f = fixture('inspect');
  f.c.action!.text = '请阿杰检查R17接头，老周在旁边。';
  assert.deepEqual((await propose(f)).npc.allowedActions, []);
});
test('current input/action blocked to actor and blocked matter never grants handover slots', async () => {
  for (const source of ['input', 'action', 'matter']) {
    const f = fixture('handover');
    f.c.blockedSourcesByActor = {
      [f.f.actorId]: [
        source === 'input'
          ? f.c.action!.sourceEventId
          : source === 'action'
            ? f.c.action!.id
            : f.f.trigger.id,
      ],
    };
    const r = await propose(f);
    assert.deepEqual(r.npc.allowedActions, []);
  }
});
test('another present receiver gets its own empty slots and cannot reuse the named receiver index', async () => {
  const f = fixture('handover');
  const other = f.c.world.actors.find((a) => a.id !== f.f.actorId)!;
  f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!.relatedActorIds!.push(other.id);
  f.c.scene.presence.push({
    participant: { kind: 'actor', actorId: other.id },
    joinedVersion: 0,
    sourceVersion: 0,
    sourceEventId: 'opening',
  });
  f.director.presentActorIds.push(other.id);
  const inputs: Record<string, unknown>[] = [];
  const p = await new ScenePlanner({
    async complete(messages) {
      if (!inputs.length) {
        inputs.push({ director: true });
        return JSON.stringify(f.director);
      }
      const npc = JSON.parse(messages[1]!.content);
      inputs.push(npc);
      return JSON.stringify(
        inputs.length === 2
          ? indexed()
          : { actionFormat: 'indexed-npc-actions-v1', text: '你们先交接，我在旁边。', actions: [] },
      );
    },
  }).propose(f.c);
  assert.equal(inputs.length, 3);
  assert.equal((inputs[1]!.allowedActions as unknown[]).length, 2);
  assert.deepEqual(inputs[2]!.allowedActions, []);
  assert.equal(p.npcActions!.length, 1);
  let call = 0;
  await assert.rejects(
    new ScenePlanner({
      async complete() {
        call++;
        return JSON.stringify(call === 1 ? f.director : indexed());
      },
    }).propose(f.c),
    { code: 'INVALID_PROPOSAL' },
  );
});
test('indexed independent receiving reaches original aggregate completion only with all actual player steps', async () => {
  const f = fixture('handover');
  f.c.action!.text = '我核对R17维修单。向老周说明R17电源接头检修。将R17钥匙和维修单交给老周。';
  f.director.observation =
    '你核对R17维修单。你向老周说明R17电源接头检修。你将R17钥匙和维修单交给老周。';
  f.director.stepProposals = ['order_reviewed', 'repair_explained', 'handed_over'].map(
    (stepId, index) => ({
      matterId: f.f.trigger.id,
      stepId,
      inputQuote: f.c.action!.text.split('。')[index] + '。',
      observationQuote: f.director.observation!.split('。')[index] + '。',
      ...(index ? { receiverId: f.f.actorId } : {}),
    }),
  );
  const r = await propose(f, indexed());
  const event = { id: randomUUID(), version: f.c.world.version + 1, at: f.c.world.time };
  const action = {
    ...f.c.action!,
    status: 'resolved' as const,
    resolution: {
      sourceEventId: event.id,
      sourceVersion: event.version,
      outcome: r.proposal.outcome!,
      observation: r.proposal.observation!,
    },
  };
  const progress = resolveSceneStepProgress({
    world: f.c.world,
    initial: f.f.initial,
    scene: f.c.scene,
    action,
    stepProposals: r.proposal.stepProposals!,
    npcActions: r.proposal.npcActions!,
    dialogues: r.proposal.dialogues,
    event,
  });
  assert.deepEqual(progress.completedMatterIds, [f.f.trigger.id]);
  assert.equal(completeSceneSteps(progress.matters.find((m) => m.id === f.f.trigger.id)!), true);
  assert.equal(completeSceneSteps(f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!), false);
  assert.equal(r.proposal.outcome, 'partial');
});
