import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type {
  AgentActionResult,
  AgentCondition,
} from '../src/modules/world/domain/agent-runtime.ts';
import {
  projectEpisodeParticipationLifecycle as project,
  validateEpisodeParticipationLifecycle as validate,
  type EpisodeParticipationLifecycleInput,
} from '../src/modules/world/domain/episode-participation-lifecycle.ts';

const at = '2026-10-16T05:00:00.000Z';
function fixture(): EpisodeParticipationLifecycleInput {
  return {
    request: {
      schemaVersion: 1,
      worldId: 'world',
      actorId: 'actor',
      id: 'request',
      episodeId: 'episode',
      originDecisionId: 'director',
      engineEpoch: 2,
      createdAtVersion: 1,
      activity: 'meeting',
      status: 'consumed',
      inputReceiptId: 'player-input',
      receiptId: 'receipt',
    },
    decision: {
      requestId: 'request',
      choice: 'engage',
      reason: '我愿意先了解情况。',
      sourceIds: ['player-input', 'episode-intent:request'],
    },
    state: emptyActorAgentState({ worldId: 'world', actorId: 'actor' }, 'definition', 4),
    results: [],
  };
}
function followUp(input = fixture()) {
  input.state.goals.push({
    id: 'goal',
    summary: '了解并安排后续',
    status: 'active',
    sourceIds: ['episode-intent:request'],
    resultIds: [],
  });
  input.state.plans.push({
    id: 'plan',
    goalId: 'goal',
    summary: '等消息再安排',
    status: 'waiting',
    sourceIds: ['own-source'],
    actionIds: [],
    nextActionId: null,
    triggers: [],
    missingConditions: ['还不知道对方是否有空'],
  });
  input.state.responsibilities.push({
    id: 'responsibility',
    subject: { kind: 'episode', id: 'episode' },
    summary: '等待准确回应',
    status: 'waiting',
    waitingOn: 'player',
    sourceIds: ['own-source'],
    nextCheck: [],
  });
  return input;
}
function result(input: EpisodeParticipationLifecycleInput, patch: Partial<AgentActionResult> = {}) {
  const value: AgentActionResult = {
    worldId: 'world',
    actorId: 'actor',
    id: 'result',
    actionId: 'action',
    eventId: 'event',
    worldVersion: 4,
    at,
    outcome: 'succeeded',
    handledResponsibilityIds: ['responsibility'],
    completedGoalIds: ['goal'],
    evidenceSourceIds: ['actual-source'],
    ...patch,
  };
  input.state.actions.push({
    id: 'action',
    goalId: 'goal',
    capability: 'test.trusted',
    sourceIds: ['actual-source'],
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: ['responsibility'],
    status: value.outcome === 'succeeded' ? 'succeeded' : 'failed',
    resultId: value.id,
  });
  input.results = [value];
  return value;
}

test('engage without an arrangement stays a legal stance, never an invented task or episode success', () => {
  const input = fixture();
  const before = structuredClone(input);
  validate(input);
  const view = project(input);
  assert.equal(view.stance.choice, 'engage');
  assert.equal(view.followUp, 'none');
  assert.deepEqual(view.reassessment, { eligible: false, basis: [] });
  assert.deepEqual(view.goals, []);
  assert.deepEqual(view.responsibilities, []);
  assert.equal('status' in view, false);
  assert.equal('deadline' in view, false);
  assert.deepEqual(input, before);
});

test('links exact intent source, exact typed subject and existing goal-plan edges, never prose or input alone', () => {
  const input = followUp();
  input.state.goals.push({
    ...input.state.goals[0]!,
    id: 'other-goal',
    summary: 'episode-intent:request 同名剧情',
    sourceIds: ['episode-intent:request-other'],
  });
  for (const [kind, id, key] of [
    ['request', 'request', 'exact-request'],
    ['request', 'request-other', 'other-request'],
    ['episode', 'episode-other', 'other-episode'],
    ['appointment', 'episode', 'wrong-kind'],
  ] as const)
    input.state.responsibilities.push({
      ...input.state.responsibilities[0]!,
      id: key,
      subject: { kind, id },
      summary: 'request episode same words',
      sourceIds: ['player-input'],
    });
  input.state.responsibilities.push({
    ...input.state.responsibilities[0]!,
    id: 'source-linked',
    subject: { kind: 'appointment', id: 'appointment' },
    sourceIds: ['episode-intent:request'],
  });
  const view = project(input);
  assert.deepEqual(
    view.goals.map((g) => g.id),
    ['goal'],
  );
  assert.deepEqual(
    view.plans.map((p) => p.id),
    ['plan'],
  );
  assert.deepEqual(
    view.responsibilities.map((r) => r.id),
    ['responsibility', 'exact-request', 'source-linked'],
  );
  assert.equal(view.followUp, 'open');
});

