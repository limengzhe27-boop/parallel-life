import {
  completeSceneSteps,
  resolveSceneStepProgress,
} from '../src/modules/world/domain/scene-step-progress.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ScenePlanner,
  SceneProposalSchema,
} from '../src/modules/world/infrastructure/scene-planner.ts';
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
async function propose(
  f: ReturnType<typeof fixture>,
  reply: unknown = {
    text: '我接过R17钥匙和维修单。',
    actions: [{ matterId: f.f.trigger.id, kind: 'receive_r17', quote: '我接过R17钥匙和维修单。' }],
  },
) {
  const calls: { role: string; content: string }[][] = [];
  const proposal = await new ScenePlanner({
    async complete(messages) {
      calls.push(messages);
      return JSON.stringify(calls.length === 1 ? f.director : reply);
    },
  }).propose(f.c);
  return {
    proposal,
    calls,
    director: JSON.parse(calls[0]![1]!.content.split('\nCURRENT TASK:')[0]!),
    npc: calls[1] ? JSON.parse(calls[1][1]!.content) : null,
  };
}
test('old director JSON remains readable, and director cannot impersonate actor execution', () => {
  const f = fixture();
  const { stepProposals: _, ...legacy } = f.director;
  assert.deepEqual(SceneProposalSchema.parse(legacy).stepProposals, []);
  assert.deepEqual(SceneProposalSchema.parse(legacy).npcActions, []);
  assert.throws(() =>
    SceneProposalSchema.parse({
      ...legacy,
      npcActions: [
        {
          matterId: f.f.trigger.id,
          actorId: f.f.actorId,
          kind: 'receive_r17',
          quote: '接过钥匙',
        },
      ],
    }),
  );
});
test('current receiver execution is structured and actor identity comes from the separate call', async () => {
  const f = fixture();
  const { proposal, calls, director, npc } = await propose(f);
  assert.equal(calls.length, 2);
  assert.deepEqual(proposal.stepProposals, f.director.stepProposals);
  assert.deepEqual(proposal.npcActions, [
    {
      matterId: f.f.trigger.id,
      actorId: f.f.actorId,
      kind: 'receive_r17',
      quote: '我接过R17钥匙和维修单。',
    },
  ]);
  assert.equal(proposal.outcome, 'succeeded');
  assert.deepEqual(proposal.matterUpdates, []);
  assert.ok(director.worldMatterConditions[0].stepExecution);
  assert.ok(npc.matters.some((m: { id: string }) => m.id === f.f.trigger.id));
  assert.ok(npc.stepExecution.some((m: { matterId: string }) => m.matterId === f.f.trigger.id));
});
test('promise-only dialogue gives no structured execution credit', async () => {
  const { proposal } = await propose(fixture(), { text: '等刘航来了我会交接。' });
  assert.deepEqual(proposal.npcActions, []);
});
test('NPC cannot provide any actorId including a foreign identity', async () => {
  const f = fixture();
  await assert.rejects(
    propose(f, {
      text: '我接过R17钥匙。',
      actions: [
        {
          matterId: f.f.trigger.id,
          actorId: 'foreign',
          kind: 'receive_r17',
          quote: '我接过R17钥匙。',
        },
      ],
    }),
    { code: 'INVALID_PROPOSAL' },
  );
});
test('execution quote must come from this same actor reply and target a current authorized matter', async () => {
  const f = fixture();
  for (const action of [
    { matterId: f.f.trigger.id, kind: 'receive_r17', quote: '我收到了R17维修单。' },
    { matterId: f.f.pursuit.id, kind: 'receive_r17', quote: '我接过R17钥匙。' },
  ]) {
    await assert.rejects(propose(f, { text: '我接过R17钥匙。', actions: [action] }), {
      code: 'INVALID_PROPOSAL',
    });
  }
});
test('plans cannot submit player steps or NPC actions', async () => {
  const plan = fixture('plan');
  await assert.rejects(propose(plan), { code: 'INVALID_PROPOSAL' });
  const badStep = fixture('plan');
  badStep.director.stepProposals = fixture().director.stepProposals;
  await assert.rejects(propose(badStep, { text: '明白。' }), { code: 'INVALID_PROPOSAL' });
});
test('player step quotes must come from current input and current observable result', async () => {
  for (const key of ['inputQuote', 'observationQuote'] as const) {
    const f = fixture();
    f.director.stepProposals[0]![key] = '旧历史里已经签收';
    await assert.rejects(propose(f), { code: 'INVALID_PROPOSAL' });
  }
});
test('director cannot complete the structured goal before runtime aggregates real evidence', async () => {
  const f = fixture();
  (f.director.matterUpdates as { id: string; status: string }[]).push({
    id: sceneMatterId(f.c.scene.id, f.f.trigger.id),
    status: 'completed',
  });
  await assert.rejects(propose(f), { code: 'INVALID_PROPOSAL' });
});

