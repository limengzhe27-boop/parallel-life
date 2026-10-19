import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';
import { authoredMaterialCanonicalJson } from '../src/modules/world/domain/authored-agent-material.ts';
import { readActorNarrativeObservationSourcesInTransaction as read } from '../src/modules/world/infrastructure/actor-narrative-observation-sources.ts';
import { collectPendingSceneObservationCandidates as collect } from '../src/modules/world/domain/actor-observation-candidate.ts';
const at = '2026-10-20T08:00:00.000Z',
  learned = '2026-10-20T08:01:00.000Z';
const frame = { worldId: 'world', actorId: 'actor', worldVersion: 3, storyAt: learned };
function row() {
  const basis = {
    policy: 'opening_context_v1',
    nodeKey: 'opening',
    nodeHash: 'n'.repeat(64),
    sourceHash: 's'.repeat(64),
    field: 'script',
    quote: 'server only author passage',
    knowledge: { actorId: 'actor', module: 'lifeContext', quote: 'server only personal passage' },
    decisionId: 'decision',
  };
  const text = 'The existing shop is closed today.';
  const fact = {
    id: 'fact',
    kind: 'canonical',
    narrativeContext: { policy: 'opening_context_v1', knowledgeId: 'knowledge', sourceVersion: 3 },
    text,
    visibility: { kind: 'actors', actorIds: ['actor'] },
    sourceEventId: 'event',
  };
  const proof = {
    protocol: 'narrative-knowledge-v1',
    worldId: 'world',
    actorId: 'actor',
    factId: 'fact',
    sourceEventId: 'event',
    sourceVersion: 3,
    occurredAt: at,
    learnedAt: learned,
    method: 'authored_initial_context',
    basis,
    text,
  };
  return {
    id: 'knowledge',
    world_id: 'world',
    owner_id: 'owner',
    actor_id: 'actor',
    fact_id: 'fact',
    source_event_id: 'event',
    source_version: 3,
    occurred_at: at,
    learned_at: learned,
    method: 'authored_initial_context',
    basis,
    content_hash: createHash('sha256').update(authoredMaterialCanonicalJson(proof)).digest('hex'),
    fact,
    event_version: 3,
    command_status: 'succeeded',
    result_event_id: 'event',
    expected_version: 2,
    event: {
      id: 'event',
      worldId: 'world',
      version: 3,
      type: 'narrative.context_confirmed',
      data: {
        directorDecisionId: 'decision',
        engineEpoch: 2,
        premises: [
          { factId: 'fact', actorId: 'actor', text, occurredAt: at, learnedAt: learned, basis },
        ],
      },
    },
  };
}
const sql = (r: unknown) =>
  ({
    query: async (q: string) => ({
      rows: q.includes('FROM parallel_life.memory_records') ? [] : [r],
    }),
  }) as unknown as SqlClient;
test('authenticated packet separates time and reveals no author quotes or other private material', async () => {
  const p = await read(sql(row()), 'owner', frame);
  assert.equal(p.sources.length, 1);
  assert.equal(p.sources[0]!.id, 'narrative:knowledge');
  assert.equal(p.sources[0]!.at, learned);
  assert.equal(p.observations[0]!.evidenceKind, 'authored_context');
  assert.equal(p.observations[0]!.kind, 'fact');
  assert.doesNotMatch(JSON.stringify(p), /server only|nodeHash|decisionId/);
  assert.deepEqual(JSON.parse(p.observations[0]!.text), {
    text: row().fact.text,
    occurredAt: at,
    learnedAt: learned,
    method: 'authored_initial_context',
  });
});
test('reject mismatched ownership, fact visibility, canonical type, command, event premise, times and hash', async () => {
  const variants = [
    (r: any) => (r.actor_id = 'other'),
    (r: any) => r.fact.visibility.actorIds.push('other'),
    (r: any) => (r.fact.kind = 'belief'),
    (r: any) => (r.command_status = 'failed'),
    (r: any) => (r.event.data.premises[0].text = 'forged'),
    (r: any) => (r.learned_at = at),
    (r: any) => (r.content_hash = '0'.repeat(64)),
  ];
  for (const change of variants) {
    const r = row();
    change(r);
    await assert.rejects(read(sql(r), 'owner', frame), /ACTOR_NARRATIVE_OBSERVATION_PROOF_INVALID/);
  }
});
test('narrative observation wakes once per actor/source hash, not per clock/revision; generic facts cannot masquerade', async () => {
  const p = await read(sql(row()), 'owner', frame);
  const input = { ...frame, engineEpoch: 2, actorRevision: 0, ...p, consumed: [] };
  const first = await collect(input);
  assert.equal(first.length, 1);
  const later = await collect({
    ...input,
    worldVersion: 8,
    actorRevision: 9,
    storyAt: '2026-10-20T09:00:00Z',
  });
  assert.equal(first[0]!.id, later[0]!.id);
  assert.deepEqual(
    await collect({
      ...input,
      consumed: [{ sourceId: p.sources[0]!.id, contentHash: p.sources[0]!.contentHash! }],
    }),
    [],
  );
  assert.deepEqual(await collect({ ...input, observations: [] }), []);
  assert.deepEqual(
    await collect({ ...input, sources: p.sources.map((s) => ({ ...s, id: 'fact:knowledge' })) }),
    [],
  );
});

