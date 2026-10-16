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

function fixture(stepId = 'repair_explained') {
  const f = progressionFixture('county-yellow-hair');
  const lines: Record<string, [string, string]> = {
    repair_explained: ['我向老周说明R17电源接头检修。', '你向老周说明R17电源接头检修。'],
    handed_over: ['我将R17钥匙和维修单交给老周。', '你将R17钥匙和维修单交给老周。'],
    order_reviewed: ['我核对R17维修单。', '你核对R17维修单。'],
  };
  const [input, observation] = lines[stepId]!;
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
      intent: 'attempt',
      kind: 'operate',
      text: input,
      relatedMatterIds: [localId],
    },
  };
  const wire = {
    evidenceFormat: 'indexed-observations-v3',
    location: '修车铺',
    narration: '维修单放在柜台。',
    presentActorIds: [f.actorId],
    outcome: 'partial',
    observation: [observation] as string[] | null,
    matterUpdates: [],
    dialogues: [],
    stepProposals: [
      {
        matterIndex: 0,
        stepId,
        inputQuote: input,
        observationIndex: 0,
        ...(stepId === 'order_reviewed' ? {} : { receiverIndex: 0 }),
      } as Record<string, unknown>,
    ],
  };
  return { f, c, wire };
}
async function run(x: ReturnType<typeof fixture>, wire: unknown = x.wire, receipt = false) {
  const calls: { role: string; content: string }[][] = [];
  const proposal = await new ScenePlanner({
    async complete(messages) {
      calls.push(messages);
      if (calls.length === 1) return JSON.stringify(wire);
      const npc = JSON.parse(messages[1]!.content);
      if (receipt && npc.allowedActions.some((a: { kind: string }) => a.kind === 'receive_r17'))
        return JSON.stringify({
          actionFormat: 'indexed-npc-actions-v1',
          text: '我接过R17钥匙和维修单。',
          actions: [
            {
              actionIndex: npc.allowedActions.find(
                (a: { kind: string }) => a.kind === 'receive_r17',
              ).actionIndex,
              quote: '我接过R17钥匙和维修单。',
            },
          ],
        });
      return JSON.stringify({
        actionFormat: 'indexed-npc-actions-v1',
        text: '这次说明我听清了。',
        actions: [],
      });
    },
  }).propose(x.c);
  return {
    proposal,
    calls,
    payload: JSON.parse(calls[0]![1]!.content.split('\nCURRENT TASK:')[0]!),
  };
}
function progress(x: ReturnType<typeof fixture>, p: SceneProposal) {
  const event = { id: randomUUID(), version: x.c.world.version + 1, at: x.c.world.time };
  return resolveSceneStepProgress({
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
    stepProposals: p.stepProposals!,
    npcActions: p.npcActions!,
    dialogues: p.dialogues,
    event,
  });
}
test('marked v3 binds explicit receiver index to this matter actual present actor without rewriting either quote', async () => {
  const x = fixture(),
    r = await run(x),
    step = r.proposal.stepProposals![0]!;
  assert.equal(step.receiverId, x.f.actorId);
  assert.equal(step.matterId, x.f.trigger.id);
  assert.equal(step.inputQuote, x.c.action!.text);
  assert.equal(step.observationQuote, x.wire.observation![0]);
  assert.ok(!('receiverIndex' in step));
  assert.ok(!('matterIndex' in step));
  assert.ok(!('observationIndex' in step));
  assert.deepEqual(r.payload.structuredStepContexts[0].allowedReceivers, [
    { id: x.f.actorId, name: '老周', receiverIndex: 0 },
  ]);
  assert.equal(r.calls.length, 2);
  assert.deepEqual(r.proposal.npcActions, []);
  assert.deepEqual(progress(x, r.proposal).completedMatterIds, []);
  assert.equal(
    progress(x, r.proposal).matters.find((m) => m.id === x.f.trigger.id)!.stepProgress!.steps[0]!
      .stepId,
    'repair_explained',
  );
});
test('v3 ordinary review omits receiver index and does not manufacture a receiver action', async () => {
  const x = fixture('order_reviewed'),
    r = await run(x);
  assert.equal(r.proposal.stepProposals![0]!.receiverId, undefined);
  assert.deepEqual(r.proposal.npcActions, []);
  progress(x, r.proposal);
});
for (const bad of [undefined, null, '0', -1, 0.5, 8, 1])
  test(`v3 rejects missing invalid or nonexistent explicit receiver index ${String(bad)} before calling actor`, async () => {
    const x = fixture();
    x.wire.stepProposals[0]!.receiverIndex = bad;
    let calls = 0;
    await assert.rejects(
      new ScenePlanner({
        async complete() {
          calls++;
          return JSON.stringify(x.wire);
        },
      }).propose(x.c),
      (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.equal(e.message, 'scene_step_evidence:receiver_index');
        assert.ok(!e.message.includes(x.f.actorId));
        return true;
      },
    );
    assert.equal(calls, 1);
  });
