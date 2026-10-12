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
    actionFormat: 'indexed-npc-actions-v2',
    text: ['这次说明我听清了。'],
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
const segmentsReply = (
  segments: string[] = [received],
  actionIndex: unknown = 0,
  quoteIndex: unknown = 0,
) => ({
  actionFormat: 'indexed-npc-actions-v2',
  text: segments,
  actions: [{ actionIndex, quoteIndex }],
});
function runtime(
  f: ReturnType<typeof fixture>,
  proposal: Awaited<ReturnType<typeof propose>>['proposal'],
) {
  const event = { id: randomUUID(), version: f.c.world.version + 1, at: f.c.world.time };
  return resolveSceneStepProgress({
    world: f.c.world,
    initial: f.f.initial,
    scene: f.c.scene,
    action: {
      ...f.c.action!,
      status: 'resolved',
      resolution: {
        sourceEventId: event.id,
        sourceVersion: event.version,
        outcome: proposal.outcome!,
        observation: proposal.observation!,
      },
    },
    stepProposals: proposal.stepProposals!,
    npcActions: proposal.npcActions!,
    dialogues: proposal.dialogues,
    event,
  });
}
test('marked NPC v2 selects exact complete segment, joins own text once and binds only actor-owned action slot', async () => {
  const f = fixture('handover'),
    segments = ['你交来的东西，我先看清楚。', received, '这次交接我记住了。'];
  const before = structuredClone(segments);
  const r = await propose(f, segmentsReply(segments, 0, 1));
  assert.deepEqual(segments, before);
  assert.equal(r.proposal.dialogues[0]!.text, segments.join('\n'));
  assert.equal(r.proposal.npcActions![0]!.quote, segments[1]);
  assert.equal(r.proposal.npcActions![0]!.actorId, f.f.actorId);
  assert.equal(r.proposal.npcActions![0]!.kind, 'receive_r17');
  assert.equal(r.calls.length, 2);
  assert.deepEqual(
    runtime(f, r.proposal)
      .matters.find((m) => m.id === f.f.trigger.id)!
      .stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'received'],
  );
  assert.ok(!('quoteIndex' in r.proposal.npcActions![0]!));
  assert.ok(!('actionIndex' in r.proposal.npcActions![0]!));
});
test('new segment source preserves spaces and complete clause instead of trimming into a successful first-person action', async () => {
  const f = fixture('handover'),
    segment = '  我接过R17钥匙和维修单。  ',
    r = await propose(f, segmentsReply([segment]));
  assert.equal(r.proposal.dialogues[0]!.text, segment);
  assert.equal(r.proposal.npcActions![0]!.quote, segment);
  assert.throws(() => runtime(f, r.proposal), /receiving_condition:execution_not_explicit/);
});
test('exact inspection segment works only with an actually authorized own inspection slot', async () => {
  const f = fixture('inspect'),
    r = await propose(f, segmentsReply(['我检查了R17接头。']));
  assert.equal(r.proposal.npcActions![0]!.kind, 'inspect_r17');
  runtime(f, r.proposal);
});
test('ordinary explanation keeps no slots and accepts one to eight natural reply segments without crediting an action', async () => {
  for (const segments of [
    ['这次说明我听清了。'],
    Array.from({ length: 8 }, (_, i) => `我听清第${i + 1}项了。`),
  ]) {
    const r = await propose(fixture(), {
      actionFormat: 'indexed-npc-actions-v2',
      text: segments,
      actions: [],
    });
    assert.deepEqual(r.npc.allowedActions, []);
    assert.deepEqual(r.proposal.npcActions, []);
    assert.equal(r.proposal.dialogues[0]!.text, segments.join('\n'));
  }
  await assert.rejects(propose(fixture(), segmentsReply()), { code: 'INVALID_PROPOSAL' });
});
for (const index of [undefined, null, '0', -1, 0.5, 8, 1])
  test(`NPC v2 rejects invalid or nonexistent quote index ${String(index)}`, async () => {
    const reply = segmentsReply([received]);
    reply.actions[0]!.quoteIndex = index;
    await assert.rejects(propose(fixture('handover'), reply), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.equal(e.message, 'scene_npc_action:quote_index');
      assert.ok(!e.message.includes(received));
      return true;
    });
  });
for (const text of [
  null,
  '我接过R17钥匙和维修单。',
  [],
  [''],
  ['   '],
  Array.from({ length: 9 }, () => received),
  ['字'.repeat(1601)],
  ['字'.repeat(800), '字'.repeat(800)],
])
  test(`NPC v2 rejects invalid or oversized segment arrays (${JSON.stringify(text).slice(0, 45)})`, async () => {
    await assert.rejects(propose(fixture('handover'), { ...segmentsReply(), text }), {
      code: 'INVALID_PROPOSAL',
    });
  });
for (const segment of ['我', '我接过' + '钥匙'.repeat(250) + '维修单。'])
  test('NPC v2 selected action segment retains original 3..500 quote bounds', async () => {
    await assert.rejects(propose(fixture('handover'), segmentsReply([segment])), {
      code: 'INVALID_PROPOSAL',
    });
  });
for (const field of ['quote', 'matterId', 'actorId', 'kind'])
  test(`NPC v2 mixed canonical or v1 field ${field} is rejected without leaking raw values`, async () => {
    const r = segmentsReply();
    Object.assign(r.actions[0]!, { [field]: 'PRIVATE_SENTINEL_RAW' });
    await assert.rejects(propose(fixture('handover'), r), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.ok(!e.message.includes('PRIVATE_SENTINEL_RAW'));
      return true;
    });
  });
