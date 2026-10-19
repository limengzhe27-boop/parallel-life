import test from 'node:test';
import assert from 'node:assert/strict';
import type { SqlClient } from '../src/modules/storage/infrastructure/postgres.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import {
  readVerifiedPublicationGenesisEvidence,
  verifiedPublicationGenesisRecord,
} from '../src/modules/world/infrastructure/verified-publication-genesis-evidence.ts';
function fixture() {
  const sourceEventId = 'publication-genesis:w';
  const origin = {
    workId: 'work',
    publicationVersion: 1,
    draftVersion: 2,
    contentHash: 'a'.repeat(64),
  };
  const initial: WorldState = {
    schemaVersion: 1,
    id: 'w',
    ownerId: 'owner',
    version: 0,
    title: 'Synthetic',
    time: '2026-10-19T00:00:00.000Z',
    actors: [
      { id: 'a', name: 'A', persona: 'A' },
      { id: 'b', name: 'B', persona: 'B' },
    ],
    messages: [
      {
        id: 'ma',
        actorId: 'a',
        role: 'assistant',
        text: 'A private history',
        at: '2026-10-18T23:00:00.000Z',
        sourceEventId,
        history: { version: 1, key: 'ha' },
      },
      {
        id: 'ua',
        actorId: 'a',
        role: 'user',
        text: 'Player old reply to A',
        at: '2026-10-18T23:01:00.000Z',
        sourceEventId,
        history: { version: 1, key: 'hu' },
      },
      {
        id: 'mb',
        actorId: 'b',
        role: 'assistant',
        text: 'B private history',
        at: '2026-10-18T23:02:00.000Z',
        sourceEventId,
        history: { version: 1, key: 'hb' },
      },
      {
        id: 'future',
        actorId: 'a',
        role: 'assistant',
        text: 'Future must not leak',
        at: '2026-10-20T00:00:00.000Z',
        sourceEventId,
      },
    ],
    facts: [
      {
        id: 'fa',
        text: 'A only fact',
        visibility: { kind: 'actors', actorIds: ['a'] },
        kind: 'canonical',
        sourceEventId,
      },
      {
        id: 'fb',
        text: 'B only fact',
        visibility: { kind: 'actors', actorIds: ['b'] },
        kind: 'canonical',
        sourceEventId,
      },
      {
        id: 'fo',
        text: 'Owner only',
        visibility: { kind: 'owner' },
        kind: 'canonical',
        sourceEventId,
      },
      {
        id: 'fw',
        text: 'Public premise',
        visibility: { kind: 'world' },
        kind: 'canonical',
        sourceEventId,
      },
      {
        id: 'belief-a',
        text: 'A thinks this',
        visibility: { kind: 'world' },
        kind: 'belief',
        believedByActorId: 'a',
        sourceEventId,
      },
      {
        id: 'belief-b',
        text: 'B thinks this',
        visibility: { kind: 'world' },
        kind: 'belief',
        believedByActorId: 'b',
        sourceEventId,
      },
    ],
    appointments: [
      {
        id: 'aa',
        title: 'Proposed only',
        at: '2026-10-21T00:00:00Z',
        participantIds: ['a'],
        sourceEventId,
        status: 'proposed',
      },
      {
        id: 'ab',
        title: 'B proposal',
        at: '2026-10-21T00:00:00Z',
        participantIds: ['b'],
        sourceEventId,
        status: 'proposed',
      },
    ],
    mediaRequests: [],
  };
  const row = {
    identity: 'owner',
    version: 3,
    initial,
    approved_seed: {
      id: '00000000-0000-0000-0000-000000000000',
      source: { ...origin, kind: 'published_work' },
    },
    source: { origin, genesisSource: sourceEventId, initialFacts: initial.facts },
    origin: { ...origin, kind: 'published_work' },
  };
  const input = {
    worldId: 'w',
    actorId: 'a',
    worldVersion: 3,
    storyAt: '2026-10-19T00:01:00.000Z',
  };
  let queries = 0;
  const sql = {
    async query(text: string, values: unknown[]) {
      queries++;
      assert.match(text, /publication_story_source/);
      assert.match(text, /player_publication_origin/);
      assert.deepEqual(values, ['w', 'owner']);
      return { rows: [row] };
    },
  } as unknown as SqlClient;
  return { row, input, sql, queries: () => queries };
}
test('binds exact immutable publication genesis and exposes only own historical speech and visible facts', async () => {
  const f = fixture();
  const result = await readVerifiedPublicationGenesisEvidence(f.sql, 'owner', f.input);
  assert.ok(result);
  assert.deepEqual(
    result.messages.map((m) => m.id),
    ['ma', 'ua'],
  );
  assert.deepEqual(
    result.facts.map((m) => m.id),
    ['fa', 'fw', 'belief-a'],
  );
  assert.deepEqual(
    result.appointments.map((a) => a.id),
    ['aa'],
  );
  assert.equal(result.facts.find((f) => f.id === 'belief-a')?.kind, 'belief');
  assert.equal(result.appointments[0]!.status, 'proposed');
  assert.equal(f.queries(), 1);
});
test('record identity is exact content and actor scope, not a prefix or an existing id', async () => {
  const f = fixture();
  const result = await readVerifiedPublicationGenesisEvidence(f.sql, 'owner', f.input);
  assert.ok(result);
  const original = result.messages[0]!;
  assert.equal(verifiedPublicationGenesisRecord(result, 'message', original), true);
  assert.equal(
    verifiedPublicationGenesisRecord(result, 'message', { ...original, text: 'forged claim' }),
    false,
  );
  assert.equal(
    verifiedPublicationGenesisRecord(result, 'message', { ...original, actorId: 'b' }),
    false,
  );
  assert.equal(
    verifiedPublicationGenesisRecord(result, 'message', f.row.initial.messages[2]!),
    false,
  );
  assert.equal(verifiedPublicationGenesisRecord(null, 'message', original), false);
});
const denials: [string, (f: ReturnType<typeof fixture>) => void][] = [
  [
    'unbound world',
    (f) => {
      f.row.origin = null as never;
    },
  ],
  [
    'no authenticated story source',
    (f) => {
      f.row.source = null as never;
    },
  ],
  [
    'wrong transaction owner',
    (f) => {
      f.row.identity = 'someone-else';
    },
  ],
  [
    'wrong immutable owner',
    (f) => {
      f.row.initial.ownerId = 'someone-else';
    },
  ],
  [
    'wrong immutable world',
    (f) => {
      f.row.initial.id = 'other';
    },
  ],
  [
    'nonzero genesis',
    (f) => {
      f.row.initial.version = 1;
    },
  ],
  [
    'actor not in immutable cast',
    (f) => {
      f.input.actorId = 'unbound-actor';
    },
  ],
  [
    'version beyond stored world',
    (f) => {
      f.input.worldVersion = 4;
    },
  ],
  [
    'source origin mismatch',
    (f) => {
      f.row.source.origin = { ...f.row.source.origin, draftVersion: 3 };
    },
  ],
  [
    'approved seed origin mismatch',
    (f) => {
      f.row.approved_seed.source = { ...f.row.approved_seed.source, draftVersion: 3 };
    },
  ],
  [
    'fake genesis prefix',
    (f) => {
      f.row.source.genesisSource = 'publication-genesis:other';
    },
  ],
  [
    'fact payload mismatch',
    (f) => {
      f.row.source.initialFacts = [];
    },
  ],
  [
    'story before initial knowledge',
    (f) => {
      f.input.storyAt = '2026-10-18T00:00:00Z';
    },
  ],
];
for (const [name, mutate] of denials)
  test(`refuses ${name}`, async () => {
    const f = fixture();
    mutate(f);
    assert.equal(await readVerifiedPublicationGenesisEvidence(f.sql, 'owner', f.input), null);
  });
test('trial binding is authenticated against its own seed kind', async () => {
  const f = fixture();
  f.row.origin.kind = 'trial';
  f.row.approved_seed.source.kind = 'publication_trial';
  assert.ok(await readVerifiedPublicationGenesisEvidence(f.sql, 'owner', f.input));
});
