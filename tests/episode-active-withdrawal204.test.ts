import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyActorAgentState,
  type AgentAction,
} from '../src/modules/world/domain/agent-runtime.ts';
import {
  shouldWithdrawActiveEpisode as withdraw,
  type EpisodeParticipationLifecycleInput,
} from '../src/modules/world/domain/episode-participation-lifecycle.ts';
import type { SharedEpisode } from '../src/modules/world/domain/director-runtime.ts';
const episode = (actors = ['a']): SharedEpisode => ({
  schemaVersion: 1,
  id: 'ep',
  worldId: 'w',
  revision: 2,
  origin: { kind: 'director', sourceId: 'd' },
  status: 'active',
  title: 'event',
  description: '',
  participantActorIds: actors,
  placeIds: [],
  sourceEventIds: ['earlier'],
  resultIds: [],
  unresolvedResponsibilityIds: [],
});
function lane(actorId = 'a'): EpisodeParticipationLifecycleInput {
  const requestId = `r-${actorId}`;
  const state = emptyActorAgentState({ worldId: 'w', actorId }, 'definition', 4);
  state.goals = [
    {
      id: 'g',
      summary: 'own goal',
      status: 'withdrawn',
      sourceIds: [`episode-intent:${requestId}`],
      resultIds: [],
      endReason: 'Changed my mind',
    },
  ];
  state.plans = [
    {
      id: 'p',
      goalId: 'g',
      summary: 'own plan',
      status: 'withdrawn',
      sourceIds: ['own'],
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: ['Withdrawn'],
    },
  ];
  return {
    request: {
      schemaVersion: 1,
      worldId: 'w',
      actorId,
      id: requestId,
      episodeId: 'ep',
      originDecisionId: 'd',
      engineEpoch: 2,
      createdAtVersion: 1,
      activity: 'conversation',
      status: 'consumed',
      inputReceiptId: 'input',
      receiptId: `receipt-${actorId}`,
    },
    decision: { requestId, choice: 'engage', reason: 'Originally agreed', sourceIds: ['own'] },
    state,
    results: [],
  };
}
test('single and multiple actors explicitly withdraw owned work without changing original choices', () => {
  const a = lane(),
    b = lane('b'),
    before = structuredClone(a);
  assert.equal(withdraw(episode(), [a]), true);
  assert.deepEqual(a, before);
  assert.equal(withdraw(episode(['a', 'b']), [b, a]), true);
  b.state.plans[0]!.status = 'active';
  assert.equal(withdraw(episode(['a', 'b']), [a, b]), false);
});
test('plan replacement, goal still active, finished plan and empty engagement do not exit', () => {
  for (const mutation of [
    (a: EpisodeParticipationLifecycleInput) => {
      a.state.goals[0]!.status = 'active';
    },
    (a: EpisodeParticipationLifecycleInput) => {
      a.state.plans[0]!.status = 'finished';
    },
    (a: EpisodeParticipationLifecycleInput) => {
      a.state.plans.push({ ...a.state.plans[0]!, id: 'replacement', status: 'blocked' });
    },
    (a: EpisodeParticipationLifecycleInput) => {
      a.state.goals = [];
      a.state.plans = [];
    },
  ]) {
    const a = lane();
    mutation(a);
    assert.equal(withdraw(episode(), [a]), false);
  }
});
test('quiet/defer/missing requests and wrong identity cannot be treated as exit', () => {
  for (const choice of ['quiet', 'defer', 'need_information'] as const) {
    const a = lane();
    a.decision.choice = choice;
    assert.equal(withdraw(episode(), [a]), false);
  }
  assert.equal(withdraw(episode(['a', 'b']), [lane()]), false);
  assert.equal(withdraw(episode(['a', 'b']), [lane(), lane()]), false);
  const a = lane();
  a.request.status = 'pending';
  assert.equal(withdraw(episode(), [a]), false);
  a.request.status = 'consumed';
  a.request.episodeId = 'other';
  assert.equal(withdraw(episode(), [a]), false);
});
test('initial decline may coexist with exited engagement, never with open work', () => {
  const b = lane('b');
  b.decision.choice = 'decline';
  b.state.goals = [];
  b.state.plans = [];
  assert.equal(withdraw(episode(['a', 'b']), [lane(), b]), true);
  const active = lane('b');
  active.decision.choice = 'decline';
  active.state.goals[0]!.status = 'active';
  assert.equal(withdraw(episode(['a', 'b']), [lane(), active]), false);
});
test('pending own actions block; completed history is retained; unrelated work does not block', () => {
  const action = (status: AgentAction['status']): AgentAction => ({
    id: 'act',
    goalId: 'g',
    capability: 'plan.record',
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    sourceIds: ['own'],
    status,
  });
  for (const status of ['proposed', 'ready', 'waiting', 'blocked', 'executing'] as const) {
    const a = lane();
    a.state.actions = [action(status)];
    assert.equal(withdraw(episode(), [a]), false);
  }
  for (const status of ['succeeded', 'failed', 'withdrawn'] as const) {
    const a = lane();
    a.state.actions = [action(status)];
    assert.equal(withdraw(episode(), [a]), true);
  }
  const a = lane();
  a.state.actions = [{ ...action('ready'), goalId: 'unrelated' }];
  assert.equal(withdraw(episode(), [a]), true);
  a.state.actions[0]!.sourceIds = [`episode-intent:${a.request.id}`];
  assert.equal(withdraw(episode(), [a]), false);
});
test('non-active episodes are never altered', () => {
  for (const status of ['proposed', 'resolved', 'withdrawn'] as const)
    assert.equal(withdraw({ ...episode(), status }, [lane()]), false);
});

test('episode responsibility can carry explicit exit, but waiting/expired cannot', () => {
  const a = lane();
  a.state.goals = [];
  a.state.plans = [];
  a.state.responsibilities = [
    {
      id: 'responsibility',
      subject: { kind: 'episode', id: 'ep' },
      summary: 'own obligation',
      status: 'withdrawn',
      waitingOn: null,
      sourceIds: ['own'],
      nextCheck: [],
      endReason: 'No longer participating',
    },
  ];
  assert.equal(withdraw(episode(), [a]), true);
  for (const status of ['waiting', 'expired'] as const) {
    a.state.responsibilities[0]!.status = status;
    assert.equal(withdraw(episode(), [a]), false);
  }
  a.state.responsibilities[0]!.status = 'withdrawn';
  a.state.responsibilities[0]!.subject.id = 'unrelated';
  assert.equal(withdraw(episode(), [a]), false);
});

test('withdrawn goal needs the original explicit end reason', () => {
  const a = lane();
  delete a.state.goals[0]!.endReason;
  assert.equal(withdraw(episode(), [a]), false);
  a.state.goals[0]!.endReason = '   ';
  assert.equal(withdraw(episode(), [a]), false);
});
