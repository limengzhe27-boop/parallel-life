import test from 'node:test';
import assert from 'node:assert/strict';
import { fitWithinBudget } from '../src/modules/world/infrastructure/director-agent-model.ts';

test('director trims setting before sacrificing actual positions or persistent episode and question state', () => {
  const positions = Array.from({ length: 7 }, (_, index) => ({
    sourceId: `actual-position:${index === 6 ? 'player' : `actor:${index}`}`,
    kind: 'fact',
    knownByActorIds: [],
    text: JSON.stringify({
      status: index === 6 ? 'arrived' : 'unknown',
      placeId: index === 6 ? 'street' : null,
    }),
  }));
  const episodes = Array.from({ length: 20 }, (_, index) => ({
    id: `episode:${index}`,
    status: 'active',
    participantActorIds: ['actor:0'],
    description: 'author material '.repeat(80),
    resultIds: [],
  }));
  const state = {
    actorId: 'actor:0',
    goals: [{ id: 'goal', status: 'active', sourceIds: ['message:promise'] }],
    decisions: [
      { id: 'choice', kind: 'declined', quote: 'I cannot come', sourceId: 'message:decline' },
    ],
    questions: [{ id: 'question', status: 'open', text: 'Which day?' }],
    focus: { channel: 'private', threadId: 'actor:0', questionSourceId: 'question' },
  };
  const topics = Array.from({ length: 15 }, (_, index) => ({
    id: `topic:${index}`,
    actorId: 'actor:0',
  }));
  const payload = {
    worldSetting: 'setting '.repeat(4000),
    actorStates: [state],
    episodes,
    actorKnownTopics: topics,
    observations: [
      ...positions,
      ...Array.from({ length: 40 }, (_, index) => ({
        sourceId: `fact:ambient-${index}`,
        kind: 'fact',
        knownByActorIds: [],
        text: 'ambient '.repeat(150),
      })),
    ],
    candidates: [],
    changes: [],
  };
  const original = structuredClone(payload);
  const fitted = fitWithinBudget(payload);
  assert.deepEqual(payload, original, 'preparation cannot mutate the saved snapshot');
  assert.deepEqual(fitted.actorStates, [state]);
  assert.deepEqual(
    (fitted.episodes as typeof episodes).map(({ description: _excerpt, ...status }) => status),
    episodes.map(({ description: _original, ...status }) => status),
  );
  assert.ok(
    (fitted.episodes as typeof episodes).every((episode) => episode.description.length > 0),
  );
  assert.deepEqual(fitted.actorKnownTopics, topics);
  const observations = fitted.observations as typeof payload.observations;
  assert.deepEqual(
    observations.filter((o) => o.sourceId.startsWith('actual-position:')),
    positions,
  );
  assert.ok((fitted.worldSetting as string).length < payload.worldSetting.length);
});

test('director omits only redundant private-thread binding without losing questions or their outcomes', () => {
  const questions = [
    {
      id: 'private-question',
      channel: 'private',
      threadId: 'actor',
      sourceId: 'message:old',
      text: 'Can you come?',
      status: 'answered',
      askedAt: '2026-10-14T10:00:00Z',
      resolution: {
        kind: 'decline_to_answer',
        sourceId: 'message:reply',
        quote: 'I cannot discuss that',
        at: '2026-10-14T10:01:00Z',
      },
    },
    {
      id: 'group-question',
      channel: 'group',
      threadId: 'group',
      sourceId: 'group-message:old',
      text: 'What time?',
      status: 'open',
    },
  ];
  const state = {
    actorId: 'actor',
    worldId: 'world',
    schemaVersion: 1,
    definitionRef: 'definition:actor',
    revision: 4,
    questions,
    focus: { channel: 'private', threadId: 'actor' },
  };
  const fitted = fitWithinBudget({
    worldSetting: 'setting'.repeat(15000),
    actorStates: [state],
    episodes: [],
    observations: Array.from({ length: 40 }, (_, index) => ({
      sourceId: `ambient:${index}`,
      kind: 'belief',
      text: 'ambient'.repeat(400),
    })),
  });
  const view = (fitted.actorStates as (typeof state)[])[0]!;
  const { threadId: _thread, ...privateQuestion } = questions[0]!;
  assert.deepEqual(view.questions, [privateQuestion, questions[1]]);
  assert.deepEqual(view.focus, state.focus);
  assert.equal(view.revision, 4);
  assert.equal(state.questions[0]!.threadId, 'actor');
});

test('under severe pressure Director overview retains business state and record ids while full sources remain immutable', () => {
  const sources = Array.from({ length: 100 }, (_, index) => `source:${index}`);
  const questions = Array.from({ length: 100 }, (_, index) => ({
    id: `q:${index}`,
    channel: 'private',
    threadId: 'actor',
    sourceId: `message:${index}`,
    text: 'question '.repeat(100),
    status: 'open',
    askedAt: '2026-10-14T10:00:00Z',
  }));
  const goal = {
    id: 'goal',
    summary: 'Wait for the actual decision',
    status: 'active',
    sourceIds: sources,
    resultIds: [],
  };
  const plan = {
    id: 'plan',
    goalId: 'goal',
    status: 'waiting',
    sourceIds: sources,
    missingConditions: ['A real player response'],
    triggers: [],
    actionIds: ['action'],
    nextActionId: 'action',
  };
  const action = {
    id: 'action',
    goalId: 'goal',
    status: 'waiting',
    sourceIds: sources,
    dependsOnActionIds: ['prior-result'],
  };
  const state = {
    actorId: 'actor',
    goals: [goal],
    plans: [plan],
    actions: [action],
    questions,
    decisions: [
      {
        id: 'decline',
        kind: 'declined',
        sourceId: 'message:decline',
        quote: 'No, I will not come',
      },
    ],
    focus: { channel: 'private', threadId: 'actor', questionSourceId: 'message:99' },
  };
  const original = structuredClone(state);
  const fitted = fitWithinBudget({ actorStates: [state], episodes: [], observations: [] });
  const view = (fitted.actorStates as Record<string, unknown>[])[0]!;
  const withoutSources = ({
    sourceIds: _sources,
    ...record
  }: typeof goal | typeof plan | typeof action) => record;
  assert.deepEqual(view.goals, [withoutSources(goal)]);
  assert.deepEqual(view.plans, [withoutSources(plan)]);
  assert.deepEqual(view.actions, [withoutSources(action)]);
  assert.deepEqual(view.decisions, state.decisions);
  assert.deepEqual(view.focus, state.focus);
  assert.deepEqual(
    (view.questions as typeof questions).map((q) => [q.id, q.text, q.status, q.askedAt]),
    questions.map((q) => [q.id, q.text, q.status, q.askedAt]),
  );
  assert.equal((view.questions as typeof questions)[99]!.sourceId, 'message:99');
  assert.deepEqual(state, original, 'lookup ids must resolve the unmodified protected original');
});
