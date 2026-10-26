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
  assert.deepEqual(fitted.episodes, episodes);
  assert.deepEqual(fitted.actorKnownTopics, topics);
  const observations = fitted.observations as typeof payload.observations;
  assert.deepEqual(
    observations.filter((o) => o.sourceId.startsWith('actual-position:')),
    positions,
  );
  assert.ok((fitted.worldSetting as string).length < payload.worldSetting.length);
});
