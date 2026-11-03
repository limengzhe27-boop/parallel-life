import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';
import { retainedActorEpisodeRequestIds } from '../src/modules/world/infrastructure/actor-episode-intent-repository.ts';

test('only this actor ongoing participation retains a private brief, without reopening quiet/refused work', () => {
  const snapshot = {
    channel: { kind: 'private' },
    episodeFollowUps: [
      { requestId: 'accepted', choice: 'engage', followUp: 'none' },
      { requestId: 'waiting', choice: 'defer', followUp: 'open' },
      { requestId: 'information', choice: 'need_information', followUp: 'open' },
      { requestId: 'finished', choice: 'engage', followUp: 'terminal' },
      { requestId: 'refused', choice: 'decline', followUp: 'none' },
      { requestId: 'quiet', choice: 'quiet', followUp: 'none' },
    ],
  } as AgentSnapshot;
  assert.deepEqual(retainedActorEpisodeRequestIds(snapshot), [
    'accepted',
    'waiting',
    'information',
  ]);
  for (const kind of ['group', 'scene'] as const) {
    assert.deepEqual(
      retainedActorEpisodeRequestIds({ ...snapshot, channel: { ...snapshot.channel, kind } }),
      [],
    );
  }
  assert.deepEqual(
    retainedActorEpisodeRequestIds({ ...snapshot, episodeFollowUps: undefined }),
    [],
  );
});

test('retained confirmed participation keeps material while pending/terminal and other channels stay untouched', async () => {
  const { retainedActorEpisodeObservation } =
    await import('../src/modules/world/infrastructure/actor-episode-intent-repository.ts');
  const observation = {
    sourceId: 'source',
    kind: 'plan' as const,
    text: 'Author suggestion addressed only to you. Consider it using your own position; it is not an event, verified fact, obligation, deadline or player agreement: {"privateMaterial":"original"} place hint',
  };
  const snapshot = {
    channel: { kind: 'private' },
    episodeFollowUps: [{ requestId: 'r', choice: 'engage', followUp: 'none' }],
  } as AgentSnapshot;
  const result = retainedActorEpisodeObservation(snapshot, 'r', observation);
  assert.match(result.text, /^你已自主选择参与/);
  assert.ok(result.text.endsWith('{"privateMaterial":"original"} place hint'));
  assert.equal(result.sourceId, observation.sourceId);
  for (const choice of ['defer', 'need_information', 'decline', 'quiet'] as const) {
    assert.equal(
      retainedActorEpisodeObservation(
        { ...snapshot, episodeFollowUps: [{ ...snapshot.episodeFollowUps![0]!, choice }] },
        'r',
        observation,
      ),
      observation,
    );
  }
  assert.equal(
    retainedActorEpisodeObservation(
      {
        ...snapshot,
        episodeFollowUps: [{ ...snapshot.episodeFollowUps![0]!, followUp: 'terminal' }],
      },
      'r',
      observation,
    ),
    observation,
  );
  assert.equal(
    retainedActorEpisodeObservation(
      { ...snapshot, channel: { ...snapshot.channel, kind: 'group' } },
      'r',
      observation,
    ),
    observation,
  );
});
