import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import { progressionFixture } from './fixtures/matter-progression.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import { resolveSceneStepProgress } from '../src/modules/world/domain/scene-step-progress.ts';
import type {
  ScenePlanningContext,
  SceneProposal,
} from '../src/modules/world/application/scene-ports.ts';

type Mode = 'handover' | 'explain' | 'inspect';
type Payload = {
  actor: { name: string };
  allowedActions: { actionIndex: number; matterId: string; kind: string }[];
};
const receipt = '我接过R17钥匙和维修单。';
const inspection = '我检查了R17接头。';
const sentinel = 'AUDIT_PRIVATE_RAW_姓名_动作';
function fixture(mode: Mode = 'handover') {
  const f = progressionFixture('county-yellow-hair');
  const [input, observation] =
    mode === 'handover'
      ? ['我将R17钥匙和维修单交给老周。', '你将R17钥匙和维修单交给老周。']
      : mode === 'explain'
        ? ['我向老周说明接头检修。', '你向老周说明接头检修。']
        : ['请老周检查R17接头。', '你请老周检查R17接头，等待他决定。'];
  const local = sceneMatterId(f.scene.id, f.trigger.id);
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
    matters: [{ ...scope, id: local, title: f.trigger.title, status: 'in_progress' }],
    action: {
      ...scope,
      id: randomUUID(),
      commandId: randomUUID(),
      status: 'pending',
      kind: 'operate',
      intent: 'attempt',
      relatedMatterIds: [local],
      text: input!,
    },
  };
  const director: SceneProposal = {
    location: '修车铺',
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
type Fixture = ReturnType<typeof fixture>;
const marked = (text = receipt, index: unknown = 0, quote = text) => ({
  actionFormat: 'indexed-npc-actions-v1',
  text,
  actions: [{ actionIndex: index, quote }],
});
const passive = { actionFormat: 'indexed-npc-actions-v1', text: '这一步我听清了。', actions: [] };
async function run(f: Fixture, response: unknown | ((payload: Payload) => unknown) = passive) {
  const payloads: Payload[] = [];
  let calls = 0;
  const proposal = await new ScenePlanner({
    async complete(messages) {
      if (!calls++) return JSON.stringify(f.director);
      const payload: Payload = JSON.parse(messages[1]!.content);
      payloads.push(payload);
      return JSON.stringify(typeof response === 'function' ? response(payload) : response);
    },
  }).propose(f.c);
  return { proposal, payloads, calls };
}
function resolve(f: Fixture, p: SceneProposal) {
  const event = { id: randomUUID(), version: f.c.world.version + 1, at: f.c.world.time };
  return {
    event,
    delta: resolveSceneStepProgress({
      world: f.c.world,
      initial: f.f.initial,
      scene: f.c.scene,
      action: {
        ...f.c.action!,
        status: 'resolved',
        resolution: {
          sourceEventId: event.id,
          sourceVersion: event.version,
          outcome: p.outcome!,
          observation: p.observation!,
        },
      },
      stepProposals: p.stepProposals ?? [],
      npcActions: p.npcActions ?? [],
      dialogues: p.dialogues,
      event,
    }),
  };
}
async function rejected(f: Fixture, response: unknown | ((payload: Payload) => unknown)) {
  const before = structuredClone(f.c);
  await assert.rejects(run(f, response), (error: unknown) => {
    assert.ok(error instanceof Error);
    const e = error as Error & { code: string; stage: string; diagnosticMessage: string };
    assert.equal(e.code, 'INVALID_PROPOSAL');
    assert.equal(e.stage, 'proposal');
    assert.ok(e.diagnosticMessage.length <= 500);
    assert.ok(![e.message, e.stack, JSON.stringify(e)].join('\n').includes(sentinel));
    return true;
  });
  assert.deepEqual(f.c, before);
}
function savedHandover(f: Fixture) {
  const hand = fixture('handover');
  hand.f = f.f;
  hand.c.world = f.c.world;
  hand.c.scene = f.c.scene;
  hand.c.action = { ...f.c.action!, text: '我将R17钥匙和维修单交给老周。' };
  hand.director.stepProposals![0]!.matterId = f.f.trigger.id;
  hand.director.stepProposals![0]!.receiverId = f.f.actorId;
  const { delta, event } = resolve(hand, hand.director);
  f.c.world = { ...f.c.world, matters: delta.matters, version: event.version };
  f.c.action!.sourceVersion = event.version;
  return f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress!.steps[0]!;
}
test('Q NPC index: explanation has empty slots and accepts only honest no-action replies', async () => {
  const f = fixture('explain');
  const r = await run(f);
  assert.deepEqual(r.payloads[0]!.allowedActions, []);
  assert.deepEqual(r.proposal.npcActions, []);
  const classic = await run(f, { text: '说明听清了。', actions: [] });
  assert.deepEqual(classic.proposal.npcActions, []);
});
test('Q NPC index: receiving binds the current actor and source without whole-goal or snapshot credit', async () => {
  const f = fixture(),
    before = structuredClone(f.c);
  const r = await run(f, (payload: Payload) => {
    const slot = payload.allowedActions.find((s) => s.kind === 'receive_r17')!;
    assert.equal(slot.matterId, f.f.trigger.id);
    return marked(receipt, slot.actionIndex);
  });
  assert.deepEqual(r.proposal.npcActions, [
    { matterId: f.f.trigger.id, actorId: f.f.actorId, kind: 'receive_r17', quote: receipt },
  ]);
  const { delta, event } = resolve(f, r.proposal);
  const steps = delta.matters.find((m) => m.id === f.f.trigger.id)!.stepProgress!.steps;
  assert.deepEqual(
    steps.map((s) => s.stepId),
    ['handed_over', 'received'],
  );
  assert.equal(steps[1]!.performer, 'actor');
  assert.equal(steps[1]!.actorId, f.f.actorId);
  assert.equal(steps[1]!.eventId, event.id);
  assert.equal(steps[1]!.inputEventId, f.c.action!.sourceEventId);
  assert.deepEqual(delta.completedMatterIds, []);
  assert.deepEqual(f.c, before);
});
test('Q NPC index: explicit inspection grants only own inspection and cannot substitute receiving', async () => {
  const f = fixture('inspect');
  const r = await run(f, (payload: Payload) => {
    assert.deepEqual(
      payload.allowedActions.map((s) => s.kind),
      ['inspect_r17'],
    );
    return marked(inspection, payload.allowedActions[0]!.actionIndex);
  });
  const { delta } = resolve(f, r.proposal);
  assert.deepEqual(
    delta.matters.find((m) => m.id === f.f.trigger.id)!.stepProgress!.steps.map((s) => s.stepId),
    ['receiver_inspected'],
  );
  assert.deepEqual(delta.completedMatterIds, []);
});
for (const index of [-1, 0.25, '0', null, undefined, 16, 15]) {
  test(`Q NPC index: invalid or absent slot ${String(index)} rejects the entire reply`, async () => {
    const reply = marked();
    reply.actions[0]!.actionIndex = index;
    await rejected(fixture(), reply);
  });
}
test('Q NPC index: duplicate index is rejected rather than dropped', async () => {
  const response = marked();
  response.actions.push({ actionIndex: 0, quote: receipt });
  await rejected(fixture(), response);
});
test('Q NPC index: explicit wrong format, mixed IDs/kind and unknown fields never fall back', async () => {
  const f = fixture();
  for (const reply of [
    { ...marked(), actionFormat: sentinel },
    {
      ...marked(),
      actions: [{ ...marked().actions[0], kind: 'receive_r17', matterId: f.f.trigger.id }],
    },
    { ...marked(), [sentinel]: sentinel },
    { text: receipt, actions: marked().actions },
  ])
    await rejected(f, reply);
});
test('Q NPC index: classic valid action stays compatible but bad kind and foreign matter are not repaired', async () => {
  const f = fixture();
  const classic = {
    text: receipt,
    actions: [{ matterId: f.f.trigger.id, kind: 'receive_r17', quote: receipt }],
  };
  assert.equal((await run(f, classic)).proposal.npcActions![0]!.actorId, f.f.actorId);
  await rejected(f, { ...classic, actions: [{ ...classic.actions[0], kind: sentinel }] });
  await rejected(f, { ...classic, actions: [{ ...classic.actions[0], matterId: f.f.pursuit.id }] });
});
test('Q NPC index: no-slot explanation cannot manufacture receiving in either wire', async () => {
  const f = fixture('explain');
  await rejected(f, marked());
  await rejected(f, {
    text: receipt,
    actions: [{ matterId: f.f.trigger.id, kind: 'receive_r17', quote: receipt }],
  });
});
for (const [label, text, quote] of [
  ['mismatched quote', '好的。', sentinel],
  ['future promise', '我会接过R17钥匙和维修单。', '接过R17钥匙和维修单'],
  ['denial', '我没有接过R17钥匙和维修单。', '接过R17钥匙和维修单'],
] as const) {
  test(`Q NPC index: slot existence cannot authorize ${label}`, async () => {
    await rejected(fixture(), marked(text, 0, quote));
  });
}
test('Q NPC index: wrong object cannot gain receiving credit even with a valid slot and owned quote', async () => {
  const f = fixture(),
    before = structuredClone(f.c.world);
  let candidate: Awaited<ReturnType<typeof run>> | undefined;
  try {
    candidate = await run(f, marked('我接过R18钥匙和维修单。'));
  } catch (error) {
    assert.equal((error as { code: string }).code, 'INVALID_PROPOSAL');
  }
  if (candidate) assert.throws(() => resolve(f, candidate!.proposal), { code: 'INVALID_PROPOSAL' });
  assert.deepEqual(f.c.world, before);
});
for (const blocked of ['input', 'action', 'matter'] as const) {
  test(`Q NPC index: blocked current ${blocked} grants no slots`, async () => {
    const f = fixture();
    f.c.blockedSourcesByActor = {
      [f.f.actorId]: [
        blocked === 'input'
          ? f.c.action!.sourceEventId
          : blocked === 'action'
            ? f.c.action!.id
            : f.f.trigger.id,
      ],
    };
    assert.deepEqual((await run(f)).payloads[0]!.allowedActions, []);
    await rejected(f, marked());
  });
}
test('Q NPC index: witnessed saved handover permits independent receiving without repeating the player step', async () => {
  const f = fixture('explain'),
    saved = structuredClone(savedHandover(f));
  const r = await run(f, (payload: Payload) =>
    marked(receipt, payload.allowedActions.find((s) => s.kind === 'receive_r17')!.actionIndex),
  );
  const { delta } = resolve(f, r.proposal);
  const steps = delta.matters.find((m) => m.id === f.f.trigger.id)!.stepProgress!.steps;
  assert.deepEqual(
    steps.find((s) => s.stepId === 'handed_over'),
    saved,
  );
  assert.equal(steps.find((s) => s.stepId === 'received')!.actorId, f.f.actorId);
});
for (const blocked of ['input', 'result', 'unwitnessed'] as const) {
  test(`Q NPC index: ${blocked} past handover grants no receiving slot`, async () => {
    const f = fixture('explain'),
      past = savedHandover(f);
    if (blocked === 'unwitnessed') past.witnessActorIds = [];
    else
      f.c.blockedSourcesByActor = {
        [f.f.actorId]: [blocked === 'input' ? past.inputEventId : past.eventId],
      };
    assert.deepEqual((await run(f)).payloads[0]!.allowedActions, []);
    await rejected(f, marked());
  });
}
test('Q NPC index: another present receiver cannot reuse the designated actor slot', async () => {
  const f = fixture(),
    other = f.c.world.actors.find((a) => a.id !== f.f.actorId)!;
  f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!.relatedActorIds!.push(other.id);
  f.c.scene.presence.push({
    participant: { kind: 'actor', actorId: other.id },
    joinedVersion: 0,
    sourceVersion: 0,
    sourceEventId: 'audit:other-arrival',
  });
  f.director.presentActorIds.push(other.id);
  const ownerName = f.c.world.actors.find((a) => a.id === f.f.actorId)!.name;
  const r = await run(f, (payload: Payload) =>
    payload.actor.name === ownerName ? marked() : passive,
  );
  assert.equal(r.calls, 3);
  assert.equal(r.proposal.npcActions!.length, 1);
  assert.deepEqual(r.payloads.find((p) => p.actor.name === other.name)!.allowedActions, []);
  await rejected(f, () => marked());
});