test('future intent cannot masquerade as execution by trimming the quote', async () => {
  for (const line of [
    '我会接过R17钥匙和维修单。',
    '我准备接过R17钥匙和维修单。',
    '我没有接过R17钥匙和维修单。',
  ]) {
    const f = fixture();
    await assert.rejects(
      propose(f, {
        text: line,
        actions: [{ matterId: f.f.trigger.id, kind: 'receive_r17', quote: '接过R17钥匙和维修单' }],
      }),
      { code: 'INVALID_PROPOSAL' },
    );
  }
});
test('more than two present actors still prioritizes the named receiver with only three calls total', async () => {
  const f = fixture();
  const receiver = f.c.world.actors.find((a) => a.id === f.f.actorId)!;
  const others = f.c.world.actors.filter((a) => a.id !== receiver.id).slice(0, 2);
  f.c.world.actors = [
    ...others,
    receiver,
    ...f.c.world.actors.filter((a) => a.id !== receiver.id && !others.includes(a)),
  ];
  for (const actor of others)
    f.c.scene.presence.push({
      participant: { kind: 'actor', actorId: actor.id },
      joinedVersion: 0,
      sourceVersion: 0,
      sourceEventId: 'opening',
    });
  f.director.presentActorIds = f.c.world.actors
    .filter((a) => [receiver, ...others].includes(a))
    .map((a) => a.id);
  const { proposal, calls } = await propose(f, { text: '好的。' });
  assert.equal(calls.length, 3);
  assert.equal(proposal.dialogues[0]!.actorId, receiver.id);
});
test('blocked matter or input source and unwitnessed progress do not reach NPC step payload', async () => {
  for (const visibility of ['blocked-matter', 'blocked-input', 'unwitnessed'] as const) {
    const f = fixture();
    const source = randomUUID();
    const step = {
      stepId: 'order_reviewed',
      performer: 'player' as const,
      sceneId: f.c.scene.id,
      actionId: randomUUID(),
      inputEventId: source,
      inputVersion: 0,
      eventId: randomUUID(),
      eventVersion: 0,
      at: f.c.world.time,
      inputQuote: 'PRIVATE_INPUT_MARKER',
      observationQuote: 'PRIVATE_OBSERVATION_MARKER',
      witnessActorIds: visibility === 'unwitnessed' ? [] : [f.f.actorId],
    };
    f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress = {
      ruleVersion: 'r17-delivery-v1',
      steps: [step],
    };
    if (visibility !== 'unwitnessed')
      f.c.blockedSourcesByActor = {
        [f.f.actorId]: [visibility === 'blocked-matter' ? f.f.trigger.id : source],
      };
    const { npc } = await propose(f, { text: '收到。' });
    assert.ok(!JSON.stringify(npc).includes('PRIVATE_INPUT_MARKER'));
    assert.ok(!JSON.stringify(npc).includes('PRIVATE_OBSERVATION_MARKER'));
    if (visibility === 'blocked-matter') assert.deepEqual(npc.stepExecution, []);
    else
      assert.equal(
        npc.stepExecution[0].steps.find((s: { id: string }) => s.id === 'order_reviewed').done,
        false,
      );
  }
});
test('real visible saved steps persist in the NPC payload without copying full input quotes', async () => {
  const f = fixture();
  f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress = {
    ruleVersion: 'r17-delivery-v1',
    steps: [
      {
        stepId: 'order_reviewed',
        performer: 'player',
        sceneId: f.c.scene.id,
        actionId: randomUUID(),
        inputEventId: randomUUID(),
        inputVersion: 0,
        eventId: randomUUID(),
        eventVersion: 0,
        at: f.c.world.time,
        inputQuote: 'ORIGINAL_INPUT_NOT_EMBEDDED',
        observationQuote: '你核对了R17维修单。',
        witnessActorIds: [f.f.actorId],
      },
    ],
  };
  const { npc } = await propose(f, { text: '单据已核对。' });
  assert.equal(
    npc.stepExecution[0].steps.find((s: { id: string }) => s.id === 'order_reviewed').done,
    true,
  );
  assert.ok(
    !npc.stepExecution[0].missingSteps.some((s: { id: string }) => s.id === 'order_reviewed'),
  );
  assert.ok(!JSON.stringify(npc).includes('ORIGINAL_INPUT_NOT_EMBEDDED'));
});
test('unsupported old content receives no new execution context or permission', async () => {
  const f = fixture();
  f.c.world.officialLife!.version = 2;
  f.director.stepProposals = [];
  const { npc, proposal } = await propose(f, { text: '先核对单据。' });
  assert.deepEqual(npc.stepExecution, []);
  assert.deepEqual(proposal.npcActions, []);
  await assert.rejects(propose(f), { code: 'INVALID_PROPOSAL' });
});

