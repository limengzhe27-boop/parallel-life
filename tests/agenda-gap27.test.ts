import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentScheduleSources,
  type SchedulingView,
} from '../src/modules/world/application/agent-schedule-collectors.ts';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentResponsibility } from '../src/modules/world/domain/agent-runtime.ts';

const at = '2026-10-15T10:00:00.000Z',
  before = '2026-10-15T09:00:00.000Z';
type ActorRead = SchedulingView['actors'][number];
function actor(actorId = 'a'): ActorRead {
  const state = emptyActorAgentState({ worldId: 'w', actorId }, 'authored:fixture', 5);
  state.revision = 2;
  state.goals.push({
    id: 'g',
    summary: '本人的安排',
    status: 'active',
    sourceIds: ['s'],
    resultIds: [],
  });
  state.actions.push({
    id: 'action',
    goalId: 'g',
    capability: 'own.schedule',
    status: 'ready',
    sourceIds: ['s'],
    targetIds: [],
    parameters: { mode: 'normal' },
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
  });
  state.plans.push({
    id: 'plan',
    goalId: 'g',
    summary: '已明确的下一步',
    status: 'active',
    actionIds: ['action'],
    nextActionId: 'action',
    triggers: [],
    missingConditions: [],
    sourceIds: ['s'],
  });
  const snapshot: AgentSnapshot = {
    state,
    viewState: structuredClone(state),
    redactedStateIds: [],
    worldVersion: 5,
    storyAt: at,
    actor: {
      name: actorId,
      persona: '合成测试人物',
      boundaries: '',
      definitionRef: state.definitionRef,
    },
    sources: [
      { id: 's', kind: 'authored', recordId: 'fact', worldVersion: 0, at: before },
      { id: 'pos', kind: 'world_event', recordId: 'position-event', worldVersion: 1, at: before },
      { id: 'input', kind: 'accepted_input', recordId: 'input', worldVersion: 5, at },
    ],
    observations: [{ sourceId: 's', kind: 'fact', text: '仅已授权的合成依据' }],
    channel: {
      kind: 'private',
      threadId: actorId,
      audienceActorIds: [actorId],
      allowedCapabilities: ['own.schedule'],
    },
    input: { sourceId: 'input', origin: 'wake', text: '' },
    worldContext: {
      time: { storyAt: at, timeZone: 'UTC+08:00', localDateTime: '2026-10-15T18:00:00' },
      boundary: {
        actorIds: [actorId],
        placeIds: ['home', 'shop'],
        capabilityIds: ['own.schedule'],
        extensionPermission: 'none',
      },
      selfPosition: { status: 'at', placeId: 'home', occurredAt: before, sourceId: 'pos' },
      knowledge: [],
    },
  };
  return { snapshot, trustedResults: [], appointments: [] };
}
function view(actors = [actor()]): SchedulingView {
  return {
    worldId: 'w',
    engineEpoch: 2,
    worldVersion: 5,
    storyAt: at,
    actors,
    activeAttempts: [],
    consumedCandidateIds: [],
  };
}
function sync(a: ActorRead) {
  a.snapshot.viewState = structuredClone(a.snapshot.state);
  return a;
}
async function collect(
  v: SchedulingView,
  source?: 'actor_plan' | 'responsibility' | 'appointment' | 'observation',
) {
  const outputs = await Promise.all(
    createAgentScheduleSources(v)
      .filter((s) => !source || s.id.startsWith(source + ':'))
      .map((s) => s.source.collect('owner', v.worldId)),
  );
  return {
    candidates: outputs.flatMap((o) => o.candidates),
    blockers: outputs.flatMap((o) => o.blockers),
  };
}

function actionless() {
  const a = actor();
  a.snapshot.state.actions = [];
  Object.assign(a.snapshot.state.plans[0]!, { actionIds: [], nextActionId: null, triggers: [] });
  return sync(a);
}
function episode(a: ActorRead) {
  a.snapshot.episodeFollowUps = [
    {
      requestId: 'request',
      episodeId: 'episode',
      choice: 'engage',
      followUp: 'open',
      goalIds: ['g'],
      planIds: ['plan'],
      responsibilityIds: [],
      readyPlanIds: ['plan'],
      readyResponsibilityIds: [],
    },
  ];
}
test('27 unrelated question does not freeze independent actionless plan', async () => {
  const a = actionless();
  assert.equal((await collect(view([a]), 'actor_plan')).candidates.length, 1);
  a.snapshot.state.questions = [
    {
      id: 'unrelated-question',
      channel: 'private',
      threadId: 'a',
      sourceId: 'input',
      text: '你喜欢什么颜色？',
      askedAt: before,
      status: 'open',
      responsibilityId: 'unrelated-responsibility',
    },
  ];
  sync(a);
  assert.equal(
    (await collect(view([a]), 'actor_plan')).candidates.length,
    1,
    'unrelated thread question cannot freeze this plan',
  );
});
test('27 episode actionless plan uses cadence and preserves missing conditions', async () => {
  const a = actionless();
  const v = view([a]);
  v.planReviews = new Map([
    [
      'plan',
      {
        planId: 'plan',
        nextReviewAt: '2026-10-15T12:00:00.000Z',
        lastReviewedAt: before,
        reviewCount: 1,
      },
    ],
  ]);
  assert.equal((await collect(v, 'actor_plan')).candidates.length, 0);
  episode(a);
  assert.equal(
    (await collect(v, 'actor_plan')).candidates.length,
    0,
    'episode reference preserves cadence',
  );
  v.planReviews = new Map();
  assert.equal((await collect(v, 'actor_plan')).candidates[0]!.episodeId, 'episode');
  a.snapshot.state.plans[0]!.missingConditions = ['等待玩家回答'];
  sync(a);
  assert.equal((await collect(v, 'actor_plan')).candidates.length, 0);
});
test('27 episode review same evidence and wording changes remain deduplicated', async () => {
  const a = actionless();
  episode(a);
  const v = view([a]);
  const first = (await collect(v, 'actor_plan')).candidates[0]!;
  v.consumedCandidateIds = [first.id];
  assert.equal((await collect(v, 'actor_plan')).candidates.length, 0);
  a.snapshot.state.plans[0]!.summary += '（措辞更新）';
  sync(a);
  assert.equal(
    (await collect(v, 'actor_plan')).candidates.length,
    0,
    'wording does not reopen same review',
  );
});
test('27 exact episode responsibility question blocks only its own review', async () => {
  const a = actionless();
  episode(a);
  a.snapshot.episodeFollowUps![0]!.responsibilityIds = ['episode-response'];
  a.snapshot.state.questions = [
    {
      id: 'q',
      channel: 'private',
      threadId: 'a',
      sourceId: 'input',
      text: '确认参与吗',
      askedAt: before,
      status: 'open',
      responsibilityId: 'episode-response',
    },
  ];
  sync(a);
  assert.equal((await collect(view([a]), 'actor_plan')).candidates.length, 0);
  a.snapshot.state.questions[0]!.responsibilityId = 'other';
  sync(a);
  assert.equal((await collect(view([a]), 'actor_plan')).candidates.length, 1);
});
