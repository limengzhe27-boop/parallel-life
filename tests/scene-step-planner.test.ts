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
import type { ModelOutputOptions } from '../src/modules/ai/application/ports.ts';
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
  const outputs: (ModelOutputOptions | undefined)[] = [];
  const proposal = await new ScenePlanner({
    async complete(messages, _signal, _maxTokens, output) {
      calls.push(messages);
      outputs.push(output);
      return JSON.stringify(calls.length === 1 ? f.director : reply);
    },
  }).propose(f.c);
  return {
    proposal,
    calls,
    outputs,
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

test('all scene calls request JSON without another model invocation', async () => {
  const f = fixture();
  const { calls, outputs } = await propose(f);
  assert.equal(calls.length, 2);
  assert.deepEqual(outputs, [{ format: 'json_object' }, { format: 'json_object' }]);
  assert.match(calls[0]![0]!.content, /完全省略receiverId/);
  assert.match(calls[0]![0]!.content, /绝不能写null/);
});
test('schema diagnostics identify only allowed field paths/codes without raw values or unknown keys', async () => {
  for (const mutation of ['null-receiver', 'unknown-secret', 'null-array'] as const) {
    const f = fixture();
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(f.director));
    if (mutation === 'null-receiver')
      (raw.stepProposals as Record<string, unknown>[])[0]!.receiverId = null;
    else if (mutation === 'null-array') raw.stepProposals = null;
    else raw.SECRET_UNKNOWN_FIELD = 'PRIVATE_USER_RAW_VALUE';
    let calls = 0;
    await assert.rejects(
      new ScenePlanner({
        async complete() {
          calls++;
          return JSON.stringify(raw);
        },
      }).propose(f.c),
      (error: unknown) => {
        const e = error as Error & { code: string; stage: string; diagnosticMessage: string };
        assert.equal(e.code, 'INVALID_PROPOSAL');
        assert.equal(e.stage, 'proposal');
        assert.ok(e.message.includes(e.diagnosticMessage));
        assert.ok(!e.message.includes('SECRET_UNKNOWN_FIELD'));
        assert.ok(!e.message.includes('PRIVATE_USER_RAW_VALUE'));
        assert.ok(e.diagnosticMessage.length <= 500);
        assert.ok(!JSON.stringify(e).includes('SECRET_UNKNOWN_FIELD'));
        assert.ok(!JSON.stringify(e).includes('PRIVATE_USER_RAW_VALUE'));
        if (mutation === 'null-receiver')
          assert.equal(
            e.diagnosticMessage,
            'scene_schema:stepProposals.[0].receiverId:invalid_type',
          );
        else if (mutation === 'null-array')
          assert.equal(e.diagnosticMessage, 'scene_schema:stepProposals:invalid_type');
        else assert.equal(e.diagnosticMessage, 'scene_schema:$:unrecognized_keys');
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});
test('non-JSON output has a fixed safe diagnostic, not the provider raw text', async () => {
  const f = fixture();
  await assert.rejects(
    new ScenePlanner({
      async complete() {
        return 'PRIVATE_INVALID_RAW_WITH_SECRET';
      },
    }).propose(f.c),
    (error: unknown) => {
      const e = error as Error & { stage: string; diagnosticMessage: string };
      assert.equal(e.stage, 'proposal');
      assert.equal(e.diagnosticMessage, 'scene_schema:MODEL_OUTPUT_WITHOUT_OBJECT');
      assert.ok(e.message.includes(e.diagnosticMessage));
      assert.ok(!e.message.includes('PRIVATE_INVALID_RAW_WITH_SECRET'));
      assert.ok(!JSON.stringify(e).includes('PRIVATE_INVALID_RAW_WITH_SECRET'));
      return true;
    },
  );
});
test('opening uses authored step definitions without executing, duplicating tasks or inventing presence', async () => {
  const f = fixture();
  delete f.c.action;
  f.director.stepProposals = [];
  f.director.outcome = null;
  f.director.observation = null;
  f.director.presentActorIds = [];
  const { calls, proposal, director } = await propose(f, { present: false, text: null });
  assert.equal(calls.length, 2);
  assert.deepEqual(proposal.presentActorIds, []);
  assert.deepEqual(proposal.initialMatters, []);
  assert.deepEqual(proposal.stepProposals, []);
  assert.deepEqual(proposal.npcActions, []);
  assert.equal(director.authoredStepDefinition.length, 1);
  assert.equal(director.authoredStepDefinition[0].matterId, f.f.trigger.id);
  assert.ok(!('completedSteps' in director.authoredStepDefinition[0]));
  assert.match(calls[0]![0]!.content, /initialMatters必须\[\]/);
  assert.match(calls[0]![1]!.content, /Appointment candidates are not proof of arrival/);
  assert.match(calls[0]![1]!.content, /if presentActorIds is empty/);
});

function openingFixture() {
  const f = fixture();
  delete f.c.action;
  f.c.scene.presence = f.c.scene.presence.filter((p) => p.participant.kind === 'player');
  f.director.stepProposals = [];
  f.director.outcome = null;
  f.director.observation = null;
  f.director.presentActorIds = [];
  return f;
}
test('opening calls the eligible actor despite an empty director list; own present true becomes a candidate source', async () => {
  const f = openingFixture();
  const { proposal, calls, npc, outputs } = await propose(f, {
    present: true,
    text: '先把R17工单拿过来核对。',
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(outputs, [{ format: 'json_object' }, { format: 'json_object' }]);
  assert.deepEqual(proposal.presentActorIds, [f.f.actorId]);
  assert.deepEqual(proposal.dialogues, [{ actorId: f.f.actorId, text: '先把R17工单拿过来核对。' }]);
  assert.deepEqual(proposal.npcActions, []);
  assert.deepEqual(proposal.stepProposals, []);
  assert.deepEqual(npc.entries, []);
  assert.equal(npc.observedNow, null);
  assert.ok(npc.ownMessages.every((m: { actorId: string }) => m.actorId === f.f.actorId));
  assert.ok(
    npc.ownAppointments.every((a: { participantIds: string[] }) =>
      a.participantIds.includes(f.f.actorId),
    ),
  );
});
test('opening false overrides a director presence suggestion and never stores the declined speech', async () => {
  const f = openingFixture();
  f.director.presentActorIds = [f.f.actorId];
  const { proposal, calls } = await propose(f, { present: false, text: '我晚点再来。' });
  assert.equal(calls.length, 2);
  assert.deepEqual(proposal.presentActorIds, []);
  assert.deepEqual(proposal.dialogues, []);
});
test('opening presence output is strict, true needs speech, and actors cannot inject other identities or effects', async () => {
  for (const reply of [
    { present: true, text: null },
    { present: true, text: '' },
    { present: 'true', text: '在这里。' },
    { text: '在这里。' },
    { present: true, text: '在这里。', actorId: 'another' },
    { present: true, text: '收下了。', actions: [{ kind: 'receive_r17' }] },
    { present: true, text: '在这里。', presentActorIds: ['another'] },
  ]) {
    await assert.rejects(propose(openingFixture(), reply), { code: 'INVALID_PROPOSAL' });
  }
});
test('opening cannot use a future or cancelled invitation as an arrival candidate', async () => {
  for (const mode of ['future', 'cancelled'] as const) {
    const f = openingFixture();
    const appointment = f.c.world.appointments.find(
      (a) => a.id === f.f.trigger.relatedInvitationId,
    )!;
    f.c.scene.appointmentId = appointment.id;
    if (mode === 'future') appointment.at = new Date(Date.parse(f.c.storyAt) + 60000).toISOString();
    else appointment.status = 'cancelled';
    const { calls, proposal } = await propose(f, { present: true, text: '在这里。' });
    assert.equal(calls.length, 1);
    assert.deepEqual(proposal.presentActorIds, []);
  }
});
test('opening caps candidates at two and binds each independent decision without sharing another private thread', async () => {
  const f = openingFixture();
  const actors = f.c.world.actors.slice(0, 3);
  const appointment = f.c.world.appointments.find((a) => a.id === f.f.trigger.relatedInvitationId)!;
  appointment.participantIds = actors.map((a) => a.id);
  f.c.scene.appointmentId = appointment.id;
  f.c.world.messages = actors.map((actor, i) => ({
    id: randomUUID(),
    actorId: actor.id,
    role: 'assistant',
    text: `PRIVATE_ACTOR_${i}`,
    at: f.c.storyAt,
    sourceEventId: randomUUID(),
  }));
  const calls: { role: string; content: string }[][] = [];
  const proposal = await new ScenePlanner({
    async complete(messages) {
      calls.push(messages);
      if (calls.length === 1) return JSON.stringify(f.director);
      const index = calls.length - 2;
      const payload = JSON.parse(messages[1]!.content);
      assert.ok(
        payload.ownMessages.some((m: { text: string }) => m.text === `PRIVATE_ACTOR_${index}`),
      );
      assert.ok(!messages[1]!.content.includes(`PRIVATE_ACTOR_${1 - index}`));
      assert.deepEqual(payload.entries, []);
      assert.equal(payload.observedNow, null);
      return JSON.stringify({ present: index === 0, text: index === 0 ? '我来了。' : null });
    },
  }).propose(f.c);
  assert.equal(calls.length, 3);
  assert.deepEqual(proposal.presentActorIds, [actors[0]!.id]);
  assert.deepEqual(
    proposal.dialogues.map((d) => d.actorId),
    [actors[0]!.id],
  );
});

test('opening direct invitation must belong to the current place before any actor call', async () => {
  const f = openingFixture();
  f.c.scene.appointmentId = f.f.trigger.relatedInvitationId;
  f.c.world.space!.places.find((p) => p.id === f.c.scene.placeId)!.appointmentIds = [];
  const { calls, proposal } = await propose(f, { present: true, text: '我在这儿。' });
  assert.equal(calls.length, 1);
  assert.deepEqual(proposal.presentActorIds, []);
});
test('opening stale scene place is rejected before spending any director or actor call', async () => {
  const f = openingFixture();
  f.c.world.space!.currentPlaceId = 'lin_home';
  let calls = 0;
  await assert.rejects(
    new ScenePlanner({
      async complete() {
        calls++;
        return '{}';
      },
    }).propose(f.c),
    { code: 'INVALID_COMMAND' },
  );
  assert.equal(calls, 0);
});

test('an invalid explicit opening invitation cannot silently fall back to another place invitation', async () => {
  const f = openingFixture();
  f.c.scene.appointmentId = 'foreign-invitation';
  const { calls, proposal } = await propose(f, { present: true, text: '我在这儿。' });
  assert.equal(calls.length, 1);
  assert.deepEqual(proposal.presentActorIds, []);
});

test('NPC action examples use two exact legal enums and no mixed placeholder or automatic action', async () => {
  const f = fixture();
  const { calls } = await propose(f, { text: '单号先核对清楚。', actions: [] });
  const prompt = calls[1]![0]!.content;
  assert.ok(!prompt.includes('receive_r17或inspect_r17'));
  assert.ok(
    prompt.includes(
      JSON.stringify({
        text: '我接过R17钥匙和维修单。',
        actions: [
          {
            matterId: f.f.trigger.id,
            kind: 'receive_r17',
            quote: '我接过R17钥匙和维修单。',
          },
        ],
      }),
    ),
  );
  assert.ok(
    prompt.includes(
      JSON.stringify({
        text: '我检查了R17。',
        actions: [
          {
            matterId: f.f.trigger.id,
            kind: 'inspect_r17',
            quote: '我检查了R17。',
          },
        ],
      }),
    ),
  );
  assert.match(prompt, /玩家仅核对维修单且未实际交出对象/);
  assert.match(prompt, /不是已发生证据/);
  assert.match(prompt, /actions":\[\]/);
});
test('invalid or mixed action enums remain rejected with a safe kind path and exactly two calls', async () => {
  for (const kind of ['receive_r17或inspect_r17', 'order_reviewed', 'none']) {
    const f = fixture();
    let calls = 0;
    await assert.rejects(
      new ScenePlanner({
        async complete() {
          calls++;
          return JSON.stringify(
            calls === 1
              ? f.director
              : {
                  text: '我接过R17钥匙和维修单。',
                  actions: [
                    {
                      matterId: f.f.trigger.id,
                      kind,
                      quote: '我接过R17钥匙和维修单。',
                    },
                  ],
                },
          );
        },
      }).propose(f.c),
      (error: unknown) => {
        const e = error as Error & { code: string; stage: string; diagnosticMessage: string };
        assert.equal(e.code, 'INVALID_PROPOSAL');
        assert.equal(e.stage, 'proposal');
        assert.equal(e.diagnosticMessage, 'scene_actor_schema:actions.[0].kind:invalid_value');
        assert.ok(!e.message.includes(kind));
        return true;
      },
    );
    assert.equal(calls, 2);
  }
});
