import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentScheduleSources,
  type SchedulingView,
} from '../src/modules/world/application/agent-schedule-collectors.ts';
import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';
import {
  emptyActorAgentState,
  type AgentActionResult,
  type AgentResponsibility,
} from '../src/modules/world/domain/agent-runtime.ts';
const at = '2026-10-15T10:00:00.000Z',
  before = '2026-10-15T09:00:00.000Z';
type ActorRead = SchedulingView['actors'][number];
function actor(actorId = 'a'): ActorRead {
  const state = emptyActorAgentState({ worldId: 'w', actorId }, 'authored:fixture', 5);
  state.revision = 2;
  state.goals.push({
    id: 'g',
    summary: '本人的安排',
    status: 'active',
    sourceIds: ['s'],
    resultIds: [],
  });
  state.actions.push({
    id: 'action',
    goalId: 'g',
    capability: 'own.schedule',
    status: 'ready',
    sourceIds: ['s'],
    targetIds: [],
    parameters: { mode: 'normal' },
    preconditions: [],
    dependsOnActionIds: [],
    handlesResponsibilityIds: [],
  });
  state.plans.push({
    id: 'plan',
    goalId: 'g',
    summary: '已明确的下一步',
    status: 'active',
    actionIds: ['action'],
    nextActionId: 'action',
    triggers: [],
    missingConditions: [],
    sourceIds: ['s'],
  });
  const snapshot: AgentSnapshot = {
    state,
    viewState: structuredClone(state),
    redactedStateIds: [],
    worldVersion: 5,
    storyAt: at,
    actor: {
      name: actorId,
      persona: '合成测试人物',
      boundaries: '',
      definitionRef: state.definitionRef,
    },
    sources: [
      { id: 's', kind: 'authored', recordId: 'fact', worldVersion: 0, at: before },
      { id: 'pos', kind: 'world_event', recordId: 'position-event', worldVersion: 1, at: before },
      { id: 'input', kind: 'accepted_input', recordId: 'input', worldVersion: 5, at },
    ],
    observations: [{ sourceId: 's', kind: 'fact', text: '仅已授权的合成依据' }],
    channel: {
      kind: 'private',
      threadId: actorId,
      audienceActorIds: [actorId],
      allowedCapabilities: ['own.schedule'],
    },
    input: { sourceId: 'input', origin: 'wake', text: '' },
    worldContext: {
      time: { storyAt: at, timeZone: 'UTC+08:00', localDateTime: '2026-10-15T18:00:00' },
      boundary: {
        actorIds: [actorId],
        placeIds: ['home', 'shop'],
        capabilityIds: ['own.schedule'],
        extensionPermission: 'none',
      },
      selfPosition: { status: 'at', placeId: 'home', occurredAt: before, sourceId: 'pos' },
      knowledge: [],
    },
  };
  return { snapshot, trustedResults: [], appointments: [] };
}
function view(actors = [actor()]): SchedulingView {
  return {
    worldId: 'w',
    engineEpoch: 2,
    worldVersion: 5,
    storyAt: at,
    actors,
    activeAttempts: [],
    consumedCandidateIds: [],
  };
}
function sync(a: ActorRead) {
  a.snapshot.viewState = structuredClone(a.snapshot.state);
  return a;
}
function responsibility(a: ActorRead, change: Partial<AgentResponsibility> = {}) {
  a.snapshot.state.responsibilities.push({
    id: 'r',
    revision: 1,
    subject: { kind: 'request', id: 'request' },
    summary: '是否一起去',
    status: 'waiting',
    waitingOn: 'player',
    nextCheck: [],
    sourceIds: ['s'],
    ...change,
  });
  sync(a);
  return a.snapshot.state.responsibilities.at(-1)!;
}
function spatial() {
  const a = actor(),
    v = view([a]),
    s = a.snapshot;
  s.channel.allowedCapabilities.push('position.establish');
  s.worldContext!.selfPosition = {
    status: 'unknown',
    placeId: null,
    sourceId: 'self-position:genesis:w',
    occurredAt: before,
  };
  s.worldContext!.initialPlacement = {
    policy: 'fictional-unset-state-v1',
    sourceId: 'initial-position-policy:w:a',
    places: [
      { id: 'home', name: '家' },
      { id: 'shop', name: '店' },
    ],
  };
  s.sources.push(
    {
      id: 'definition:actor',
      kind: 'authored',
      recordId: s.state.definitionRef,
      worldVersion: 0,
      at: before,
    },
    { id: 'self-position:genesis:w', kind: 'authored', recordId: 'w', worldVersion: 0, at: before },
    {
      id: 'initial-position-policy:w:a',
      kind: 'authored',
      recordId: 'w',
      worldVersion: 0,
      at: before,
    },
  );
  return { a, v };
}
async function collect(v: SchedulingView) {
  const registration = createAgentScheduleSources(v).find((s) => s.id === 'initial_position:a');
  return registration
    ? registration.source.collect('owner', 'w')
    : { candidates: [], blockers: [] };
}
test('unknown0 actor receives one explicit spatial candidate with original native cue and stable identity', async () => {
  const { a, v } = spatial(),
    beforeState = structuredClone(a.snapshot.state);
  const first = (await collect(v)).candidates[0]!;
  assert.equal(first.source, 'actor_local');
  assert.equal(first.requiresCoordination, false);
  assert.match(first.wakeCue!, /position.establish/);
  assert.match(first.wakeCue!, /不倒|不是恢复过去/);
  assert.ok(first.sourceIds.includes('initial-position-policy:w:a'));
  assert.deepEqual(a.snapshot.state, beforeState);
  const changed = structuredClone(v);
  changed.worldVersion++;
  changed.storyAt = '2026-10-15T10:01:00.000Z';
  const snap = changed.actors[0]!.snapshot;
  snap.worldVersion++;
  snap.storyAt = changed.storyAt;
  snap.worldContext!.time.storyAt = changed.storyAt;
  snap.state.projectedWorldVersion++;
  snap.state.revision++;
  snap.viewState = structuredClone(snap.state);
  assert.equal((await collect(changed)).candidates[0]!.id, first.id);
  changed.consumedCandidateIds = [first.id];
  assert.equal((await collect(changed)).candidates.length, 0);
  const changedDefinition = structuredClone(v);
  const s = changedDefinition.actors[0]!.snapshot;
  s.state.definitionRef = 'authored:new';
  s.viewState.definitionRef = 'authored:new';
  s.actor.definitionRef = 'authored:new';
  s.sources.find((s) => s.id === 'definition:actor')!.recordId = 'authored:new';
  assert.equal((await collect(changedDefinition)).candidates[0]!.id, first.id);
});
test('known/in-transit/missing policy or unavailable tool cannot be reset as initial placement', async () => {
  for (const change of [
    (s: AgentSnapshot) => {
      s.worldContext!.selfPosition.status = 'at';
      s.worldContext!.selfPosition.placeId = 'home';
    },
    (s: AgentSnapshot) => {
      s.worldContext!.selfPosition.status = 'in_transit';
    },
    (s: AgentSnapshot) => {
      delete s.worldContext!.initialPlacement;
    },
    (s: AgentSnapshot) => {
      s.sources = s.sources.filter((s) => s.id !== 'initial-position-policy:w:a');
    },
    (s: AgentSnapshot) => {
      s.channel.allowedCapabilities = s.channel.allowedCapabilities.filter(
        (c) => c !== 'position.establish',
      );
    },
  ]) {
    const { a, v } = spatial();
    change(a.snapshot);
    assert.equal((await collect(v)).candidates.length, 0);
  }
});
test('all active and unknown actor work remains a blocker, never permission to re-buy that call', async () => {
  for (const status of [
    'reserved',
    'request_sent',
    'response_received',
    'unknown_after_send',
  ] as const) {
    const { v } = spatial();
    v.activeAttempts = [{ id: 'protected', actorId: 'a', status }];
    const result = await collect(v);
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0]!.scope.kind, 'actor');
  }
});
