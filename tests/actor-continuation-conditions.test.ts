import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentScheduleSources,
  type SchedulingView,
} from '../src/modules/world/application/agent-schedule-collectors.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';
const at = '2026-10-20T12:00:00.000Z',
  before = '2026-10-20T11:00:00.000Z';
function fixture() {
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'a' }, 'definition', 1);
  state.continuation = {
    version: 1,
    decision: 'await_condition',
    reason: 'An existing reply window will close.',
    sourceIds: ['old-input'],
    planIds: [],
    questionIds: [],
    conditions: [{ kind: 'at_or_after', at, sourceId: 'deadline' }],
    sourceInputId: 'old-input',
    decidedAt: before,
    basisHash: 'fixed',
  };
  const snapshot: AgentSnapshot = {
    state,
    viewState: structuredClone(state),
    redactedStateIds: [],
    worldVersion: 1,
    storyAt: before,
    actor: { name: 'A', persona: 'Independent', boundaries: '', definitionRef: 'definition' },
    sources: [
      {
        id: 'deadline',
        kind: 'authored',
        recordId: 'window',
        worldVersion: 0,
        at: before,
        deadlineAt: at,
      },
    ],
    observations: [],
    channel: { kind: 'private', threadId: 'a', audienceActorIds: ['a'], allowedCapabilities: [] },
    input: { sourceId: 'input', origin: 'wake', text: '' },
  };
  const view: SchedulingView = {
    worldId: 'w',
    engineEpoch: 2,
    worldVersion: 1,
    storyAt: before,
    actors: [{ snapshot, trustedResults: [], appointments: [] }],
    activeAttempts: [],
    consumedCandidateIds: [],
  };
  return { snapshot, view };
}
async function collect(view: SchedulingView) {
  return (
    await Promise.all(
      createAgentScheduleSources(view)
        .filter((s) => s.id.startsWith('actor_plan:'))
        .map((s) => s.source.collect('owner', 'w')),
    )
  ).flatMap((r) => r.candidates);
}
function advance(f: ReturnType<typeof fixture>) {
  f.view.storyAt = at;
  f.snapshot.storyAt = at;
}
test('time condition matures with unchanged actor basis, then quiet/ticks cannot rename consumed work', async () => {
  const f = fixture();
  assert.equal((await collect(f.view)).length, 0);
  advance(f);
  const [candidate] = await collect(f.view);
  assert.ok(candidate);
  assert.equal(candidate.source, 'actor_plan');
  assert.deepEqual(candidate.sourceIds, ['deadline']);
  const oldHash = f.snapshot.state.continuation!.basisHash;
  f.snapshot.state.revision++;
  f.snapshot.state.projectedWorldVersion++;
  f.snapshot.worldVersion++;
  f.view.worldVersion++;
  Object.assign(f.snapshot.state.continuation!, {
    sourceInputId: 'new-quiet-input',
    sourceIds: ['new-quiet-input'],
    decidedAt: at,
    reason: 'Still waiting',
    basisHash: 'new-quiet-hash',
  });
  f.snapshot.viewState = structuredClone(f.snapshot.state);
  assert.notEqual(f.snapshot.state.continuation!.basisHash, oldHash);
  assert.equal((await collect(f.view))[0]!.id, candidate.id);
  f.view.consumedCandidateIds = [candidate.id];
  assert.equal((await collect(f.view)).length, 0);
});
test('a fresh real observation source is a new condition but a quiet accepted-input is not', async () => {
  const f = fixture();
  advance(f);
  f.snapshot.state.continuation!.conditions = [{ kind: 'observation', sourceId: 'fact-1' }];
  f.snapshot.sources.push({
    id: 'fact-1',
    kind: 'world_event',
    recordId: 'event-1',
    worldVersion: 1,
    at,
  });
  f.snapshot.viewState = structuredClone(f.snapshot.state);
  f.snapshot.observations.push({
    sourceId: 'fact-1',
    kind: 'fact',
    text: 'First authorized observation',
  });
  const [one] = await collect(f.view);
  assert.ok(one);
  f.view.consumedCandidateIds = [one.id];
  f.snapshot.state.continuation!.conditions = [{ kind: 'observation', sourceId: 'fact-2' }];
  f.snapshot.sources.push({
    id: 'fact-2',
    kind: 'world_event',
    recordId: 'event-2',
    worldVersion: 1,
    at,
  });
  f.snapshot.viewState = structuredClone(f.snapshot.state);
  f.snapshot.observations.push({
    sourceId: 'fact-2',
    kind: 'fact',
    text: 'New authorized observation',
  });
  assert.notEqual((await collect(f.view))[0]!.id, one.id);
  f.snapshot.sources.find((s) => s.id === 'fact-2')!.kind = 'accepted_input';
  assert.equal((await collect(f.view)).length, 0);
});
test('unknown scope, forged projection and unsupported hard deadline do not wake', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.snapshot.sources = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.snapshot.channel.kind = 'group';
    },
    (f: ReturnType<typeof fixture>) => {
      f.snapshot.viewState.continuation!.reason = 'forged';
    },
    (f: ReturnType<typeof fixture>) => {
      delete f.snapshot.sources[0]!.deadlineAt;
    },
    (f: ReturnType<typeof fixture>) => {
      f.snapshot.state.continuation!.planIds = ['foreign'];
      f.snapshot.viewState = structuredClone(f.snapshot.state);
    },
  ]) {
    const f = fixture();
    advance(f);
    change(f);
    assert.equal((await collect(f.view)).length, 0);
  }
});
test('existing responsibility conditions retain their single original owner', async () => {
  const f = fixture();
  advance(f);
  f.snapshot.state.responsibilities = [
    {
      id: 'r',
      revision: 0,
      subject: { kind: 'request', id: 'request' },
      summary: 'Existing reply window',
      status: 'waiting',
      waitingOn: 'player',
      sourceIds: ['deadline'],
      nextCheck: structuredClone(f.snapshot.state.continuation!.conditions),
    },
  ];
  f.snapshot.viewState = structuredClone(f.snapshot.state);
  assert.equal((await collect(f.view)).length, 0);
  const sources = createAgentScheduleSources(f.view).filter((s) =>
    s.id.startsWith('responsibility:'),
  );
  assert.equal((await sources[0]!.source.collect('owner', 'w')).candidates.length, 1);
});
