import test from 'node:test';
import assert from 'node:assert/strict';
import {
  storyStateOutcome,
  evaluateStory,
  type StoryState,
  type StoryPlan,
} from '../src/modules/settings/domain/publication-story.ts';
const state = (): StoryState => ({
  nodeKey: 'event_a',
  claimId: 'claim',
  commandId: 'command',
  actorId: 'actor',
  expectedVersion: 0,
  status: 'presented',
  outcome: null,
  storyAt: '2026-10-14T07:00:00Z',
  automatic: false,
  sourceEventId: 'opening',
  sourceMessageId: 'message',
  invitationId: null,
  responseEventId: null,
});
const plan = (): StoryPlan => ({
  schemaVersion: 1,
  origin: { workId: 'work', publicationVersion: 1, draftVersion: 1, contentHash: 'hash' },
  actors: [{ key: 'npc', id: 'actor' }],
  places: [],
  history: [],
  timeline: {
    initialStageKey: 'stage_a',
    stages: [
      { key: 'stage_a', title: '第一段', order: 0, afterStageKeys: [] },
      { key: 'stage_b', title: '第二段', order: 1, afterStageKeys: ['stage_a'] },
    ],
  },
  nodes: [
    {
      key: 'event_a',
      kind: 'candidate',
      title: '第一段事件',
      editorialIntent: '发生一次商议',
      actorKeys: ['npc'],
      prerequisites: [],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'director_event', actorKey: 'npc' },
      timeline: {
        stageKey: 'stage_a',
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    },
    {
      key: 'event_b',
      kind: 'candidate',
      title: '后续',
      editorialIntent: '有实际结果再开启',
      actorKeys: ['npc'],
      prerequisites: [{ kind: 'after_committed_node', nodeKey: 'event_a' }],
      mutuallyExclusiveNodeKeys: [],
      intent: { kind: 'director_event', actorKey: 'npc' },
      timeline: {
        stageKey: 'stage_b',
        excludeIfResolved: [],
        alternatives: { onDeclined: [], onSkipped: [], onExpired: [] },
      },
    },
  ],
});
const context = {
  storyNow: '2026-10-14T07:01:00Z',
  currentPlaceId: null,
  availableFactIds: [],
  automatic: false,
};
test('presenting a message alone never resolves a stage or enables after-completion event', () => {
  const p = plan(),
    s = state(),
    result = evaluateStory(p, [s], context);
  assert.equal(storyStateOutcome(s), null);
  assert.deepEqual(result.resolvedStages, []);
  assert.deepEqual(result.eligible, []);
});
test('receipt-hydrated fulfillment resolves the prior stage without declaring physical player success', () => {
  const p = plan(),
    s = state();
  s.progressResolution = { resolution: 'fulfilled', sourceEventId: 'actual_completion_receipt' };
  const result = evaluateStory(p, [s], context);
  assert.deepEqual(result.resolvedStages, ['stage_a']);
  assert.deepEqual(result.currentStages, ['stage_b']);
  assert.equal(result.eligible[0]?.key, 'event_b');
});
test('withdrawal closes a stage but does not satisfy a successful outcome condition', () => {
  const s = state();
  s.progressResolution = { resolution: 'withdrawn', sourceEventId: 'actual_withdrawal' };
  const r = evaluateStory(plan(), [s], context);
  assert.equal(storyStateOutcome(s), 'declined');
  assert.deepEqual(r.resolvedStages, ['stage_a']);
  assert.deepEqual(r.eligible, []);
});
test('unknown and failed claims cannot promote a purported progress completion', () => {
  for (const status of ['unknown', 'claimed', 'failed'] as const) {
    const s = state();
    s.status = status;
    s.progressResolution = { resolution: 'fulfilled', sourceEventId: 'untrusted' };
    assert.equal(storyStateOutcome(s), null);
  }
  const s = state();
  s.progressResolution = { resolution: 'fulfilled', sourceEventId: '' };
  assert.equal(storyStateOutcome(s), null);
});
