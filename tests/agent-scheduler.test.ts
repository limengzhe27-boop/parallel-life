import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleAgents,
  agentScopeBlocks,
  type RegisteredAgentCandidateSource,
  type ScheduleAgentsInput,
} from '../src/modules/world/application/schedule-agents.ts';
import type {
  AgentCandidate,
  AgentBlocker,
  AgentScope,
} from '../src/modules/world/domain/agent-runtime.ts';
import type {
  DirectorAgent,
  DirectorCoordination,
} from '../src/modules/world/application/agent-runtime-ports.ts';
const input = (): ScheduleAgentsInput => ({
  ownerId: 'owner',
  worldId: 'world',
  engineEpoch: 2,
  worldVersion: 7,
  actorRevisions: { a: 3, b: 4, c: 1 },
  storyAt: '2026-10-15T10:00:00.000Z',
  observations: [{ sourceId: 'visible-event', text: 'Authorized fictional observation' }],
});
const candidate = (
  id: string,
  actorId = 'a',
  patch: Partial<AgentCandidate> = {},
): AgentCandidate => ({
  id,
  worldId: 'world',
  actorId,
  source: 'responsibility',
  episodeId: null,
  actionId: id + '-action',
  resourceIds: [],
  channel: 'private',
  threadId: actorId + '-private',
  sourceIds: ['visible-event'],
  expectedWorldVersion: 7,
  expectedActorRevision: input().actorRevisions[actorId]!,
  priority: 1,
  reason: 'Unfinished sourced responsibility',
  requiresCoordination: false,
  ...patch,
});
const blocker = (scope: AgentScope): AgentBlocker => ({
  scope,
  reason: 'unknown_attempt',
  sourceId: 'uncertain-attempt',
  reconsiderOn: [],
});
function source(
  id: string,
  candidates: AgentCandidate[],
  blockers: AgentBlocker[] = [],
  failureScope: AgentScope = { kind: 'world' },
): RegisteredAgentCandidateSource {
  return {
    id,
    failureScope,
    source: {
      async collect() {
        return { candidates, blockers };
      },
    },
  };
}
function director(fn?: DirectorAgent['coordinate']) {
  let calls = 0;
  let seen: Parameters<DirectorAgent['coordinate']>[0] | undefined;
  const port: DirectorAgent = {
    async coordinate(snapshot) {
      calls++;
      seen = snapshot;
      return fn
        ? fn(snapshot)
        : {
            candidateIds: [snapshot.candidates[0]!.id],
            deferred: snapshot.candidates
              .slice(1)
              .map((c) => ({ candidateId: c.id, reason: 'Later' })),
            guidance: [],
            reason: 'A scoped coordination',
          };
    },
  };
  return { port, calls: () => calls, seen: () => seen };
}

test('collects every source even when an earlier source is quiet; selects stable highest priority without a director', async () => {
  const d = director(),
    collected: string[] = [];
  const sources = [
    source('opening', []),
    source('authored', []),
    source('ordinary', [candidate('z', 'b'), candidate('a', 'a', { priority: 9 })]),
  ];
  for (const s of sources) {
    const collect = s.source.collect;
    s.source.collect = async (...args) => {
      collected.push(s.id);
      return collect(...args);
    };
  }
  const result = await scheduleAgents({ sources, director: d.port }, input());
  assert.deepEqual(collected.sort(), ['authored', 'opening', 'ordinary']);
  assert.equal(result.status, 'selected');
  assert.equal(result.selected[0]!.candidate.id, 'a');
  assert.equal(d.calls(), 0);
  assert.deepEqual(result.deferred, [{ candidateId: 'z', reason: 'lower_priority' }]);
});

test('all six blocker scopes match only the declared responsibility resources', async (t) => {
  const a = candidate('a', 'a', {
    episodeId: 'episode-a',
    resourceIds: ['table-a'],
    channel: 'group',
    threadId: 'group-a',
  });
  const cases: AgentScope[] = [
    { kind: 'world' },
    { kind: 'actor', actorId: 'a' },
    { kind: 'episode', episodeId: 'episode-a' },
    { kind: 'action', actionId: 'a-action' },
    { kind: 'resource', resourceId: 'table-a' },
    { kind: 'channel', channel: 'group', threadId: 'group-a' },
  ];
  for (const scope of cases)
    await t.test(scope.kind, async () => {
      const b = candidate('b', 'b');
      const d = director();
      const result = await scheduleAgents(
        { sources: [source('all', [a, b], [blocker(scope)])], director: d.port },
        input(),
      );
      assert.equal(
        result.blocked.some((v) => v.candidate.id === 'a'),
        true,
      );
      assert.equal(result.selected[0]?.candidate.id, scope.kind === 'world' ? undefined : 'b');
      assert.equal(d.calls(), 0);
    });
  assert.equal(
    agentScopeBlocks({ kind: 'channel', channel: 'scene', threadId: 'group-a' }, a),
    false,
  );
  assert.equal(agentScopeBlocks({ kind: 'episode', episodeId: 'elsewhere' }, a), false);
});