for (const choice of ['defer', 'need_information', 'decline', 'quiet'] as const)
  test(`${choice} preserves existing open responsibility and missing conditions without fabricating a deadline`, () => {
    const input = followUp();
    input.decision.choice = choice;
    const before = structuredClone(input);
    const view = project(input);
    assert.equal(view.stance.choice, choice);
    assert.equal(view.followUp, 'open');
    assert.equal(view.responsibilities[0]!.status, 'waiting');
    assert.equal(view.responsibilities[0]!.deadline, undefined);
    assert.deepEqual(view.plans[0]!.missingConditions, ['还不知道对方是否有空']);
    assert.equal(view.reassessment.eligible, false);
    assert.deepEqual(input, before);
  });

test('an intent-linked plan retains its existing goal without dragging unrelated sibling plans into the episode', () => {
  const input = followUp();
  input.state.goals[0]!.sourceIds = ['existing-personal-goal'];
  input.state.plans[0]!.sourceIds = ['episode-intent:request'];
  input.state.plans.push({
    ...input.state.plans[0]!,
    id: 'other-plan-for-same-goal',
    sourceIds: ['other-episode'],
  });
  const view = project(input);
  assert.deepEqual(
    view.goals.map((g) => g.id),
    ['goal'],
  );
  assert.deepEqual(
    view.plans.map((p) => p.id),
    ['plan'],
  );
});

test('a topic switch or unrelated satisfied condition does not close or wake an existing responsibility', () => {
  const input = followUp();
  input.satisfiedConditions = [{ kind: 'observation', sourceId: 'weather' }];
  input.state.responsibilities[0]!.nextCheck = [{ kind: 'observation', sourceId: 'answer' }];
  const view = project(input);
  assert.equal(view.followUp, 'open');
  assert.equal(view.reassessment.eligible, false);
  assert.equal(view.responsibilities[0]!.status, 'waiting');
});

test('all explicit conditions must hold; a triggered blocked plan is only eligible to reconsider its missing conditions', () => {
  const input = followUp();
  const time: AgentCondition = { kind: 'at_or_after', at, sourceId: 'real-deadline' };
  const observation: AgentCondition = { kind: 'observation', sourceId: 'new-answer' };
  input.state.plans[0]!.status = 'blocked';
  input.state.plans[0]!.triggers = [time, observation];
  input.satisfiedConditions = [time];
  assert.equal(project(input).reassessment.eligible, false);
  input.satisfiedConditions = [time, observation];
  const view = project(input);
  assert.deepEqual(view.reassessment.basis, [
    { kind: 'plan', id: 'plan', conditions: [time, observation] },
  ]);
  assert.equal(view.plans[0]!.status, 'blocked');
  assert.equal(view.plans[0]!.nextActionId, null);
  assert.equal(view.plans[0]!.missingConditions.length, 1);
});

test('real success or failure can trigger reassessment, a claimed satisfied result alone cannot', () => {
  const input = followUp();
  const condition: AgentCondition = { kind: 'result', actionId: 'action', outcome: 'failed' };
  input.state.responsibilities[0]!.nextCheck = [condition];
  input.satisfiedConditions = [condition];
  assert.equal(project(input).reassessment.eligible, false);
  result(input, { outcome: 'failed', handledResponsibilityIds: [], completedGoalIds: [] });
  const view = project(input);
  assert.equal(view.reassessment.eligible, true);
  assert.equal(view.followUp, 'open');
  assert.equal(view.responsibilities[0]!.status, 'waiting');
});

