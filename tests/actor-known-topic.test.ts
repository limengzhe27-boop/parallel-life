import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validActorTopicSelection,
  type ActorKnownTopic,
} from '../src/modules/world/domain/actor-known-topic.ts';
import type { DirectorOpportunity } from '../src/modules/world/domain/director-runtime.ts';

test('director topic selection is actor-scoped and pins exact rendered content', () => {
  const topic: ActorKnownTopic = {
    id: 'known-topic:a',
    actorId: 'a',
    kind: 'goal',
    itemId: 'goal',
    summary: '本人未完成事项',
    status: 'active',
    contentHash: 'a'.repeat(64),
    proofSourceIds: ['definition:a'],
  };
  const opportunity: DirectorOpportunity = {
    id: 'opportunity',
    title: '跟进',
    description: '不得下发此全局描述',
    playerImpact: 'optional',
    participantActorIds: ['a'],
    placeIds: [],
    activity: 'follow_up',
    basisSourceIds: ['genesis:world'],
    actorTopics: [{ actorId: 'a', refs: [{ id: topic.id, contentHash: topic.contentHash }] }],
  };
  assert.equal(validActorTopicSelection(opportunity, [topic]), true);
  for (const value of [
    {
      ...opportunity,
      actorTopics: [{ actorId: 'b', refs: [{ id: topic.id, contentHash: topic.contentHash }] }],
    },
    {
      ...opportunity,
      actorTopics: [{ actorId: 'a', refs: [{ id: topic.id, contentHash: 'b'.repeat(64) }] }],
    },
    { ...opportunity, actorTopics: [{ actorId: 'a', refs: [] }] },
    { ...opportunity, actorTopics: [opportunity.actorTopics![0]!, opportunity.actorTopics![0]!] },
    {
      ...opportunity,
      actorTopics: [
        {
          actorId: 'a',
          refs: [opportunity.actorTopics![0]!.refs[0]!, opportunity.actorTopics![0]!.refs[0]!],
        },
      ],
    },
  ])
    assert.equal(validActorTopicSelection(value, [topic]), false);
  assert.equal(validActorTopicSelection(opportunity, []), false);
  assert.equal(validActorTopicSelection({ ...opportunity, actorTopics: undefined }, []), true);
});