test('an unknown opening delivery for B does not block A early reply in the same episode', async () => {
  const d = director();
  const result = await scheduleAgents(
    {
      sources: [
        source(
          'opening',
          [candidate('opening-b', 'b', { episodeId: 'opening', source: 'opening' })],
          [blocker({ kind: 'actor', actorId: 'b' })],
        ),
        source('reply', [
          candidate('reply-a', 'a', { source: 'conversation', episodeId: 'opening', priority: 20 }),
        ]),
      ],
      director: d.port,
    },
    input(),
  );
  assert.equal(result.selected[0]!.candidate.id, 'reply-a');
  assert.equal(d.calls(), 0);
  assert.equal(result.blocked[0]!.candidate.id, 'opening-b');
});

test('a failed actor source is explicit and contained; no retry or raw error disclosure', async () => {
  let attempts = 0;
  const d = director();
  const failed: RegisteredAgentCandidateSource = {
    id: 'b-reader',
    failureScope: { kind: 'actor', actorId: 'b' },
    source: {
      async collect() {
        attempts++;
        throw Error('PRIVATE upstream detail');
      },
    },
  };
  const result = await scheduleAgents(
    { sources: [failed, source('other', [candidate('a'), candidate('b', 'b')])], director: d.port },
    input(),
  );
  assert.equal(attempts, 1);
  assert.equal(d.calls(), 0);
  assert.equal(result.selected[0]!.candidate.id, 'a');
  assert.deepEqual(result.sourceFailures, [
    { sourceId: 'b-reader', scope: { kind: 'actor', actorId: 'b' }, reason: 'collection_failed' },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|upstream/);
});

test('failure of world authority safely blocks all claims while other readers still run', async () => {
  let otherRead = false;
  const d = director();
  const sources = [source('authority', []), source('actor', [candidate('a')])];
  sources[0]!.source.collect = async () => {
    throw Error('offline');
  };
  sources[1]!.source.collect = async () => {
    otherRead = true;
    return { candidates: [candidate('a')], blockers: [] };
  };
  const result = await scheduleAgents({ sources, director: d.port }, input());
  assert.equal(otherRead, true);
  assert.equal(result.reason, 'blocked');
  assert.equal(result.selected.length, 0);
  assert.equal(d.calls(), 0);
  assert.equal(result.sourceFailures.length, 1);
});

test('foreign or malformed collection cannot inject candidates or use legacy handled short-circuit', async () => {
  const d = director();
  const bad = source('bad', [], [], { kind: 'actor', actorId: 'b' });
  bad.source.collect = async () => ({
    candidates: [candidate('foreign', 'b', { worldId: 'foreign-world' })],
    blockers: [],
    handled: true,
  });
  const result = await scheduleAgents(
    { sources: [bad, source('good', [candidate('a')])], director: d.port },
    input(),
  );
  assert.equal(result.selected[0]!.candidate.id, 'a');
  assert.equal(result.sourceFailures[0]!.reason, 'invalid_collection');
  assert(!JSON.stringify(result).includes('foreign-world'));
});

test('stale world or actor read versions are not selected, rebased or sent to director', async () => {
  const d = director();
  const result = await scheduleAgents(
    {
      sources: [
        source('old', [
          candidate('world-old', 'a', { expectedWorldVersion: 6, requiresCoordination: true }),
          candidate('actor-old', 'b', { expectedActorRevision: 3 }),
        ]),
      ],
      director: d.port,
    },
    input(),
  );
  assert.equal(result.reason, 'stale_candidates');
  assert.equal(result.selected.length, 0);
  assert.equal(d.calls(), 0);
  assert.deepEqual(
    result.deferred.map((v) => v.candidateId),
    ['actor-old', 'world-old'],
  );
});

test('identical duplicate candidates deduplicate; incompatible duplicate IDs cannot pick an arbitrary source', async () => {
  const d = director();
  const repeated = await scheduleAgents(
    {
      sources: [source('b', [candidate('same')]), source('a', [candidate('same')])],
      director: d.port,
    },
    input(),
  );
  assert.equal(repeated.snapshot.candidates.length, 1);
  const conflict = await scheduleAgents(
    {
      sources: [
        source('b', [candidate('same', 'a', { priority: 9 })]),
        source('a', [candidate('same')]),
      ],
      director: d.port,
    },
    input(),
  );
  assert.equal(conflict.reason, 'conflicting_candidates');
  assert.equal(conflict.selected.length, 0);
  assert.equal(d.calls(), 0);
});

test('priority ties are stable despite source registration or completion order', async () => {
  const d = director();
  const a = source('z-source', [candidate('a')]),
    b = source('a-source', [candidate('b', 'b')]);
  const first = await scheduleAgents({ sources: [a, b], director: d.port }, input());
  const second = await scheduleAgents({ sources: [b, a], director: d.port }, input());
  assert.deepEqual(first, second);
  assert.equal(first.selected[0]!.candidate.id, 'a');
});

test('single uncoordinated work invokes director exactly once and passes the canonical candidate to claim', async () => {
  const c = candidate('a', 'a', { requiresCoordination: true });
  const d = director(async ({ candidates }) => ({
    candidateIds: [candidates[0]!.id],
    deferred: [],
    guidance: [
      { actorId: 'a', candidateId: 'a', intent: 'Consider your own current responsibility' },
    ],
    reason: 'Needs coordination',
  }));
  const result = await scheduleAgents(
    { sources: [source('actor', [c])], director: d.port },
    input(),
  );
  assert.equal(d.calls(), 1);
  assert.equal(result.selected[0]!.candidate, d.seen()!.candidates[0]);
  assert.deepEqual(result.selected[0]!.readVersion, {
    engineEpoch: 2,
    worldVersion: 7,
    actorRevision: 3,
  });
  assert.equal(Object.isFrozen(result.selected[0]!.candidate.sourceIds), true);
  assert.equal(Object.isFrozen(d.seen()!.candidates), true);
  assert.equal(result.selected[0]!.guidance[0]!.actorId, 'a');
});

test('cross-actor shared episode, resource and group/scene thread require one coordination', async (t) => {
  const pairs: [Partial<AgentCandidate>, Partial<AgentCandidate>][] = [
    [{ episodeId: 'shared' }, { episodeId: 'shared' }],
    [{ resourceIds: ['shared'] }, { resourceIds: ['shared'] }],
    [
      { channel: 'group', threadId: 'shared' },
      { channel: 'group', threadId: 'shared' },
    ],
    [
      { channel: 'scene', threadId: 'shared' },
      { channel: 'scene', threadId: 'shared' },
    ],
  ];
  for (const [left, right] of pairs)
    await t.test(JSON.stringify(left), async () => {
      const d = director();
      await scheduleAgents(
        {
          sources: [source('both', [candidate('a', 'a', left), candidate('b', 'b', right)])],
          director: d.port,
        },
        input(),
      );
      assert.equal(d.calls(), 1);
    });
});

test('director ordered plans yield only the first claim; all later claims need a new snapshot', async () => {
  const d = director(async () => ({
    candidateIds: ['b', 'a'],
    deferred: [],
    guidance: [{ actorId: 'b', candidateId: 'b', intent: 'Resolve the shared resource first' }],
    reason: 'Causal order',
  }));
  const sources = [
    source('both', [
      candidate('a', 'a', { priority: 9, episodeId: 'shared' }),
      candidate('b', 'b', { episodeId: 'shared' }),
    ]),
  ];
  const result = await scheduleAgents({ sources, director: d.port }, input());
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0]!.candidate.id, 'b');
  assert.deepEqual(result.deferred, [{ candidateId: 'a', reason: 'next_snapshot_required' }]);
  const later = await scheduleAgents(
    { sources, director: d.port },
    { ...input(), worldVersion: 8 },
  );
  assert.equal(later.reason, 'stale_candidates');
  assert.equal(d.calls(), 1);
});

