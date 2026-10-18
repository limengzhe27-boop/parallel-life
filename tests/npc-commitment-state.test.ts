import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type {
  ActorAgentState,
  AgentProposal,
  AgentAttempt,
} from '../src/modules/world/domain/agent-runtime.ts';
import { parseAgentProposal } from '../src/modules/world/infrastructure/agent-proposal-parser.ts';
import {
  validateAgentProposal,
  reduceActorAgentState,
  currentPlayerDecision,
  AgentValidationError,
  type AgentValidationContext,
} from '../src/modules/world/domain/agent-kernel.ts';
import { committedAwarenessDelta } from '../src/modules/world/domain/world-awareness.ts';
import { attemptNeedsUserRecovery } from '../src/modules/world/application/run-agent.ts';
import type { WorldState, WorldEvent } from '../src/modules/world/domain/types.ts';

function makeFixture() {
  const worldId = 'world-comm-1';
  const actorId = 'actor-comm-a';
  const definitionRef = 'def-comm-v1';
  const initialTime = '2026-10-16T10:00:00.000Z';
  const state: ActorAgentState = emptyActorAgentState({ worldId, actorId }, definitionRef, 1);
  state.revision = 0;

  const world: WorldState = {
    schemaVersion: 1,
    id: worldId,
    ownerId: 'owner-comm-1',
    version: 1,
    title: '分工测试世界',
    time: initialTime,
    actors: [
      { id: actorId, name: '林白语', persona: '测试角色A' },
      { id: 'actor-comm-b', name: '小安', persona: '测试角色B' },
    ],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
    space: {
      currentPlaceId: 'place-shop',
      positionSource: { kind: 'seed_genesis', seedId: 'seed-comm-1', snapshotVersion: 0 },
      routes: [],
      places: [
        {
          id: 'place-shop',
          name: '茶饮店',
          description: '茶饮店',
          source: { kind: 'seed_genesis', seedId: 'seed-comm-1', snapshotVersion: 0 },
          contactActorIds: [],
          appointmentIds: [],
        },
        {
          id: 'place-market',
          name: '集市',
          description: '集市',
          source: { kind: 'seed_genesis', seedId: 'seed-comm-1', snapshotVersion: 0 },
          contactActorIds: [],
          appointmentIds: [],
        },
      ],
    },
  };

  const input1SourceId = 'msg-input-round1';
  const contextRound1: AgentValidationContext = {
    state: structuredClone(state),
    sources: [
      {
        id: `definition:${definitionRef}`,
        kind: 'authored',
        recordId: definitionRef,
        worldVersion: 1,
        at: initialTime,
      },
      {
        id: input1SourceId,
        kind: 'accepted_input',
        recordId: input1SourceId,
        worldVersion: 1,
        at: initialTime,
      },
    ],
    worldVersion: 1,
    storyAt: initialTime,
    input: {
      sourceId: input1SourceId,
      text: '我们来分工，我负责去集市采购，你负责在店里准备饮料并在门口接待，怎么样？',
      origin: 'player',
    },
    channel: {
      kind: 'private',
      threadId: actorId,
      allowedCapabilities: ['plan.record', 'appointment.propose'],
    },
  };

  return {
    worldId,
    actorId,
    definitionRef,
    initialTime,
    state,
    world,
    input1SourceId,
    contextRound1,
  };
}