for (const field of ['receiverId', 'matterId', 'observationQuote', 'actorId'])
  test(`v3 refuses mixed legacy ${field} without echoing secret values`, async () => {
    const x = fixture();
    x.wire.stepProposals[0]![field] = 'PRIVATE_SENTINEL_RAW';
    await assert.rejects(run(x), (e: unknown) => {
      assert.ok(e instanceof Error);
      assert.ok(!e.message.includes('PRIVATE_SENTINEL_RAW'));
      return true;
    });
  });
test('nonreceiver player step must omit receiverIndex even if only one receiver is available', async () => {
  const x = fixture('order_reviewed');
  x.wire.stepProposals[0]!.receiverIndex = 0;
  await assert.rejects(run(x), { code: 'INVALID_PROPOSAL' });
});
for (const gate of [
  'not-present',
  'not-related',
  'input-not-named',
  'observation-not-named',
] as const)
  test(`v3 cannot bypass actual receiver gate ${gate}`, async () => {
    const x = fixture();
    if (gate === 'not-present') {
      x.c.scene.presence = x.c.scene.presence.filter((p) => p.participant.kind === 'player');
      x.wire.presentActorIds = [];
    }
    if (gate === 'not-related')
      x.c.world.matters!.find((m) => m.id === x.f.trigger.id)!.relatedActorIds = [];
    if (gate === 'input-not-named') {
      x.c.action!.text = '我说明R17电源接头检修。';
      x.wire.stepProposals[0]!.inputQuote = x.c.action!.text;
    }
    if (gate === 'observation-not-named') x.wire.observation = ['你说明R17电源接头检修。'];
    await assert.rejects(run(x), { code: 'INVALID_PROPOSAL' });
  });
test('two allowed people still require explicit selection matching actual named input and observation', async () => {
  const x = fixture(),
    other = x.c.world.actors.find((a) => a.id !== x.f.actorId)!;
  x.c.world.matters!.find((m) => m.id === x.f.trigger.id)!.relatedActorIds!.push(other.id);
  x.f.initial.matters!.find((m) => m.id === x.f.trigger.id)!.relatedActorIds!.push(other.id);
  x.c.scene.presence.push({
    participant: { kind: 'actor', actorId: other.id },
    joinedVersion: 0,
    sourceVersion: 0,
    sourceEventId: 'opening',
  });
  x.wire.presentActorIds.push(other.id);
  const ids = x.c.world.actors
    .filter((a) => [x.f.actorId, other.id].includes(a.id))
    .map((a) => a.id);
  const correct = ids.indexOf(x.f.actorId);
  x.wire.stepProposals[0]!.receiverIndex = correct;
  assert.equal((await run(x)).proposal.stepProposals![0]!.receiverId, x.f.actorId);
  x.wire.stepProposals[0]!.receiverIndex = ids.indexOf(other.id);
  await assert.rejects(run(x), { code: 'INVALID_PROPOSAL' });
});
for (const patch of [
  { matterIndex: 1 },
  { observationIndex: 1 },
  { stepId: 'received' },
  { stepId: 'PRIVATE_UNKNOWN_STEP' },
])
  test(`receiver mapping does not repair unrelated bad matter/observation/step ${JSON.stringify(patch)}`, async () => {
    const x = fixture();
    Object.assign(x.wire.stepProposals[0]!, patch);
    await assert.rejects(run(x), { code: 'INVALID_PROPOSAL' });
  });