test('invalid director choices and guidance are rejected without deterministic or paid retry fallback', async (t) => {
  const invalid: unknown[] = [
    { candidateIds: ['foreign'], deferred: [], guidance: [], reason: 'bad' },
    { candidateIds: ['a', 'a'], deferred: [], guidance: [], reason: 'bad' },
    {
      candidateIds: ['a'],
      deferred: [{ candidateId: 'a', reason: 'both' }],
      guidance: [],
      reason: 'bad',
    },
    { candidateIds: [], deferred: [], guidance: [], reason: 'silent omission' },
    {
      candidateIds: ['a'],
      deferred: [],
      guidance: [{ actorId: 'b', candidateId: 'a', intent: 'Wrong owner' }],
      reason: 'bad',
    },
    {
      candidateIds: ['a'],
      deferred: [],
      guidance: [{ actorId: 'a', candidateId: 'a', intent: 'A plan', text: 'Final NPC speech' }],
      reason: 'bad',
    },
    {
      candidateIds: ['a'],
      deferred: [],
      guidance: [],
      reason: 'bad',
      statements: [{ text: 'Director must not write this' }],
    },
    { candidateIds: ['a'], deferred: [], guidance: [], reason: ' ' },
  ];
  for (const raw of invalid)
    await t.test(JSON.stringify(raw), async () => {
      const d = director(async () => raw as DirectorCoordination);
      const result = await scheduleAgents(
        {
          sources: [source('one', [candidate('a', 'a', { requiresCoordination: true })])],
          director: d.port,
        },
        input(),
      );
      assert.equal(result.reason, 'invalid_coordination');
      assert.equal(result.selected.length, 0);
      assert.equal(d.calls(), 1);
    });
});