test('only an exact actually supplied committed private completion acknowledges narrative knowledge', async () => {
  const { readConsumedSceneObservationSourcesInTransaction: consumed } =
    await import('../src/modules/world/infrastructure/actor-observation-consumption-repository.ts');
  const packet = await read(sql(row()), 'owner', frame),
    source = packet.sources[0]!;
  const input = {
    id: 'input',
    worldId: 'world',
    inputHash: 'input-hash',
    recipientActorId: 'actor',
    channel: 'private',
    threadId: 'actor',
    text: 'wake',
    origin: 'wake',
    expectedWorldVersion: 3,
    storyAt: learned,
  };
  const snapshot = {
    worldVersion: 3,
    storyAt: learned,
    state: { worldId: 'world', actorId: 'actor', revision: 0 },
    input: { sourceId: 'input', text: 'wake', origin: 'wake' },
    channel: { kind: 'private', threadId: 'actor' },
    sources: packet.sources,
    observations: packet.observations,
    actorObservationInbox: {
      sourceIds: [source.id],
      sceneIds: [],
      groupIds: [],
      narrativeKnowledgeIds: [source.recordId],
      omittedSourceIds: [],
    },
  };
  const completion = {
    kind: 'npc_agent_completion',
    schemaVersion: 1,
    snapshot,
    response: '{}',
    suppliedContext: {
      schemaVersion: 1,
      promptVersion: 'test',
      modelInputHash: 'a'.repeat(64),
      observations: [{ sourceId: source.id, contentHash: source.contentHash }],
    },
  };
  const attempt = {
    response: completion,
    response_hash: createHash('sha256')
      .update(authoredMaterialCanonicalJson(completion))
      .digest('hex'),
    expected_world_version: 3,
    expected_actor_revision: 0,
    input_receipt_id: 'input',
    input_hash: 'input-hash',
    accepted_input: input,
    event_id: 'commit',
    command_id: 'command',
    committed_version: 4,
    committed_event: {
      worldId: 'world',
      id: 'commit',
      commandId: 'command',
      version: 4,
      data: {
        actorId: 'actor',
        agentRuntime: {
          engineEpoch: 2,
          inputReceiptId: 'input',
          inputWorldVersion: 3,
          inputStoryAt: learned,
          actorRevisionBefore: 0,
          actorRevisionAfter: 1,
          stateAfter: { worldId: 'world', actorId: 'actor', revision: 1, projectedWorldVersion: 4 },
        },
      },
    },
  };
  let stored = attempt;
  const db = {
    query: async (q: string) => {
      if (q.includes('SELECT w.version'))
        return {
          rows: [
            {
              version: 4,
              engine_epoch: 2,
              state: { id: 'world', ownerId: 'owner', actors: [{ id: 'actor' }] },
            },
          ],
        };
      if (q.includes('FROM parallel_life.agent_attempts')) return { rows: [stored] };
      if (q.includes('FROM parallel_life.memory_records')) return { rows: [] };
      if (q.includes('actor_narrative_knowledge')) return { rows: [row()] };
      throw Error('unexpected query');
    },
  } as unknown as SqlClient;
  assert.deepEqual(await consumed(db, 'owner', { ...frame, worldVersion: 4, engineEpoch: 2 }), [
    { sourceId: source.id, contentHash: source.contentHash },
  ]);
  stored = structuredClone(attempt);
  stored.response.suppliedContext.observations = [];
  assert.deepEqual(await consumed(db, 'owner', { ...frame, worldVersion: 4, engineEpoch: 2 }), []);
  stored = structuredClone(attempt);
  stored.response_hash = '0'.repeat(64);
  await assert.rejects(
    consumed(db, 'owner', { ...frame, worldVersion: 4, engineEpoch: 2 }),
    /CONSUMPTION_PROOF_INVALID/,
  );
});