for (const prefix of [
  '我明天向老周说明R17电源接头检修。',
  '我没有向老周说明R17电源接头检修。',
  '我说“向老周说明R17电源接头检修”。',
])
  test(`actual source remains mandatory despite a valid receiver: ${prefix}`, async () => {
    const x = fixture();
    x.c.action!.text = prefix;
    x.wire.stepProposals[0]!.inputQuote = prefix;
    try {
      const r = await run(x);
      assert.throws(() => progress(x, r.proposal), { code: 'INVALID_PROPOSAL' });
    } catch (e) {
      assert.equal((e as { code: string }).code, 'INVALID_PROPOSAL');
    }
  });
test('only exact v3 marker accepts receiverIndex, with no unknown-format or unmarked fallback', async () => {
  for (const format of [undefined, 'indexed-observations-v2', 'indexed-observations-v99']) {
    const x = fixture();
    const wire = { ...x.wire, evidenceFormat: format };
    await assert.rejects(run(x, wire), { code: 'INVALID_PROPOSAL' });
  }
});
test('classic and indexed v1/v2 keep canonical explicit IDs readable, bad IDs and missing IDs are never autofilled', async () => {
  for (const format of ['classic', 'indexed-observations-v1', 'indexed-observations-v2']) {
    const x = fixture();
    const step = {
      stepId: 'repair_explained',
      inputQuote: x.c.action!.text,
      receiverId: x.f.actorId,
      ...(format === 'indexed-observations-v2' ? { matterIndex: 0 } : { matterId: x.f.trigger.id }),
      ...(format === 'classic'
        ? { observationQuote: x.wire.observation![0] }
        : { observationIndex: 0 }),
    };
    const { evidenceFormat: _, ...base } = x.wire;
    const wire = {
      ...base,
      ...(format === 'classic' ? {} : { evidenceFormat: format }),
      observation: format === 'classic' ? x.wire.observation![0] : x.wire.observation,
      stepProposals: [step],
    };
    const valid = await run(x, wire);
    assert.equal(valid.proposal.stepProposals![0]!.receiverId, x.f.actorId);
    progress(x, valid.proposal);
    await assert.rejects(
      run(x, { ...wire, stepProposals: [{ ...step, receiverId: 'WRONG_PRIVATE_ID' }] }),
      { code: 'INVALID_PROPOSAL' },
    );
    const { receiverId: _receiver, ...missing } = step;
    const absent = await run(x, { ...wire, stepProposals: [missing] });
    assert.equal(absent.proposal.stepProposals![0]!.receiverId, undefined);
    assert.throws(() => progress(x, absent.proposal), { code: 'INVALID_PROPOSAL' });
  }
});
test('real handover index supports only this actor independent actual receiving, not receipt by the director', async () => {
  const x = fixture('handed_over'),
    r = await run(x, x.wire, true),
    p = progress(x, r.proposal);
  assert.equal(r.proposal.npcActions![0]!.actorId, x.f.actorId);
  assert.equal(r.proposal.npcActions![0]!.kind, 'receive_r17');
  assert.deepEqual(
    p.matters.find((m) => m.id === x.f.trigger.id)!.stepProgress!.steps.map((s) => s.stepId),
    ['handed_over', 'received'],
  );
  assert.deepEqual(p.completedMatterIds, []); // Earlier required steps cannot be invented.
  await assert.rejects(run(x, { ...x.wire, npcActions: r.proposal.npcActions }), {
    code: 'INVALID_PROPOSAL',
  });
});
test('already saved review remains saved while v3 explanation adds only its actual new step', async () => {
  const x = fixture(),
    review = fixture('order_reviewed');
  const scoped = {
    ...review.c.action!,
    worldId: x.c.world.id,
    ownerId: x.c.world.ownerId,
    sceneId: x.c.scene.id,
    relatedMatterIds: x.c.action!.relatedMatterIds,
  };
  const event = { id: randomUUID(), version: x.c.world.version + 1, at: x.c.world.time };
  const prior = resolveSceneStepProgress({
    world: x.c.world,
    initial: x.f.initial,
    scene: x.c.scene,
    action: {
      ...scoped,
      status: 'resolved',
      resolution: {
        sourceEventId: event.id,
        sourceVersion: event.version,
        outcome: 'partial',
        observation: review.wire.observation![0]!,
      },
    },
    stepProposals: [
      {
        matterId: x.f.trigger.id,
        stepId: 'order_reviewed',
        inputQuote: scoped.text,
        observationQuote: review.wire.observation![0]!,
      },
    ],
    npcActions: [],
    dialogues: [],
    event,
  });
  x.c.world = { ...x.c.world, matters: prior.matters, version: event.version };
  x.c.action!.sourceVersion = event.version;
  const saved = structuredClone(
    prior.matters.find((m) => m.id === x.f.trigger.id)!.stepProgress!.steps[0]!,
  );
  const r = await run(x),
    next = progress(x, r.proposal);
  const steps = next.matters.find((m) => m.id === x.f.trigger.id)!.stepProgress!.steps;
  assert.deepEqual(steps[0], saved);
  assert.deepEqual(
    steps.map((s) => s.stepId),
    ['order_reviewed', 'repair_explained'],
  );
  assert.deepEqual(next.completedMatterIds, []);
  assert.ok(
    JSON.stringify(r.payload.structuredStepContexts[0].completedSteps).includes(saved.eventId),
  );
});
test('director prompt requests the single v3 receiver-index format without copied receiverId examples or defaulting a lone candidate', async () => {
  const x = fixture(),
    r = await run(x),
    prompt = r.calls[0]![0]!.content + r.payload.executionInstructions;
  assert.ok(prompt.includes('indexed-observations-v3'));
  assert.ok(prompt.includes('receiverIndex'));
  assert.ok(!prompt.includes('receiverId?:'));
  assert.ok(!prompt.includes('receiverId":"allowedReceivers'));
  assert.ok(prompt.includes('inputQuote'));
  assert.ok(prompt.includes('observationIndex'));
});

