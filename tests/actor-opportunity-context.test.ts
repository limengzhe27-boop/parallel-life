import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { actorOpportunityContext } from '../src/modules/world/domain/actor-opportunity-context.ts';
import { readActorEpisodeIntentsInTransaction } from '../src/modules/world/infrastructure/actor-episode-intent-repository.ts';
import { authoredMaterialCanonicalJson } from '../src/modules/world/domain/authored-agent-material.ts';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';
const task = JSON.stringify({
  protocol: 'actor-interaction-opportunity-v1',
  topic: '周末散步',
  personalObjective: '想与朋友相处',
  proposedInteraction: '提出一起去已有公园散步，询问意愿',
});
const raw = (version: string) => JSON.stringify({ protocol: version });
test('new opportunity requires authenticated origin version; copied old task and extra fields stay legacy', () => {
  assert.equal(actorOpportunityContext(raw('director-wire-v8'), task), null);
  assert.equal(actorOpportunityContext({ protocol: 'director-wire-v9' }, task), null);
  assert.equal(
    actorOpportunityContext(
      raw('director-wire-v9'),
      JSON.stringify({ ...JSON.parse(task), secret: 'x' }),
    ),
    null,
  );
  assert.equal(
    actorOpportunityContext(raw('director-wire-v9'), task)?.authority,
    'future_proposal_only',
  );
});
async function read(version: string, badHash = false) {
  const response = raw(version);
  const topic = {
    id: 'topic-a',
    actorId: 'actor-a',
    kind: 'goal',
    itemId: 'goal-a',
    summary: '想与朋友相处',
    status: 'active',
    contentHash: 'topic-hash',
    proofSourceIds: ['definition-a'],
  };
  const opportunity = {
    id: 'episode-a',
    participantActorIds: ['actor-a', 'actor-b'],
    activity: 'conversation',
    basisSourceIds: [],
    stagingIntents: [
      { actorId: 'actor-a', kind: 'future_task', task },
      { actorId: 'actor-b', kind: 'future_task', task: 'other private task' },
    ],
    actorTopics: [{ actorId: 'actor-a', refs: [{ id: topic.id, contentHash: topic.contentHash }] }],
  };
  const sql = {
    query: async (q: string) => {
      if (q.includes('SELECT w.state'))
        return {
          rows: [
            {
              state: { actors: [{ id: 'actor-a' }, { id: 'actor-b' }] },
              version: 1,
              engine_epoch: 2,
            },
          ],
        };
      if (q.includes('FROM parallel_life.agent_episode_requests'))
        return {
          rows: [
            {
              id: 'request-a',
              episode_id: 'episode-a',
              activity: 'conversation',
              created_at_version: 1,
              origin_decision_id: 'decision-a',
              director_response: response,
              director_response_hash: badHash
                ? 'bad'
                : createHash('sha256')
                    .update(authoredMaterialCanonicalJson(response))
                    .digest('hex'),
              decision: { opportunities: [opportunity] },
              director_snapshot: {
                storyAt: '2026-01-01T00:00:00Z',
                actorKnownTopics: [
                  topic,
                  { ...topic, id: 'topic-b', actorId: 'actor-b', summary: 'other private topic' },
                ],
              },
            },
          ],
        };
      if (q.includes('FROM parallel_life.memory_records')) return { rows: [] };
      if (q.includes('FROM parallel_life.actor_agent_states') && version === 'director-wire-v8')
        throw Error('old staging must not read ignored topic state');
      if (q.includes('FROM parallel_life.actor_agent_states')) return { rows: [{ document: {} }] };
      throw Error('unexpected query');
    },
  } as unknown as SqlClient;
  return (
    await readActorEpisodeIntentsInTransaction(
      sql,
      'owner',
      { worldId: 'world', actorId: 'actor-a', worldVersion: 1, storyAt: '2026-01-01T00:00:00Z' },
      ['request-a'],
      { historical: true },
    )
  ).get('request-a')!;
}
test('protected repository composes only selected own topics with new opportunity and retains their hashes', async () => {
  const view = await read('director-wire-v9');
  assert.match(view.observation.text, /ownKnownTopics/);
  assert.match(view.observation.text, /topic-hash/);
  assert.match(view.observation.text, /opportunitySourceHash/);
  assert.doesNotMatch(view.observation.text, /other private|proofSourceIds/);
  assert.equal(view.observation.kind, 'plan');
  await assert.rejects(read('director-wire-v9', true), /AGENT_REVISION_CONFLICT/);
});
test('old paid task keeps its exact directive projection and source hash despite marker-like task', async () => {
  const view = await read('director-wire-v8');
  const directive = { kind: 'director_future_task', authority: 'future_proposal_only', task };
  const expected = createHash('sha256')
    .update(
      authoredMaterialCanonicalJson({
        protocol: 'director-staging-intent-v1',
        worldId: 'world',
        actorId: 'actor-a',
        requestId: 'request-a',
        decisionId: 'decision-a',
        createdAtVersion: 1,
        basisSourceIds: [],
        directive,
      }),
    )
    .digest('hex');
  assert.equal(view.source.contentHash, expected);
  assert.doesNotMatch(view.observation.text, /ownKnownTopics/);
});
