import { createHash } from 'node:crypto';
import { actorContinuationBasis } from '../src/modules/world/domain/actor-continuation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentScheduleSources,
  type SchedulingView,
} from '../src/modules/world/application/agent-schedule-collectors.ts';

import type { AgentSnapshot } from '../src/modules/world/application/agent-runtime-ports.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';

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
async function local(v: SchedulingView, now = 0) {
  return (
    await createAgentScheduleSources(v, now)
      .find((s) => s.id === 'actor_local:' + v.actors[0]!.snapshot.state.actorId)!
      .source.collect('owner', v.worldId)
  ).candidates;
}
function ready() {
  const a = actor();
  a.snapshot.sources.push({
    id: 'definition:authored:fixture',
    kind: 'authored',
    recordId: 'definition',
    worldVersion: 0,
    at: before,
  });
  return view([a]);
}
test('quiet context survives minutes, unrelated commits and wake bookkeeping', async () => {
  const v = ready();
  const first = (await local(v, 1))[0]!;
  assert(first);
  assert.equal((await local(v, 120001))[0]!.id, first.id);
  const a = v.actors[0]!;
  v.worldVersion++;
  a.snapshot.worldVersion++;
  a.snapshot.state.revision++;
  a.snapshot.state.projectedWorldVersion = v.worldVersion;
  a.snapshot.state.continuation = {
    version: 1,
    decision: 'no_current_intent',
    reason: '无新依据',
    sourceInputId: 'wake-2',
    sourceIds: ['wake-2'],
    planIds: [],
    questionIds: [],
    conditions: [],
    decidedAt: at,
    basisHash: 'quiet',
  };
  a.snapshot.input = { origin: 'wake', sourceId: 'wake-2', text: '时钟检查' };
  a.snapshot.sources.push({
    id: 'wake-2',
    kind: 'accepted_input',
    recordId: 'wake-2',
    worldVersion: v.worldVersion,
    at,
  });
  a.snapshot.viewState = structuredClone(a.snapshot.state);
  assert.equal((await local(v, 180001))[0]!.id, first.id);
  v.consumedCandidateIds = [first.id];
  assert.equal((await local(v, 240001)).length, 0);
});
test('new private player speech reopens only its own semantic opportunity', async () => {
  const v = ready(),
    a = v.actors[0]!;
  const first = (await local(v))[0]!;
  v.consumedCandidateIds = [first.id];
  a.snapshot.sources.push({
    id: 'message:new',
    kind: 'private_message',
    recordId: 'm',
    worldVersion: 5,
    at,
  });
  a.snapshot.observations.push({
    sourceId: 'message:new',
    kind: 'speech',
    text: '今晚我可以来了',
    speaker: { kind: 'player' },
  });
  const changed = (await local(v))[0]!;
  assert(changed);
  assert.notEqual(changed.id, first.id);
  assert.equal((await local(v, 600000))[0]!.id, changed.id);
});
test('plan revision alone does not rebuy; a changed plan does', async () => {
  const v = ready(),
    a = v.actors[0]!;
  const first = (await local(v))[0]!;
  Object.assign(a.snapshot.state.plans[0]!, { revision: 2 });
  a.snapshot.viewState = structuredClone(a.snapshot.state);
  assert.equal((await local(v))[0]!.id, first.id);
  a.snapshot.state.plans[0]!.summary = '我自己先去准备';
  a.snapshot.viewState = structuredClone(a.snapshot.state);
  assert.notEqual((await local(v))[0]!.id, first.id);
});

test('a saved quiet continuation also consumes legacy minute-based work, until new evidence', async () => {
  const v = ready(),
    a = v.actors[0]!;
  a.snapshot.state.continuation = {
    version: 1,
    decision: 'no_current_intent',
    reason: '已考虑',
    sourceInputId: 'input',
    sourceIds: ['s'],
    planIds: [],
    questionIds: [],
    conditions: [],
    decidedAt: before,
    basisHash: createHash('sha256').update(actorContinuationBasis(a.snapshot.state)).digest('hex'),
  };
  a.snapshot.viewState = structuredClone(a.snapshot.state);
  assert.equal((await local(v, 300000)).length, 0);
  a.snapshot.sources.push({
    id: 'message:own',
    kind: 'private_message',
    recordId: 'own',
    worldVersion: 5,
    at,
  });
  a.snapshot.observations.push({
    sourceId: 'message:own',
    kind: 'speech',
    text: '我刚发过的同一句话',
    speaker: { kind: 'actor', actorId: 'a' },
  });
  assert.equal((await local(v, 360000)).length, 0);
  a.snapshot.sources.push({
    id: 'message:reply',
    kind: 'private_message',
    recordId: 'reply',
    worldVersion: 5,
    at,
  });
  a.snapshot.observations.push({
    sourceId: 'message:reply',
    kind: 'speech',
    text: '好，我改变主意了',
    speaker: { kind: 'player' },
  });
  assert.equal((await local(v, 360000)).length, 1);
});
test('own speech never creates a fresh optional-contact identity', async () => {
  const v = ready(),
    a = v.actors[0]!;
  const first = (await local(v))[0]!;
  a.snapshot.sources.push({
    id: 'message:self',
    kind: 'private_message',
    recordId: 'self',
    worldVersion: 5,
    at,
  });
  a.snapshot.observations.push({
    sourceId: 'message:self',
    kind: 'speech',
    text: '刚才已说过',
    speaker: { kind: 'actor', actorId: 'a' },
  });
  assert.equal((await local(v))[0]!.id, first.id);
});
