import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorEngagementBrief,
  ACTOR_ENGAGEMENT_RULES,
} from '../src/modules/world/application/actor-engagement.ts';
import type { ActorContext } from '../src/modules/world/application/ports.ts';
function fixture(): ActorContext {
  return {
    worldId: 'world',
    worldVersion: 1,
    time: '2026-10-09T07:36:00.000Z',
    actor: { id: 'actor', name: '店主', persona: '想请熟人吃饭，但尊重对方的安排。' },
    facts: [],
    messages: [],
    appointments: [],
    matters: [
      {
        id: 'known',
        title: '晚饭安排',
        description: '尚待商量',
        span: 'near_term',
        status: 'not_started',
        assertion: 'actor_statement',
      },
    ],
    choices: [
      {
        id: 'choice',
        actorId: 'actor',
        quote: '我今晚不吃饭了',
        intent: '拒绝今晚晚饭',
        status: 'pending',
        sourceEventId: 'choice-event',
        sourceVersion: 1,
      },
    ],
  };
}
test('goal direction preserves declined choices and known progress without manufacturing permission or an actor goal', () => {
  const c = fixture(),
    before = structuredClone(c),
    b = actorEngagementBrief(c);
  assert.equal(b.ownMotivationSource, 'actor.persona');
  assert.deepEqual(b.knownMatterState, [
    { id: 'known', status: 'not_started', assertion: 'actor_statement' },
  ]);
  assert.deepEqual(b.choiceState, [
    { id: 'choice', status: 'pending', statedIntent: '拒绝今晚晚饭' },
  ]);
  assert.equal(b.progressIsReferenceNotExecutionPermission, true);
  assert.equal(b.mayPauseOwnGoal, true);
  assert.ok(!('actions' in b));
  assert.deepEqual(c, before);
});
test('player reports stay qualified reports; private fact or message contents are not duplicated into goal instructions', () => {
  const c = fixture();
  c.choices![0]!.result = {
    kind: 'reported_done',
    quote: '我做完了',
    sourceEventId: 'report',
    sourceVersion: 2,
  };
  c.facts.push({
    id: 'private',
    text: 'PRIVATE_SENTINEL',
    visibility: { kind: 'owner' },
    sourceEventId: 'source',
  });
  const b = actorEngagementBrief(c);
  assert.equal(b.choiceState[0]?.reportedOutcome, 'reported_done');
  assert.ok(!JSON.stringify(b).includes('PRIVATE_SENTINEL'));
  assert.ok(!JSON.stringify(b).includes('我做完了'));
  assert.ok(ACTOR_ENGAGEMENT_RULES.includes('已明确回答、拒绝或已完成'));
});