test('blocked IDs are never eligible director choices', async () => {
  const d = director(async () => ({
    candidateIds: ['b'],
    deferred: [{ candidateId: 'a', reason: 'later' }],
    guidance: [],
    reason: 'bad',
  }));
  const result = await scheduleAgents(
    {
      sources: [
        source(
          'both',
          [candidate('a', 'a', { requiresCoordination: true }), candidate('b', 'b')],
          [blocker({ kind: 'actor', actorId: 'b' })],
        ),
      ],
      director: d.port,
    },
    input(),
  );
  assert.equal(d.seen()!.candidates.length, 1);
  assert.equal(result.reason, 'invalid_coordination');
});

test('valid director deferral is explicit; failure is known operational quiet with no automatic retry', async () => {
  const one = [source('one', [candidate('a', 'a', { requiresCoordination: true })])];
  const deferred = director(async () => ({
    candidateIds: [],
    deferred: [{ candidateId: 'a', reason: 'Await the existing result' }],
    guidance: [],
    reason: 'Nothing safe to dispatch yet',
  }));
  assert.equal(
    (await scheduleAgents({ sources: one, director: deferred.port }, input())).reason,
    'director_deferred',
  );
  const failed = director(async () => {
    throw Error('SECRET model detail');
  });
  const result = await scheduleAgents({ sources: one, director: failed.port }, input());
  assert.equal(result.reason, 'coordination_failed');
  assert.equal(failed.calls(), 1);
  assert.equal(result.selected.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});

test('director cannot mutate its snapshot to legitimize another candidate', async () => {
  const d = director(async (snapshot) => {
    snapshot.candidates.push(candidate('injected'));
    throw Error('must not reach');
  });
  const result = await scheduleAgents(
    {
      sources: [source('one', [candidate('a', 'a', { requiresCoordination: true })])],
      director: d.port,
    },
    input(),
  );
  assert.equal(result.reason, 'coordination_failed');
  assert.equal(result.snapshot.candidates.length, 1);
  assert.equal(d.calls(), 1);
});

test('captures caller inputs before asynchronous collection and leaves caller candidates unchanged', async () => {
  const original = input();
  const c = candidate('a', 'a', { requiresCoordination: true });
  const d = director();
  const provider = source('one', [c]);
  provider.source.collect = async () => {
    original.worldVersion = 99;
    return { candidates: [c], blockers: [] };
  };
  const result = await scheduleAgents({ sources: [provider], director: d.port }, original);
  assert.equal(result.snapshot.worldVersion, 7);
  assert.equal(d.seen()!.worldVersion, 7);
  assert.equal(Object.isFrozen(c), false);
  assert.notEqual(result.selected[0]!.candidate, c);
});

test('invalid pass configuration fails before any port call and empty pass explains quiet', async () => {
  const d = director();
  const s = source('one', [candidate('a')]);
  let reads = 0;
  s.source.collect = async () => {
    reads++;
    return { candidates: [], blockers: [] };
  };
  await assert.rejects(scheduleAgents({ sources: [s, s], director: d.port }, input()), {
    code: 'INVALID_COMMAND',
  });
  await assert.rejects(
    scheduleAgents({ sources: [s], director: d.port }, { ...input(), worldVersion: Number.NaN }),
    { code: 'INVALID_COMMAND' },
  );
  assert.equal(reads, 0);
  assert.equal(d.calls(), 0);
  assert.equal(
    (await scheduleAgents({ sources: [], director: d.port }, input())).reason,
    'no_candidates',
  );
});
