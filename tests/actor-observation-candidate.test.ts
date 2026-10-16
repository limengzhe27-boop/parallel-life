import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectPendingSceneObservationCandidates as collect,
  type ActorObservationCandidateInput,
} from '../src/modules/world/domain/actor-observation-candidate.ts';

function fixture(): ActorObservationCandidateInput {
  return {
    worldId: 'world',
    actorId: 'actor',
    engineEpoch: 2,
    worldVersion: 5,
    actorRevision: 3,
    storyAt: '2026-10-16T08:00:00.000Z',
    sources: [
      {
        id: 'scene:entry',
        kind: 'scene_entry',
        recordId: 'entry',
        worldVersion: 5,
        at: '2026-10-16T08:00:00.000Z',
        contentHash: 'a'.repeat(64),
        usage: 'channel_context',
      },
    ],
    consumed: [],
  };
}

test('same-commit source remains pending without an actual supplied-source receipt', async () => {
  const input = fixture();
  const candidates = await collect(input);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.source, 'observation');
  assert.equal(candidates[0]!.channel, 'private');
  assert.equal(candidates[0]!.threadId, input.actorId);
  assert.equal(candidates[0]!.episodeId, null);
  assert.equal(candidates[0]!.actionId, null);
  assert.deepEqual(candidates[0]!.sourceIds, ['scene:entry']);
});

test('unrelated world/revision/time changes update CAS fields but not candidate identity', async () => {
  const input = fixture();
  const first = (await collect(input))[0]!;
  input.worldVersion = 9;
  input.actorRevision = 7;
  input.storyAt = '2026-10-16T09:00:00.000Z';
  const later = (await collect(input))[0]!;
  assert.equal(later.id, first.id);
  assert.equal(later.expectedWorldVersion, 9);
  assert.equal(later.expectedActorRevision, 7);
});

test('only exact source and content hash consumption removes a candidate', async () => {
  const input = fixture();
  input.consumed = [{ sourceId: 'scene:entry', contentHash: 'b'.repeat(64) }];
  assert.equal((await collect(input)).length, 1);
  input.consumed = [{ sourceId: 'scene:entry', contentHash: 'a'.repeat(64) }];
  assert.deepEqual(await collect(input), []);
});

test('source content, actor, epoch and world each define a distinct consideration identity', async () => {
  const input = fixture();
  const ids = new Set([(await collect(input))[0]!.id]);
  for (const patch of [{ actorId: 'other-actor' }, { worldId: 'other-world' }, { engineEpoch: 3 }])
    ids.add((await collect({ ...input, ...patch }))[0]!.id);
  const changed = structuredClone(input);
  changed.sources[0]!.contentHash = 'b'.repeat(64);
  ids.add((await collect(changed))[0]!.id);
  assert.equal(ids.size, 5);
});

test('private strategy placeholders and other source kinds never become scene observation candidates', async () => {
  const input = fixture();
  input.sources = [
    { ...input.sources[0]!, usage: 'private_strategy' },
    {
      id: 'event:other',
      kind: 'world_event',
      recordId: 'other',
      worldVersion: 1,
      at: input.storyAt,
    },
  ];
  assert.deepEqual(await collect(input), []);
});

test('authorized full private recall remains eligible while a generic strategy sentence does not', async () => {
  const input = fixture();
  input.sources[0]!.usage = 'private_strategy';
  input.observations = [{ sourceId: 'scene:entry', text: '此来源支持本人原有策略。' }];
  assert.deepEqual(await collect(input), []);
  input.observations = [
    { sourceId: 'scene:entry', text: '原现场的一段获准原文。', evidenceKind: 'scene_record' },
  ];
  assert.equal((await collect(input)).length, 1);
});

test('duplicate identical packets are one candidate; conflicting same-ID hashes are rejected', async () => {
  const input = fixture();
  input.sources = [input.sources[0]!, structuredClone(input.sources[0]!)];
  assert.equal((await collect(input)).length, 1);
  input.sources[1]!.contentHash = 'b'.repeat(64);
  await assert.rejects(collect(input), { code: 'ACTOR_OBSERVATION_CANDIDATE_INVALID' });
});

test('old or malformed source proofs cannot be promoted into a fresh scheduling identity', async () => {
  for (const patch of [
    { contentHash: undefined },
    { contentHash: 'invalid' },
    { worldVersion: 6 },
    { at: '2026-10-16T09:00:00.000Z' },
    { id: 'scene:wrong' },
  ]) {
    const input = fixture();
    Object.assign(input.sources[0]!, patch);
    await assert.rejects(collect(input), { code: 'ACTOR_OBSERVATION_CANDIDATE_INVALID' });
  }
  await assert.rejects(collect({ ...fixture(), engineEpoch: 1 }), {
    code: 'ACTOR_OBSERVATION_CANDIDATE_INVALID',
  });
});

test('ordering is deterministic and the function neither mutates input nor forces speech or completion', async () => {
  const input = fixture();
  input.sources = [
    { ...input.sources[0]!, id: 'scene:z', recordId: 'z' },
    { ...input.sources[0]!, id: 'scene:a', recordId: 'a' },
  ];
  const before = structuredClone(input);
  const candidates = await collect(input);
  assert.deepEqual(
    candidates.map((c) => c.sourceIds[0]),
    ['scene:a', 'scene:z'],
  );
  assert.deepEqual(input, before);
  assert.ok(candidates.every((c) => !('statements' in c) && !('result' in c)));
  assert.ok(candidates.every((c) => c.reason.includes('保持安静')));
});