test('mixed v2 marker string text, unknown marker, unmarked indexed segments and v1 array text never fallback', async () => {
  for (const reply of [
    { ...segmentsReply(), text: received },
    { ...segmentsReply(), actionFormat: 'v99' },
    { text: [received], actions: [{ actionIndex: 0, quoteIndex: 0 }] },
    {
      actionFormat: 'indexed-npc-actions-v1',
      text: [received],
      actions: [{ actionIndex: 0, quote: received }],
    },
  ])
    await assert.rejects(propose(fixture('handover'), reply), { code: 'INVALID_PROPOSAL' });
});
test('v1 and classic canonical text/quotes remain compatible and wrong quotes are never repaired by a v2 segment', async () => {
  const f = fixture('handover');
  for (const reply of [
    {
      actionFormat: 'indexed-npc-actions-v1',
      text: received,
      actions: [{ actionIndex: 0, quote: received }],
    },
    {
      text: received,
      actions: [{ matterId: f.f.trigger.id, kind: 'receive_r17', quote: received }],
    },
  ]) {
    const r = await propose(f, reply);
    assert.equal(r.proposal.npcActions![0]!.quote, received);
    runtime(f, r.proposal);
    await assert.rejects(
      propose(f, {
        ...reply,
        actions: reply.actions.map((a) => ({ ...a, quote: '没有保存的原句' })),
      }),
      { code: 'INVALID_PROPOSAL' },
    );
  }
});
for (const segment of [
  '钥匙和维修单都在这里。',
  '好，我接过R17钥匙和维修单。',
  '我接过R17维修单。',
  '我接过R17钥匙。',
  '老周接过R17钥匙和维修单。',
  '我会接过R17钥匙和维修单。',
  '我没有接过R17钥匙和维修单。',
  '我说“我接过R17钥匙和维修单”。',
  '我接过R18钥匙和维修单。',
])
  test(`complete segment indexing never changes the actual execution boundary: ${segment}`, async () => {
    const f = fixture('handover');
    try {
      const r = await propose(f, segmentsReply([segment]));
      assert.throws(() => runtime(f, r.proposal), { code: 'INVALID_PROPOSAL' });
    } catch (e) {
      assert.equal((e as { code: string }).code, 'INVALID_PROPOSAL');
    }
  });
test('duplicate action slot or unavailable action index remains rejected rather than dropping invalid actions', async () => {
  for (const reply of [
    {
      ...segmentsReply(),
      actions: [
        { actionIndex: 0, quoteIndex: 0 },
        { actionIndex: 0, quoteIndex: 0 },
      ],
    },
    segmentsReply([received], 2),
  ])
    await assert.rejects(propose(fixture('handover'), reply), { code: 'INVALID_PROPOSAL' });
});
test('current received claim still requires an indexed actual action and prior blocked handover grants no slot', async () => {
  await assert.rejects(
    propose(fixture('handover'), {
      actionFormat: 'indexed-npc-actions-v2',
      text: [received],
      actions: [],
    }),
    { code: 'INVALID_PROPOSAL' },
  );
  const f = fixture();
  saveHandover(f);
  const saved = f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress!.steps[0]!;
  f.c.blockedSourcesByActor = { [f.f.actorId]: [saved.inputEventId] };
  await assert.rejects(propose(f, segmentsReply()), { code: 'INVALID_PROPOSAL' });
});
test('first-person identity and director environmental split are short prompt changes, not proof of model naturalness', async () => {
  const f = fixture('handover'),
    r = await propose(f, segmentsReply());
  assert.ok(r.prompt.startsWith('你正在扮演老周。'));
  assert.ok(r.prompt.includes('第一人称'));
  assert.ok(r.prompt.includes('indexed-npc-actions-v2'));
  assert.ok(r.prompt.includes('quoteIndex'));
  assert.ok(!r.prompt.includes('"actionFormat":"indexed-npc-actions-v1"'));
  assert.ok(r.calls[0]![0]!.content.includes('narration只写环境'));
});

test('separate complete receiving and inspection segments can support two own actions, while one combined segment cannot fake both prefixes', async () => {
  const f = fixture('handover'),
    reply = {
      actionFormat: 'indexed-npc-actions-v2',
      text: [received, inspected],
      actions: [
        { actionIndex: 0, quoteIndex: 0 },
        { actionIndex: 1, quoteIndex: 1 },
      ],
    };
  const r = await propose(f, reply);
  assert.deepEqual(
    r.proposal.npcActions!.map((a) => a.quote),
    [received, inspected],
  );
  assert.deepEqual(
    runtime(f, r.proposal)
      .matters.find((m) => m.id === f.f.trigger.id)!
      .stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'received', 'receiver_inspected'],
  );
  const combined = await propose(f, {
    ...reply,
    text: [received + inspected],
    actions: [
      { actionIndex: 0, quoteIndex: 0 },
      { actionIndex: 1, quoteIndex: 0 },
    ],
  });
  assert.equal(combined.proposal.npcActions![1]!.quote, received + inspected);
  assert.throws(() => runtime(f, combined.proposal), /Inspection lacks bounded object\/request/);
});
test('v2 rejects more than four proposed actions without clipping the excess or granting execution', async () => {
  await assert.rejects(
    propose(fixture('handover'), {
      ...segmentsReply(),
      actions: Array.from({ length: 5 }, (_, actionIndex) => ({ actionIndex, quoteIndex: 0 })),
    }),
    { code: 'INVALID_PROPOSAL' },
  );
});