test('1. 明确分工后，NPC 自己的计划与责任能持久保存', () => {
  const { contextRound1, input1SourceId, worldId, actorId } = makeFixture();

  // Model outputs commitment proposal: goal, plan, and responsibility for its own division of labor
  const proposalRaw: AgentProposal = {
    statements: [
      {
        text: '好，没问题！我负责准备饮料并在门口接待，等弄好后通知你。',
        dependsOnActionIds: [],
      },
    ],
    goals: [
      {
        id: 'goal_drink_service',
        summary: '负责准备饮料并在门口接待',
        status: 'active',
        sourceIds: [input1SourceId],
        resultIds: [],
      },
    ],
    plans: [
      {
        id: 'plan_drink_service',
        goalId: 'goal_drink_service',
        summary: '准备饮料与门口接待，完成后通知玩家',
        status: 'active',
        sourceIds: [input1SourceId],
        actionIds: [],
        nextActionId: null,
        triggers: [{ kind: 'observation', sourceId: input1SourceId }],
        missingConditions: [],
      },
    ],
    actions: [],
    responsibilities: [
      {
        id: 'resp_drink_service',
        subject: { kind: 'matter', id: 'drink_service' },
        summary: '负责准备饮料并在门口接待',
        status: 'open',
        waitingOn: 'self',
        sourceIds: [input1SourceId],
        nextCheck: [],
      },
    ],
    decisions: [],
  };

  // Parser validates proposal schema
  const parsed = parseAgentProposal(contextRound1, proposalRaw);
  assert.equal(parsed.goals.length, 1);
  assert.equal(parsed.plans.length, 1);
  assert.equal(parsed.responsibilities.length, 1);

  // Kernel reduces state
  const reduced = reduceActorAgentState(contextRound1, parsed, [], 2);
  assert.equal(reduced.state.revision, 1);
  assert.equal(reduced.state.projectedWorldVersion, 2);
  assert.equal(reduced.state.goals.length, 1);
  assert.equal(reduced.state.goals[0]!.id, 'goal_drink_service');
  assert.equal(reduced.state.goals[0]!.status, 'active');
  assert.equal(reduced.state.plans.length, 1);
  assert.equal(reduced.state.plans[0]!.id, 'plan_drink_service');
  assert.equal(reduced.state.plans[0]!.status, 'active');
  assert.equal(reduced.state.responsibilities.length, 1);
  assert.equal(reduced.state.responsibilities[0]!.id, 'resp_drink_service');
  assert.equal(reduced.state.responsibilities[0]!.status, 'open');
  assert.equal(reduced.state.responsibilities[0]!.revision, 0);
  assert.equal(reduced.statements.length, 1);
});

test('2. 普通闲聊、愿望和条件性建议不会误建责任', () => {
  const { contextRound1, input1SourceId } = makeFixture();

  // Casual chat or vague wish input
  contextRound1.input.text = '今天天气挺好的，我想出去逛逛街，要是以后有空就好了。';

  // Model correctly proposes empty delta for casual chatter
  const casualProposal: AgentProposal = {
    statements: [
      {
        text: '今天天气确实不错，不过我们得先把手头的事情梳理清楚。',
        dependsOnActionIds: [],
      },
    ],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };

  const parsed = parseAgentProposal(contextRound1, casualProposal);
  const reduced = reduceActorAgentState(contextRound1, parsed, [], 2);

  // No phantom goals, plans, or responsibilities are created
  assert.equal(reduced.state.goals.length, 0);
  assert.equal(reduced.state.plans.length, 0);
  assert.equal(reduced.state.responsibilities.length, 0);
  assert.equal(reduced.state.decisions.length, 0);
  assert.equal(reduced.state.revision, 1);
});

