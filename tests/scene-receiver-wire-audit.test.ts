import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ScenePlanner } from '../src/modules/world/infrastructure/scene-planner.ts';
import { sceneMatterId } from '../src/modules/world/domain/scene-matter-policy.ts';
import {
  resolveSceneStepProgress,
  completeSceneSteps,
} from '../src/modules/world/domain/scene-step-progress.ts';
import { progressionFixture } from './fixtures/matter-progression.ts';
import type {
  ScenePlanningContext,
  SceneProposal,
} from '../src/modules/world/application/scene-ports.ts';

// Independent synthetic adapter + domain audit. No supplier, Repository, API or database.
const sentinel = 'q04-private-原文-姓名-金额';
type Step = Record<string, unknown>;
type Payload = {
  structuredStepContexts?: {
    matterId: string;
    matterIndex: number;
    allowedReceivers: { id: string; name: string; receiverIndex: number }[];
  }[];
  allowedActions?: { actionIndex: number; matterId: string; kind: string }[];
  stepExecution?: {
    savedCompletedSteps: { stepId: string }[];
    currentTurnStepCandidates: { stepId: string }[];
  }[];
};
const texts = {
  repair_explained: ['我向老周说明R17接头检修细节。', '你向老周说明R17接头检修细节。'],
  handed_over: ['我将R17钥匙和维修单交给老周。', '你将R17钥匙和维修单交给老周。'],
  order_reviewed: ['我核对R17维修单。', '你核对R17维修单。'],
} as const;
function fixture(stepId: keyof typeof texts = 'repair_explained') {
  const f = progressionFixture('county-yellow-hair');
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
      text: texts[stepId][0],
    },
  };
  const wire = {
    evidenceFormat: 'indexed-observations-v3',
    location: '修车铺',
    narration: '维修单放在柜台上。',
    presentActorIds: [f.actorId],
    outcome: 'partial',
    observation: [texts[stepId][1]] as string[],
    matterTitle: null,
    initialMatters: [],
    matterUpdates: [],
    dialogues: [],
    stepProposals: [
      {
        matterIndex: 0,
        stepId,
        inputQuote: texts[stepId][0],
        observationIndex: 0,
        ...(stepId === 'order_reviewed' ? {} : { receiverIndex: 0 }),
      } as Step,
    ],
  };
  return { f, c, wire };
}
type Fixture = ReturnType<typeof fixture>;
async function run(x: Fixture, wire: unknown = x.wire, npc?: (payload: Payload) => unknown) {
  const payloads: Payload[] = [];
  const proposal = await new ScenePlanner({
    async complete(messages) {
      const payload: Payload = JSON.parse(messages[1]!.content.split('\nCURRENT TASK:')[0]!);
      payloads.push(payload);
      if (payloads.length === 1) return JSON.stringify(wire);
      return JSON.stringify(
        npc?.(payload) ?? {
          actionFormat: 'indexed-npc-actions-v1',
          text: '这次说明我听清了。',
          actions: [],
        },
      );
    },
  }).propose(x.c);
  return { proposal, payloads };
}
function resolve(x: Fixture, p: SceneProposal) {
  const event = { id: randomUUID(), version: x.c.world.version + 1, at: x.c.world.time };
  return {
    event,
    delta: resolveSceneStepProgress({
      world: x.c.world,
      initial: x.f.initial,
      scene: x.c.scene,
      action: {
        ...x.c.action!,
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
async function rejectWire(x: Fixture, wire: unknown = x.wire, reason?: string) {
  const before = structuredClone(x.c);
  await assert.rejects(run(x, wire), (error: unknown) => {
    assert.ok(error instanceof Error);
    const e = error as Error & { code: string; stage: string; diagnosticMessage: string };
    assert.equal(e.code, 'INVALID_PROPOSAL');
    assert.equal(e.stage, 'proposal');
    assert.ok(e.diagnosticMessage.length <= 500);
    if (reason) assert.equal(e.diagnosticMessage, 'scene_step_evidence:' + reason);
    for (const value of [
      sentinel,
      x.c.world.id,
      x.c.world.ownerId,
      ...x.c.world.actors.map((a) => a.id),
      ...x.c.world.actors.map((a) => a.name),
      x.c.action!.text,
    ])
      assert.ok(![e.message, e.stack, JSON.stringify(e)].join('\n').includes(value));
    return true;
  });
  assert.deepEqual(x.c, before);
}

test('Q04 explicit zero binds world matter and actual receiver without repairing quotes or whole credit', async () => {
  const x = fixture(),
    before = structuredClone(x.c);
  const { proposal, payloads } = await run(x);
  const context = payloads[0]!.structuredStepContexts![0]!;
  assert.equal(context.allowedReceivers[0]!.receiverIndex, 0);
  assert.equal(context.allowedReceivers[0]!.id, x.f.actorId);
  assert.equal(proposal.stepProposals![0]!.matterId, x.f.trigger.id);
  assert.equal(proposal.stepProposals![0]!.receiverId, x.f.actorId);
  assert.equal(proposal.stepProposals![0]!.inputQuote, x.c.action!.text);
  assert.equal(proposal.stepProposals![0]!.observationQuote, x.wire.observation[0]);
  assert.ok(!('receiverIndex' in proposal.stepProposals![0]!));
  const { delta, event } = resolve(x, proposal);
  const credit = delta.matters.find((m) => m.id === x.f.trigger.id)!.stepProgress!.steps;
  assert.deepEqual(
    credit.map((s) => s.stepId),
    ['repair_explained'],
  );
  assert.equal(credit[0]!.performer, 'player');
  assert.equal(credit[0]!.receiverId, x.f.actorId);
  assert.equal(credit[0]!.inputEventId, x.c.action!.sourceEventId);
  assert.equal(credit[0]!.eventId, event.id);
  assert.deepEqual(delta.completedMatterIds, []);
  assert.deepEqual(x.c, before);
});
for (const [label, value] of [
  ['missing', undefined],
  ['null', null],
  ['string', '0'],
  ['negative', -1],
  ['fraction', 0.5],
  ['out of maximum', 8],
  ['out of actual list', 1],
] as const) {
  test(`Q04 receiver index ${label} rejects without selecting the only person`, async () => {
    const x = fixture();
    if (value === undefined) delete x.wire.stepProposals[0]!.receiverIndex;
    else x.wire.stepProposals[0]!.receiverIndex = value;
    await rejectWire(x, x.wire, 'receiver_index');
  });
}
test('Q04 no present receivers gives no default slot', async () => {
  const x = fixture();
  x.c.scene.presence = x.c.scene.presence.filter((p) => p.participant.kind === 'player');
  x.wire.presentActorIds = [];
  await rejectWire(x, x.wire, 'receiver_index');
});
test('Q04 unrelated present person is not a receiver', async () => {
  const x = fixture(),
    other = x.c.world.actors.find((a) => a.id !== x.f.actorId)!;
  x.c.scene.presence = x.c.scene.presence.map((p) =>
    p.participant.kind === 'actor'
      ? { ...p, participant: { kind: 'actor' as const, actorId: other.id } }
      : p,
  );
  x.wire.presentActorIds = [other.id];
  x.c.action!.text = `我向${other.name}说明R17接头检修细节。`;
  x.wire.stepProposals[0]!.inputQuote = x.c.action!.text;
  x.wire.observation = [`你向${other.name}说明R17接头检修细节。`];
  await rejectWire(x, x.wire, 'receiver_index');
});
for (const field of ['receiverId', 'matterId', 'observationQuote', 'actorId', sentinel]) {
  test(`Q04 marked new wire rejects mixed or unknown ${field === sentinel ? 'field' : field}`, async () => {
    const x = fixture();
    x.wire.stepProposals[0]![field] = sentinel;
    await rejectWire(x);
  });
}
for (const marker of [
  'unmarked',
  'indexed-observations-v1',
  'indexed-observations-v2',
  'indexed-observations-v4',
]) {
  test(`Q04 receiver index cannot silently fall back via ${marker}`, async () => {
    const x = fixture();
    const wire: Record<string, unknown> = structuredClone(x.wire);
    if (marker === 'unmarked') delete wire.evidenceFormat;
    else wire.evidenceFormat = marker;
    await rejectWire(x, wire);
  });
}
test('Q04 review omits receiver slot; adding one does not grant receiver credit', async () => {
  const x = fixture('order_reviewed');
  const { proposal } = await run(x);
  assert.equal(proposal.stepProposals![0]!.receiverId, undefined);
  assert.deepEqual(
    resolve(x, proposal)
      .delta.matters.find((m) => m.id === x.f.trigger.id)!
      .stepProgress!.steps.map((s) => s.stepId),
    ['order_reviewed'],
  );
  x.wire.stepProposals[0]!.receiverIndex = 0;
  await rejectWire(x, x.wire, 'receiver_index');
});
for (const [label, input, observation, reason] of [
  [
    'missing input name',
    '我说明R17接头检修细节。',
    texts.repair_explained[1],
    'receiver_input_named',
  ],
  [
    'input name clipped from original',
    '说明R17接头检修细节。',
    texts.repair_explained[1],
    'receiver_input_named',
  ],
  [
    'missing observation name',
    texts.repair_explained[0],
    '你说明R17接头检修细节。',
    'receiver_observation_named',
  ],
  [
    'different observation person',
    texts.repair_explained[0],
    '你向刘航说明R17接头检修细节。',
    'receiver_observation_named',
  ],
] as const) {
  test(`Q04 ${label} is not repaired by a valid receiver index`, async () => {
    const x = fixture();
    if (label !== 'input name clipped from original') x.c.action!.text = input;
    x.wire.stepProposals[0]!.inputQuote = input;
    x.wire.observation = [observation];
    await rejectWire(x, x.wire, reason);
  });
}
for (const [label, text] of [
  ['future', '明天我向老周说明R17接头检修细节。'],
  ['denied', '我没有向老周说明R17接头检修细节。'],
  ['quoted', '我重复“我向老周说明R17接头检修细节”。'],
  ['wrong object', '我向老周说明R18接头检修细节。'],
  ['past', '昨天我向老周说明R17接头检修细节。'],
] as const) {
  test(`Q04 valid indices cannot turn ${label} into execution`, async () => {
    const x = fixture();
    x.c.action!.text = text;
    x.wire.stepProposals[0]!.inputQuote = text;
    let proposal: SceneProposal;
    try {
      proposal = (await run(x)).proposal;
    } catch (error) {
      assert.equal((error as { code: string }).code, 'INVALID_PROPOSAL');
      return;
    }
    const before = structuredClone(x.c.world);
    assert.throws(() => resolve(x, proposal), { code: 'INVALID_PROPOSAL' });
    assert.deepEqual(x.c.world, before);
  });
}
function classic(x: Fixture, format: 'classic' | 'v1' | 'v2', receiver: string | undefined) {
  const {
    receiverIndex: _index,
    matterIndex: _matter,
    observationIndex: _observation,
    ...step
  } = x.wire.stepProposals[0]!;
  const base = { ...x.wire } as Record<string, unknown>;
  if (format === 'classic') {
    delete base.evidenceFormat;
    base.observation = x.wire.observation[0];
  } else
    base.evidenceFormat = format === 'v1' ? 'indexed-observations-v1' : 'indexed-observations-v2';
  base.stepProposals = [
    {
      ...step,
      ...(format === 'v2' ? { matterIndex: 0 } : { matterId: x.f.trigger.id }),
      ...(format === 'classic'
        ? { observationQuote: x.wire.observation[0] }
        : { observationIndex: 0 }),
      ...(receiver ? { receiverId: receiver } : {}),
    },
  ];
  return base;
}
for (const format of ['classic', 'v1', 'v2'] as const) {
  test(`Q04 ${format} valid ID stays valid and wrong/missing ID is never repaired`, async () => {
    const x = fixture();
    const good = await run(x, classic(x, format, x.f.actorId));
    assert.equal(good.proposal.stepProposals![0]!.receiverId, x.f.actorId);
    await rejectWire(x, classic(x, format, randomUUID()), 'receiver');
    const absent = (await run(x, classic(x, format, undefined))).proposal;
    assert.equal(absent.stepProposals![0]!.receiverId, undefined);
    assert.throws(() => resolve(x, absent), /receiver_condition:not_found/);
  });
}
function nextTurn(x: Fixture, stepId: keyof typeof texts) {
  const [input, observation] = texts[stepId];
  x.c.action = {
    ...x.c.action!,
    id: randomUUID(),
    commandId: randomUUID(),
    sourceEventId: randomUUID(),
    sourceVersion: x.c.world.version,
    text: input,
  };
  x.wire.observation = [observation];
  x.wire.stepProposals = [
    {
      matterIndex: 0,
      stepId,
      inputQuote: input,
      observationIndex: 0,
      ...(stepId === 'order_reviewed' ? {} : { receiverIndex: 0 }),
    },
  ];
}
function keep(x: Fixture, result: ReturnType<typeof resolve>) {
  x.c.world = { ...x.c.world, version: result.event.version, matters: result.delta.matters };
}
test('Q04 saved review survives explanation; current candidate is not NPC receiving or whole credit', async () => {
  const x = fixture('order_reviewed');
  const first = resolve(x, (await run(x)).proposal);
  keep(x, first);
  const original = structuredClone(
    x.c.world.matters!.find((m) => m.id === x.f.trigger.id)!.stepProgress!.steps[0],
  );
  nextTurn(x, 'repair_explained');
  const { proposal, payloads } = await run(x);
  assert.deepEqual(
    payloads[1]!.stepExecution![0]!.savedCompletedSteps.map((s) => s.stepId),
    ['order_reviewed'],
  );
  assert.deepEqual(
    payloads[1]!.stepExecution![0]!.currentTurnStepCandidates.map((s) => s.stepId),
    ['repair_explained'],
  );
  assert.deepEqual(payloads[1]!.allowedActions, []);
  assert.deepEqual(proposal.npcActions, []);
  const result = resolve(x, proposal),
    matter = result.delta.matters.find((m) => m.id === x.f.trigger.id)!;
  assert.deepEqual(matter.stepProgress!.steps[0], original);
  assert.deepEqual(
    matter.stepProgress!.steps.map((s) => s.stepId),
    ['order_reviewed', 'repair_explained'],
  );
  assert.equal(completeSceneSteps(matter), false);
  assert.deepEqual(result.delta.completedMatterIds, []);
});
test('Q04 explicit handover does not count as receipt; separate actual owned NPC action completes only its step', async () => {
  const x = fixture('handed_over');
  const noReceipt = await run(x),
    notReceived = resolve(x, noReceipt.proposal);
  assert.deepEqual(
    notReceived.delta.matters
      .find((m) => m.id === x.f.trigger.id)!
      .stepProgress!.steps.map((s) => s.stepId),
    ['handed_over'],
  );
  const { proposal, payloads } = await run(x, x.wire, (p) => {
    const slot = p.allowedActions!.find((s) => s.kind === 'receive_r17')!;
    return {
      actionFormat: 'indexed-npc-actions-v1',
      text: '我接过R17钥匙和维修单。',
      actions: [{ actionIndex: slot.actionIndex, quote: '我接过R17钥匙和维修单。' }],
    };
  });
  assert.ok(payloads[1]!.allowedActions!.some((s) => s.kind === 'receive_r17'));
  const result = resolve(x, proposal),
    matter = result.delta.matters.find((m) => m.id === x.f.trigger.id)!;
  assert.deepEqual(
    matter.stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'received'],
  );
  assert.equal(matter.stepProgress!.steps[1]!.performer, 'actor');
  assert.equal(matter.stepProgress!.steps[1]!.actorId, x.f.actorId);
  assert.equal(completeSceneSteps(matter), false);
  assert.deepEqual(result.delta.completedMatterIds, []);
});
for (const text of [
  '我以后会接过R17钥匙和维修单。',
  '我没有接过R17钥匙和维修单。',
  '你说“我接过R17钥匙和维修单”。',
]) {
  test(
    'Q04 indexed receiver does not turn unexecuted NPC speech into receipt: ' + text.slice(0, 4),
    async () => {
      const x = fixture('handed_over'),
        before = structuredClone(x.c.world);
      const attempt = run(x, x.wire, (p) => ({
        actionFormat: 'indexed-npc-actions-v1',
        text,
        actions: [
          {
            actionIndex: p.allowedActions!.find((s) => s.kind === 'receive_r17')!.actionIndex,
            quote: '我接过R17钥匙和维修单',
          },
        ],
      }));
      let proposal: SceneProposal;
      try {
        proposal = (await attempt).proposal;
      } catch (error) {
        assert.equal((error as { code: string }).code, 'INVALID_PROPOSAL');
        assert.deepEqual(x.c.world, before);
        return;
      }
      // The adapter proposes; the unchanged runtime must reject quoted speech before credit.
      assert.throws(() => resolve(x, proposal), { code: 'INVALID_PROPOSAL' });
      assert.deepEqual(x.c.world, before);
    },
  );
}
test('Q04 original domain source/owner rejects even a correctly mapped receiver', async () => {
  const x = fixture(),
    { proposal } = await run(x),
    before = structuredClone(x.c.world);
  x.c.action!.ownerId = randomUUID();
  assert.throws(() => resolve(x, proposal), /Wrong execution source\/scope/);
  assert.deepEqual(x.c.world, before);
});

function addOtherPresent(x: Fixture, related = false) {
  const actor = x.c.world.actors.find((a) => a.id !== x.f.actorId)!;
  const existing = x.c.scene.presence.find((p) => p.participant.kind === 'actor')!;
  x.c.scene.presence.push({ ...existing, participant: { kind: 'actor', actorId: actor.id } });
  x.wire.presentActorIds = x.c.world.actors
    .filter((a) =>
      x.c.scene.presence.some(
        (p) => p.participant.kind === 'actor' && p.participant.actorId === a.id,
      ),
    )
    .map((a) => a.id);
  if (related) {
    x.c.world.matters!.find((m) => m.id === x.f.trigger.id)!.relatedActorIds!.push(actor.id);
    x.f.initial.matters!.find((m) => m.id === x.f.trigger.id)!.relatedActorIds!.push(actor.id);
  }
  return actor;
}
test('Q04 two present authorized receivers use explicit index 1 without name guessing', async () => {
  const x = fixture(),
    added = addOtherPresent(x, true);
  const other = x.c.world.actors.filter((a) => [x.f.actorId, added.id].includes(a.id))[1]!;
  x.c.action!.text = `我向${other.name}说明R17接头检修细节。`;
  x.wire.stepProposals[0]!.inputQuote = x.c.action!.text;
  x.wire.stepProposals[0]!.receiverIndex = 1;
  x.wire.observation = [`你向${other.name}说明R17接头检修细节。`];
  const { proposal, payloads } = await run(x);
  assert.equal(payloads[0]!.structuredStepContexts![0]!.allowedReceivers.length, 2);
  assert.equal(payloads[0]!.structuredStepContexts![0]!.allowedReceivers[1]!.id, other.id);
  assert.equal(proposal.stepProposals![0]!.receiverId, other.id);
  assert.equal(
    resolve(x, proposal).delta.matters.find((m) => m.id === x.f.trigger.id)!.stepProgress!.steps[0]!
      .receiverId,
    other.id,
  );
});
test('Q04 index zero from another matter is resolved only against the selected matter', async () => {
  const x = fixture(),
    other = addOtherPresent(x);
  const another = {
    ...structuredClone(x.f.trigger),
    id: randomUUID(),
    relatedActorIds: [other.id],
  };
  x.c.world.matters!.push(another);
  x.f.initial.matters!.push(structuredClone(another));
  const local = sceneMatterId(x.c.scene.id, another.id);
  x.c.matters.push({ ...x.c.matters[0]!, id: local });
  x.c.action!.relatedMatterIds.push(local);
  x.wire.stepProposals[0]!.matterIndex = 1;
  // Both contexts have slot 0; quoted Lao Zhou cannot be rebound to the other context's person.
  await rejectWire(x, x.wire, 'receiver_input_named');
  x.c.action!.text = `我向${other.name}说明R17接头检修细节。`;
  x.wire.stepProposals[0]!.inputQuote = x.c.action!.text;
  x.wire.observation = [`你向${other.name}说明R17接头检修细节。`];
  const { proposal, payloads } = await run(x);
  assert.equal(payloads[0]!.structuredStepContexts![1]!.allowedReceivers[0]!.id, other.id);
  assert.equal(proposal.stepProposals![0]!.matterId, another.id);
  assert.equal(proposal.stepProposals![0]!.receiverId, other.id);
  x.wire.stepProposals[0]!.matterIndex = 0;
  x.wire.stepProposals[0]!.receiverIndex = 1;
  await rejectWire(x, x.wire, 'receiver_index');
});
test('Q04 wrong recipient chosen among two permitted people still needs that exact name in both quotes', async () => {
  const x = fixture();
  const other = addOtherPresent(x, true);
  x.wire.stepProposals[0]!.receiverIndex = x.c.world.actors
    .filter((a) => [x.f.actorId, other.id].includes(a.id))
    .findIndex((a) => a.id === other.id);
  await rejectWire(x, x.wire, 'receiver_input_named');
});
test('Q04 all three saved player steps alone do not complete; actual receiving adds the fourth', async () => {
  const x = fixture('order_reviewed');
  keep(x, resolve(x, (await run(x)).proposal));
  nextTurn(x, 'repair_explained');
  keep(x, resolve(x, (await run(x)).proposal));
  const original = structuredClone(
    x.c.world.matters!.find((m) => m.id === x.f.trigger.id)!.stepProgress!.steps,
  );
  nextTurn(x, 'handed_over');
  const partial = resolve(x, (await run(x)).proposal);
  assert.equal(
    completeSceneSteps(partial.delta.matters.find((m) => m.id === x.f.trigger.id)!),
    false,
  );
  assert.deepEqual(partial.delta.completedMatterIds, []);
  const { proposal } = await run(x, x.wire, (p) => ({
    actionFormat: 'indexed-npc-actions-v1',
    text: '我现在接过R17钥匙和维修单。',
    actions: [
      {
        actionIndex: p.allowedActions!.find((s) => s.kind === 'receive_r17')!.actionIndex,
        quote: '我现在接过R17钥匙和维修单。',
      },
    ],
  }));
  const result = resolve(x, proposal),
    matter = result.delta.matters.find((m) => m.id === x.f.trigger.id)!;
  assert.deepEqual(matter.stepProgress!.steps.slice(0, 2), original);
  assert.equal(completeSceneSteps(matter), true);
  assert.deepEqual(result.delta.completedMatterIds, [x.f.trigger.id]);
  assert.equal(matter.stepProgress!.steps.at(-1)!.performer, 'actor');
});