test('captured planner evidence reaches real pure runtime completion without optional steps or forced outcome', async () => {
  const f = fixture();
  f.director.outcome = 'partial';
  const observation = '你核对R17维修单，向老周说明电源接头检修，将R17钥匙和维修单交给老周。';
  f.director.observation = observation;
  f.director.stepProposals = ['order_reviewed', 'repair_explained', 'handed_over'].map(
    (stepId) => ({
      matterId: f.f.trigger.id,
      stepId,
      inputQuote: f.c.action!.text,
      observationQuote: observation,
      ...(stepId === 'order_reviewed' ? {} : { receiverId: f.f.actorId }),
    }),
  ) as typeof f.director.stepProposals;
  const { proposal } = await propose(f, {
    text: '我接过R17钥匙和维修单。',
    actions: [
      {
        matterId: f.f.trigger.id,
        kind: 'receive_r17',
        quote: '我接过R17钥匙和维修单。',
      },
    ],
  });
  const event = { id: randomUUID(), version: f.c.world.version + 1, at: f.c.world.time };
  const resolution = {
    outcome: proposal.outcome!,
    observation: proposal.observation!,
    sourceEventId: event.id,
    sourceVersion: event.version,
  };
  const result = resolveSceneStepProgress({
    world: f.c.world,
    initial: f.f.initial,
    scene: f.c.scene,
    action: { ...f.c.action!, status: 'resolved', resolution },
    stepProposals: proposal.stepProposals!,
    npcActions: proposal.npcActions!,
    dialogues: proposal.dialogues,
    event,
  });
  const matter = result.matters.find((m) => m.id === f.f.trigger.id)!;
  assert.equal(proposal.outcome, 'partial');
  assert.ok(completeSceneSteps(matter));
  assert.ok(matter.stepProgress!.steps.every((step) => step.observationQuote.endsWith('。')));
  assert.deepEqual(
    matter.stepProgress!.steps.map((s) => s.stepId),
    ['order_reviewed', 'repair_explained', 'handed_over', 'received'],
  );
  assert.deepEqual(result.completedMatterIds, [f.f.trigger.id]);
});

test('a bounded affirmative NPC claim cannot silently omit its typed action', async () => {
  for (const text of [
    '我接过R17钥匙和维修单。',
    '我现在收下R17钥匙和维修单。',
    '好的。 我接过R17钥匙和维修单。',
    '我检查了R17。',
    '我核对了R17接头。',
  ]) {
    await assert.rejects(propose(fixture(), { text, actions: [] }), { code: 'INVALID_PROPOSAL' });
  }
});
test('future, negated, quoted and other-person lines do not force an executed NPC action', async () => {
  for (const text of [
    '我会接过R17钥匙和维修单。',
    '我没有接过R17钥匙和维修单。',
    '如果我接过R17钥匙和维修单，我会交给车主。',
    '“我接过R17钥匙和维修单”是你刚才引用的话。',
    '刘航接过R17钥匙和维修单。',
    '我检查了R18。',
  ]) {
    const { proposal } = await propose(fixture(), { text, actions: [] });
    assert.deepEqual(proposal.npcActions, []);
  }
});
test('only this actor own authorized saved execution permits a no-action recap', async () => {
  for (const mode of ['own', 'different-actor', 'unwitnessed', 'blocked'] as const) {
    const f = fixture();
    const eventId = randomUUID();
    f.c.world.matters!.find((m) => m.id === f.f.trigger.id)!.stepProgress = {
      ruleVersion: 'r17-delivery-v1',
      steps: [
        {
          stepId: 'received',
          performer: 'actor',
          actorId: mode === 'different-actor' ? 'someone-else' : f.f.actorId,
          receiverId: f.f.actorId,
          sceneId: f.c.scene.id,
          actionId: randomUUID(),
          inputEventId: randomUUID(),
          inputVersion: 0,
          eventId,
          eventVersion: 0,
          at: f.c.world.time,
          inputQuote: '我将R17钥匙和维修单交给老周。',
          observationQuote: '我接过R17钥匙和维修单。',
          witnessActorIds: mode === 'unwitnessed' ? [] : [f.f.actorId],
        },
      ],
    };
    if (mode === 'blocked') f.c.blockedSourcesByActor = { [f.f.actorId]: [eventId] };
    const reply = { text: '我接过R17钥匙和维修单。', actions: [] };
    if (mode === 'own') assert.deepEqual((await propose(f, reply)).proposal.npcActions, []);
    else await assert.rejects(propose(f, reply), { code: 'INVALID_PROPOSAL' });
  }
});