test('3. 明确拒绝、暂缓和无关话题不会被当作接受', () => {
  const { state, definitionRef, initialTime } = makeFixture();

  // State already has an open responsibility
  state.responsibilities = [
    {
      id: 'resp_drink_service',
      subject: { kind: 'matter', id: 'drink_service' },
      summary: '负责准备饮料并在门口接待',
      status: 'open',
      waitingOn: 'player',
      sourceIds: ['old-source-1'],
      nextCheck: [],
      revision: 0,
    },
  ];

  // Case A: Player clearly declines ("今天不用了，先取消吧")
  const inputDecline = 'decl-input-1';
  const contextDecline: AgentValidationContext = {
    state: structuredClone(state),
    sources: [
      {
        id: 'old-source-1',
        kind: 'authored',
        recordId: 'old-source-1',
        worldVersion: 1,
        at: initialTime,
      },
      {
        id: inputDecline,
        kind: 'accepted_input',
        recordId: inputDecline,
        worldVersion: 1,
        at: initialTime,
      },
    ],
    worldVersion: 1,
    storyAt: initialTime,
    input: { sourceId: inputDecline, text: '今天不用了，先取消吧。', origin: 'player' },
    channel: { kind: 'private', threadId: 'actor-comm-a', allowedCapabilities: [] },
  };

  const declineProposal: AgentProposal = {
    statements: [{ text: '好的，那我先不准备了。', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [
      {
        id: 'dec_declined',
        responsibilityId: 'resp_drink_service',
        kind: 'declined',
        sourceId: inputDecline,
        quote: '今天不用了',
      },
    ],
  };

  const reducedDecline = reduceActorAgentState(contextDecline, declineProposal, [], 2);
  const currentDec = currentPlayerDecision(contextDecline, declineProposal, 'resp_drink_service');
  assert.equal(currentDec?.kind, 'declined');
  // Declining does not fulfill responsibility
  assert.notEqual(reducedDecline.state.responsibilities[0]?.status, 'fulfilled');

  // Case B: Player defers ("这事我们先等等看再说")
  const inputDefer = 'defer-input-1';
  const contextDefer: AgentValidationContext = {
    state: structuredClone(state),
    sources: [
      {
        id: 'old-source-1',
        kind: 'authored',
        recordId: 'old-source-1',
        worldVersion: 1,
        at: initialTime,
      },
      {
        id: inputDefer,
        kind: 'accepted_input',
        recordId: inputDefer,
        worldVersion: 1,
        at: initialTime,
      },
    ],
    worldVersion: 1,
    storyAt: initialTime,
    input: { sourceId: inputDefer, text: '这事我们先等等看再说。', origin: 'player' },
    channel: { kind: 'private', threadId: 'actor-comm-a', allowedCapabilities: [] },
  };

  const deferProposal: AgentProposal = {
    statements: [{ text: '好的，先放一放。', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [
      {
        id: 'dec_deferred',
        responsibilityId: 'resp_drink_service',
        kind: 'deferred',
        sourceId: inputDefer,
        quote: '先等等看',
      },
    ],
  };

  const reducedDefer = reduceActorAgentState(contextDefer, deferProposal, [], 2);
  const currentDecDefer = currentPlayerDecision(contextDefer, deferProposal, 'resp_drink_service');
  assert.equal(currentDecDefer?.kind, 'deferred');
  assert.notEqual(reducedDefer.state.responsibilities[0]?.status, 'fulfilled');

  // Case C: Unrelated chat with falsified quote should be rejected by DECISION_QUOTE
  const inputUnrelated = 'unrelated-input-1';
  const contextUnrelated: AgentValidationContext = {
    state: structuredClone(state),
    sources: [
      {
        id: 'old-source-1',
        kind: 'authored',
        recordId: 'old-source-1',
        worldVersion: 1,
        at: initialTime,
      },
      {
        id: inputUnrelated,
        kind: 'accepted_input',
        recordId: inputUnrelated,
        worldVersion: 1,
        at: initialTime,
      },
    ],
    worldVersion: 1,
    storyAt: initialTime,
    input: { sourceId: inputUnrelated, text: '听说今天天气很好，阳光灿烂。', origin: 'player' },
    channel: { kind: 'private', threadId: 'actor-comm-a', allowedCapabilities: [] },
  };

  const fakeAcceptedProposal: AgentProposal = {
    statements: [{ text: '好的，我记下了。', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [
      {
        id: 'dec_fake',
        responsibilityId: 'resp_drink_service',
        kind: 'accepted',
        sourceId: inputUnrelated,
        quote: '好，就这么办', // Not in input text!
      },
    ],
  };

  assert.throws(
    () => validateAgentProposal(contextUnrelated, fakeAcceptedProposal),
    (err: unknown) => err instanceof AgentValidationError && err.reason === 'DECISION_QUOTE',
  );
});

test('4. 同一承诺不会重复建对象或重复执行', () => {
  const { input1SourceId, initialTime, definitionRef, state } = makeFixture();

  // Initial commitment exists in state
  state.goals = [
    {
      id: 'goal_drink_service',
      summary: '负责准备饮料并在门口接待',
      status: 'active',
      sourceIds: [input1SourceId],
      resultIds: [],
    },
  ];
  state.plans = [
    {
      id: 'plan_drink_service',
      goalId: 'goal_drink_service',
      summary: '准备饮料与门口接待，完成后通知玩家',
      status: 'active',
      sourceIds: [input1SourceId],
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: [],
    },
  ];
  state.responsibilities = [
    {
      id: 'resp_drink_service',
      subject: { kind: 'matter', id: 'drink_service' },
      summary: '负责准备饮料并在门口接待',
      status: 'open',
      waitingOn: 'self',
      sourceIds: [input1SourceId],
      nextCheck: [],
      revision: 0,
    },
  ];

  // Round 2: Player explicitly confirms division of labor
  const input2SourceId = 'msg-input-round2';
  const contextRound2: AgentValidationContext = {
    state: structuredClone(state),
    sources: [
      {
        id: `definition:${definitionRef}`,
        kind: 'authored',
        recordId: definitionRef,
        worldVersion: 1,
        at: initialTime,
      },
      {
        id: input1SourceId,
        kind: 'accepted_input',
        recordId: input1SourceId,
        worldVersion: 1,
        at: initialTime,
      },
      {
        id: input2SourceId,
        kind: 'accepted_input',
        recordId: input2SourceId,
        worldVersion: 2,
        at: initialTime,
      },
    ],
    worldVersion: 2,
    storyAt: initialTime,
    input: {
      sourceId: input2SourceId,
      text: '好，就这么办，采购交给我，门口和饮料交给你。',
      origin: 'player',
    },
    channel: {
      kind: 'private',
      threadId: 'actor-comm-a',
      allowedCapabilities: ['plan.record', 'appointment.propose'],
    },
  };

  // Model records player decision, and keeps existing goals/plans without duplicate creation
  const proposalRound2: AgentProposal = {
    statements: [{ text: '一言为定，那我这就开始准备。', dependsOnActionIds: [] }],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [
      {
        id: 'dec_division_accepted',
        responsibilityId: 'resp_drink_service',
        kind: 'accepted',
        sourceId: input2SourceId,
        quote: '好，就这么办',
      },
    ],
  };

  const reducedRound2 = reduceActorAgentState(contextRound2, proposalRound2, [], 3);
  // Reusing existing IDs leaves exactly 1 goal, 1 plan, 1 responsibility - no duplicate objects!
  assert.equal(reducedRound2.state.goals.length, 1);
  assert.equal(reducedRound2.state.plans.length, 1);
  assert.equal(reducedRound2.state.responsibilities.length, 1);
  assert.equal(reducedRound2.state.decisions.length, 1);
  assert.equal(reducedRound2.state.decisions[0]!.kind, 'accepted');

  // SOURCE_HISTORY_IMMUTABLE enforcement:
  // If model attempts to update existing plan but drops input1SourceId, it must fail!
  const illegalPlanUpdate: AgentProposal = {
    statements: [{ text: '好的', dependsOnActionIds: [] }],
    goals: [],
    plans: [
      {
        id: 'plan_drink_service',
        goalId: 'goal_drink_service',
        summary: '更新计划',
        status: 'active',
        sourceIds: [input2SourceId], // Dropped input1SourceId!
        actionIds: [],
        nextActionId: null,
        triggers: [],
        missingConditions: [],
      },
    ],
    actions: [],
    responsibilities: [],
    decisions: [],
  };

  assert.throws(
    () => validateAgentProposal(contextRound2, illegalPlanUpdate),
    (err: unknown) =>
      err instanceof AgentValidationError && err.reason === 'SOURCE_HISTORY_IMMUTABLE',
  );
});

test('5. 原入口产生的新计划能成为111的合法重评依据；相同依据不会循环触发', () => {
  const { world, actorId, input1SourceId, initialTime } = makeFixture();

  const emptyState = emptyActorAgentState({ worldId: world.id, actorId }, 'def-comm-v1', 1);

  const stateWithNewPlan: ActorAgentState = structuredClone(emptyState);
  stateWithNewPlan.revision = 1;
  stateWithNewPlan.projectedWorldVersion = 2;
  stateWithNewPlan.plans = [
    {
      id: 'plan_drink_service',
      goalId: 'goal_drink_service',
      summary: '准备饮料并在门口接待',
      status: 'active',
      sourceIds: [input1SourceId],
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: [],
    },
  ];

  const round1Event: WorldEvent = {
    schemaVersion: 1,
    id: 'evt-round-1',
    worldId: world.id,
    commandId: 'cmd-round-1',
    version: 2,
    occurredAt: initialTime,
    storyAt: initialTime,
    type: 'turn.resolved',
    data: {
      actorId,
      userText: '',
      effects: [],
      agentRuntime: {
        schemaVersion: 1,
        engineEpoch: 2,
        inputReceiptId: input1SourceId,
        inputStoryAt: initialTime,
        inputWorldVersion: 1,
        actorRevisionBefore: 0,
        actorRevisionAfter: 1,
        proposal: {
          statements: [{ text: '好，我负责准备饮料并在门口接待', dependsOnActionIds: [] }],
          goals: [],
          plans: stateWithNewPlan.plans,
          actions: [],
          responsibilities: [],
          decisions: [],
        },
        results: [],
        stateAfter: stateWithNewPlan,
      },
    },
  };

  // committedAwarenessDelta processes the event
  const world1: WorldState = { ...world, version: 2 };
  const delta1 = committedAwarenessDelta(world1, round1Event, {
    previousAgentState: emptyState,
  });

  // plan_changed is emitted!
  const planReason = delta1.reasons.find((r) => r.kind === 'plan_changed');
  assert.ok(planReason, 'plan_changed must be emitted when a new plan is added');
  assert.equal(planReason.ref.kind, 'plan');
  assert.equal(planReason.ref.id, 'plan_drink_service');
  assert.equal((planReason.ref as { actorId?: string }).actorId, actorId);

  // In Round 3 with casual chat, state plans do NOT change
  const round2Event: WorldEvent = {
    schemaVersion: 1,
    id: 'evt-round-2',
    worldId: world.id,
    commandId: 'cmd-round-2',
    version: 3,
    occurredAt: initialTime,
    storyAt: initialTime,
    type: 'turn.resolved',
    data: {
      actorId,
      userText: '',
      effects: [],
      agentRuntime: {
        schemaVersion: 1,
        engineEpoch: 2,
        inputReceiptId: 'input-round-2',
        inputStoryAt: initialTime,
        inputWorldVersion: 2,
        actorRevisionBefore: 1,
        actorRevisionAfter: 2,
        proposal: {
          statements: [{ text: '今天天气不错。', dependsOnActionIds: [] }],
          goals: [],
          plans: [],
          actions: [],
          responsibilities: [],
          decisions: [],
        },
        results: [],
        stateAfter: { ...stateWithNewPlan, revision: 2, projectedWorldVersion: 3 },
      },
    },
  };

  const world2: WorldState = { ...world, version: 3 };
  const delta2 = committedAwarenessDelta(world2, round2Event, {
    previousAgentState: stateWithNewPlan,
  });

  // NO plan_changed is emitted when plans do not change - prevents wake loop!
  const planReasonRound2 = delta2.reasons.find((r) => r.kind === 'plan_changed');
  assert.equal(planReasonRound2, undefined, 'no duplicate plan_changed when plan is unchanged');
});

test('6. 无效提案、重放、版本冲突和未知调用结果仍受保护', () => {
  const { contextRound1, input1SourceId } = makeFixture();

  // A. Goal fulfilled without results -> rejected
  const fakeFulfillGoal: AgentProposal = {
    statements: [{ text: '我已经全部办妥了。', dependsOnActionIds: [] }],
    goals: [
      {
        id: 'goal_fake_fulfill',
        summary: '已经办妥',
        status: 'fulfilled',
        sourceIds: [input1SourceId],
        resultIds: [], // Empty resultIds!
        endReason: 'done',
      },
    ],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };

  assert.throws(
    () => validateAgentProposal(contextRound1, fakeFulfillGoal),
    (err: unknown) => err instanceof AgentValidationError && err.reason === 'GOAL_RESULT_REQUIRED',
  );

  // B. Statement depends on unexecuted action -> rejected
  const fakeActionStatement: AgentProposal = {
    statements: [
      {
        text: '准备工作已经圆满完成！',
        dependsOnActionIds: ['non_existent_action'],
      },
    ],
    goals: [],
    plans: [],
    actions: [],
    responsibilities: [],
    decisions: [],
  };

  assert.throws(
    () => validateAgentProposal(contextRound1, fakeActionStatement),
    (err: unknown) =>
      err instanceof AgentValidationError && err.reason === 'UNKNOWN_STATEMENT_DEPENDENCY',
  );

  // C. Unknown attempt recovery check
  const unknownAttempt: AgentAttempt = {
    id: 'att-unknown',
    worldId: 'world-1',
    actorId: 'actor-1',
    commandId: 'cmd-1',
    inputReceiptId: 'rcpt-1',
    inputHash: 'hash-1',
    token: 'tok-1',
    leaseUntil: '2026-10-16T12:00:00Z',
    engineEpoch: 2,
    expectedWorldVersion: 1,
    expectedActorRevision: 0,
    status: 'unknown_after_send',
  };
  assert.equal(attemptNeedsUserRecovery(unknownAttempt), true);

  const committedAttempt: AgentAttempt = {
    ...unknownAttempt,
    status: 'committed',
    eventId: 'evt-1',
  };
  assert.equal(attemptNeedsUserRecovery(committedAttempt), false);
});