for (const choice of ['defer', 'need_information'] as const)
  test(`${choice} cannot smuggle an unconfirmed fulfilled responsibility`, () => {
    const input = followUp();
    input.decision.choice = choice;
    input.state.responsibilities[0]!.status = 'fulfilled';
    input.state.responsibilities[0]!.resolutionResultId = 'fake';
    const before = structuredClone(input);
    assert.throws(() => validate(input), { code: 'EPISODE_LIFECYCLE_UNCONFIRMED_RESPONSIBILITY' });
    assert.deepEqual(input, before);
  });

test('fulfilment requires exact actor/world/action/result and certified responsibility handling', () => {
  for (const patch of [
    { actorId: 'other' },
    { worldId: 'other' },
    { actionId: 'other' },
    { id: 'other' },
    { outcome: 'failed' },
    { worldVersion: 5 },
    { eventId: '' },
    { handledResponsibilityIds: [] },
  ] satisfies Partial<AgentActionResult>[]) {
    const input = followUp();
    input.state.responsibilities[0]!.status = 'fulfilled';
    input.state.responsibilities[0]!.resolutionResultId = 'result';
    result(input);
    Object.assign(input.results[0]!, patch);
    assert.throws(() => project(input), { code: 'EPISODE_LIFECYCLE_UNCONFIRMED_RESPONSIBILITY' });
  }
});

test('proposing an invitation or storing a plan cannot certify the goal completed', () => {
  const input = followUp();
  input.state.goals[0]!.status = 'fulfilled';
  input.state.goals[0]!.resultIds = ['result'];
  result(input, { completedGoalIds: [], outputRefs: [{ kind: 'appointment', id: 'new-invite' }] });
  assert.throws(() => project(input), { code: 'EPISODE_LIFECYCLE_UNCONFIRMED_GOAL' });
});

test('terminal own follow-up with actual receipts stays separate from whole-episode completion', () => {
  const input = followUp();
  input.state.goals[0]!.status = 'fulfilled';
  input.state.goals[0]!.resultIds = ['result'];
  input.state.plans[0]!.status = 'finished';
  input.state.plans[0]!.triggers = [{ kind: 'observation', sourceId: 'answer' }];
  input.state.responsibilities[0]!.status = 'fulfilled';
  input.state.responsibilities[0]!.resolutionResultId = 'result';
  input.state.responsibilities[0]!.nextCheck = input.state.plans[0]!.triggers;
  input.satisfiedConditions = input.state.plans[0]!.triggers;
  result(input);
  const view = project(input);
  assert.equal(view.followUp, 'terminal');
  assert.equal(view.reassessment.eligible, false);
  assert.equal('episodeStatus' in view, false);
  assert.equal('resolved' in view, false);
});

test('identity, epochs, future requests and duplicate identifiers fail atomically', () => {
  for (const mutate of [
    (i: EpisodeParticipationLifecycleInput) => {
      i.request.actorId = 'other';
    },
    (i: EpisodeParticipationLifecycleInput) => {
      i.request.worldId = 'other';
    },
    (i: EpisodeParticipationLifecycleInput) => {
      i.request.engineEpoch = 1;
    },
    (i: EpisodeParticipationLifecycleInput) => {
      i.request.createdAtVersion = 5;
    },
    (i: EpisodeParticipationLifecycleInput) => {
      i.decision.requestId = 'other';
    },
    (i: EpisodeParticipationLifecycleInput) => {
      i.decision.sourceIds = [];
    },
  ]) {
    const input = followUp();
    mutate(input);
    const before = structuredClone(input);
    assert.throws(() => validate(input), { code: 'EPISODE_LIFECYCLE_IDENTITY' });
    assert.deepEqual(input, before);
  }
  const duplicate = followUp();
  duplicate.state.goals.push(structuredClone(duplicate.state.goals[0]!));
  assert.throws(() => project(duplicate), { code: 'EPISODE_LIFECYCLE_DUPLICATE_ID' });
});

test('returned views share no mutable objects with source state, decision or condition evidence', () => {
  const input = followUp();
  const before = structuredClone(input);
  const view = project(input);
  view.stance.sourceIds.push('wrong');
  view.goals[0]!.summary = 'changed';
  view.plans[0]!.missingConditions.push('wrong');
  view.responsibilities[0]!.status = 'withdrawn';
  assert.deepEqual(input, before);
});