test('receiver index is local to selected matter, never a global actor slot borrowed from another context', async () => {
  const x = fixture(),
    other = x.c.world.actors.find((a) => a.id !== x.f.actorId)!;
  const second = {
    ...structuredClone(x.f.trigger),
    id: randomUUID(),
    title: '同地点另一个受控事项',
    relatedActorIds: [other.id],
  };
  x.c.world.matters!.push(second);
  x.f.initial.matters!.push(structuredClone(second));
  const local = sceneMatterId(x.c.scene.id, second.id);
  x.c.matters.push({ ...x.c.matters[0]!, id: local, title: second.title });
  x.c.action!.relatedMatterIds.push(local);
  x.c.scene.presence.push({
    participant: { kind: 'actor', actorId: other.id },
    joinedVersion: 0,
    sourceVersion: 0,
    sourceEventId: 'opening',
  });
  x.wire.presentActorIds.push(other.id);
  x.wire.stepProposals[0]!.matterIndex = 1;
  await assert.rejects(run(x), { code: 'INVALID_PROPOSAL' }); // Local index0 is other, not Lao Zhou from context0.
  x.c.action!.text = x.c.action!.text.replaceAll('老周', other.name);
  x.wire.stepProposals[0]!.inputQuote = x.c.action!.text;
  x.wire.observation = x.wire.observation!.map((o) => o.replaceAll('老周', other.name));
  const r = await run(x);
  assert.equal(r.proposal.stepProposals![0]!.receiverId, other.id);
  assert.equal(r.proposal.stepProposals![0]!.matterId, second.id);
  assert.equal(r.payload.structuredStepContexts[0].allowedReceivers[0].id, x.f.actorId);
  assert.equal(r.payload.structuredStepContexts[1].allowedReceivers[0].id, other.id);
});
