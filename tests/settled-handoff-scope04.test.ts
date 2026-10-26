import test from 'node:test';
import assert from 'node:assert/strict';
import { hasHandoffFollowup } from '../src/modules/world/infrastructure/settled-episode-handoff-read.ts';
import type { ActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
const scope = { episodeId: 'episode-a', requestId: 'request-a', inputReceiptId: 'input-a' };
function state(): Pick<
  ActorAgentState,
  'goals' | 'plans' | 'actions' | 'responsibilities' | 'questions'
> {
  return { goals: [], plans: [], actions: [], responsibilities: [], questions: [] };
}
const goal = (id: string, sourceIds: string[]) => ({
  id,
  sourceIds,
  summary: '本人目标',
  status: 'active' as const,
  resultIds: [],
});

test('unrelated old goals, questions, immediate image actions do not consume another quiet handoff slot', () => {
  const s = state();
  s.goals.push(goal('photo-goal', ['old-player-input']));
  s.actions.push({
    id: 'photo-action',
    goalId: 'photo-goal',
    sourceIds: ['old-player-input'],
    capability: 'media.generate_image',
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
    status: 'waiting',
  });
  s.questions = [
    {
      id: 'old-question',
      channel: 'private',
      threadId: 'actor',
      sourceId: 'old-player-input',
      text: '旧事',
      askedAt: '2026-10-27T00:00:00Z',
      status: 'open',
    },
  ];
  const before = structuredClone(s);
  assert.equal(hasHandoffFollowup(s, scope), false);
  assert.deepEqual(s, before);
});

test('only exact input or episode intent roots and exact episode/request subjects count', () => {
  for (const source of ['input-a', 'episode-intent:request-a']) {
    const s = state();
    s.goals.push(goal('g', [source]));
    assert.equal(hasHandoffFollowup(s, scope), true);
  }
  for (const subject of [
    { kind: 'episode' as const, id: 'episode-a' },
    { kind: 'request' as const, id: 'request-a' },
  ]) {
    const s = state();
    s.responsibilities.push({
      id: 'r',
      subject,
      sourceIds: ['different-source'],
      summary: '本事项',
      status: 'waiting',
      waitingOn: 'player',
      nextCheck: [],
    });
    assert.equal(hasHandoffFollowup(s, scope), true);
  }
  const s = state();
  s.goals.push(goal('g', ['episode-intent:request-ab']));
  assert.equal(hasHandoffFollowup(s, scope), false);
});

test('goal/plan/action/responsibility/question dependencies retain live followup through terminal anchors and cycles', () => {
  const s = state();
  s.goals.push({ ...goal('g', ['episode-intent:request-a']), status: 'withdrawn' });
  s.plans.push({
    id: 'p',
    goalId: 'g',
    sourceIds: ['other'],
    summary: '计划',
    status: 'finished',
    actionIds: ['a'],
    nextActionId: null,
    triggers: [],
    missingConditions: [],
  });
  s.actions.push({
    id: 'a',
    goalId: 'g',
    sourceIds: ['other'],
    capability: 'conversation',
    targetIds: [],
    parameters: {},
    preconditions: [],
    dependsOnActionIds: ['b'],
    handlesResponsibilityIds: ['r'],
    status: 'withdrawn',
  });
  s.actions.push({ ...s.actions[0]!, id: 'b', goalId: null, dependsOnActionIds: ['a'] });
  s.responsibilities.push({
    id: 'r',
    subject: { kind: 'request', id: 'other' },
    sourceIds: ['other'],
    summary: '依赖',
    status: 'withdrawn',
    waitingOn: null,
    nextCheck: [],
  });
  s.questions = [
    {
      id: 'q',
      channel: 'private',
      threadId: 'actor',
      sourceId: 'other',
      responsibilityId: 'r',
      text: '依赖问题',
      askedAt: '2026-10-27T00:00:00Z',
      status: 'open',
    },
  ];
  assert.equal(hasHandoffFollowup(s, scope), true);
  s.questions[0]!.status = 'answered';
  assert.equal(hasHandoffFollowup(s, scope), false);
});
