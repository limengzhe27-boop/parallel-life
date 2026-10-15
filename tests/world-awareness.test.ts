import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awarenessLocalTime,
  worldBoundary,
  committedAwarenessDelta,
  type CommittedAwarenessEvent,
} from '../src/modules/world/domain/world-awareness.ts';
import { emptyActorAgentState } from '../src/modules/world/domain/agent-runtime.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import type { SceneSession } from '../src/modules/world/domain/experience-rules.ts';
const departedAt = '2026-10-15T07:00:00.000Z';
const arrivedAt = '2026-10-15T07:10:00.000Z';
function awarenessFixture() {
  const source = {
    kind: 'system_policy' as const,
    policy: 'default_travel_v1' as const,
    snapshotVersion: 0 as const,
  };
  const world: WorldState = {
    schemaVersion: 1,
    id: 'w',
    ownerId: 'owner',
    version: 1,
    title: 'Fixture',
    time: arrivedAt,
    actors: ['watcher', 'absent'].map((id) => ({ id, name: id, persona: id })),
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
    space: {
      currentPlaceId: 'to',
      positionSource: { kind: 'travel', eventId: 'e', eventVersion: 1 },
      routes: [],
      places: ['from', 'to'].map((id) => ({
        id,
        name: id,
        description: '',
        source,
        contactActorIds: ['absent'],
        appointmentIds: [],
      })),
    },
  };
  const event: CommittedAwarenessEvent = {
    id: 'e',
    worldId: 'w',
    commandId: 'c',
    version: 1,
    occurredAt: arrivedAt,
    storyAt: arrivedAt,
    type: 'travel.completed',
    data: {
      fromPlaceId: 'from',
      toPlaceId: 'to',
      departedAt,
      arrivedAt,
      leftSceneId: 'scene',
      departureObservation: {
        sourceEventId: 'e',
        kind: 'canonical',
        visibility: { kind: 'actors', actorIds: ['watcher'] },
      },
    },
  };
  return { world, event };
}
test('travel actual arrival and departure knowledge remain separate, with actual perception time', () => {
  const { world, event } = awarenessFixture();
  const before = structuredClone({ world, event });
  const delta = committedAwarenessDelta(world, event);
  assert.equal(delta.positions[0]?.placeId, 'to');
  assert.equal(delta.positions[0]?.occurredAt, arrivedAt);
  assert.equal(delta.knowledge.length, 1);
  assert.deepEqual(delta.knowledge[0], {
    worldId: 'w',
    observerActorId: 'watcher',
    subject: { kind: 'player' },
    kind: 'left',
    placeId: 'from',
    sourceKind: 'direct',
    occurredAt: departedAt,
    learnedAt: departedAt,
    sourceEventId: 'e',
    worldVersion: 1,
    possiblyStale: true,
  });
  assert.equal(JSON.stringify(delta.knowledge).includes('"to"'), false);
  assert.deepEqual({ world, event }, before);
});
test('absent contacts and all non-observers get no knowledge or room-absence inference', () => {
  const { world, event } = awarenessFixture();
  const data = event.data as Record<string, unknown>;
  delete data.departureObservation;
  const delta = committedAwarenessDelta(world, event);
  assert.deepEqual(delta.knowledge, []);
  assert.equal(delta.positions.length, 1);
});
test('invalid observer and unknown destination are rejected rather than repaired', () => {
  const { world, event } = awarenessFixture();
  const data = event.data as Record<string, unknown>;
  data.toPlaceId = 'hidden';
  assert.throws(() => committedAwarenessDelta(world, event));
  data.toPlaceId = 'to';
  (data.departureObservation as { visibility: { actorIds: string[] } }).visibility.actorIds = [
    'fake',
  ];
  assert.throws(() => committedAwarenessDelta(world, event));
});
test('speech or unimplemented report/room_absent tags never establish positions or needsEvaluation', () => {
  const { world, event } = awarenessFixture();
  for (const type of ['turn.resolved', 'actor.position_reported', 'room_absent']) {
    event.type = type;
    event.data = { userText: '我已经到了to，他不在from', placeId: 'to', actorId: 'watcher' };
    assert.deepEqual(committedAwarenessDelta(world, event), {
      positions: [],
      knowledge: [],
      reasons: [],
    });
  }
});
test('scene actual location uses validated interval at event version, not contact roster or future presence', () => {
  const { world, event } = awarenessFixture();
  event.type = 'scene.opened';
  event.data = { sceneId: 'scene' };
  const scene: SceneSession = {
    id: 'scene',
    worldId: 'w',
    ownerId: 'owner',
    sourceEventId: 'older',
    sourceVersion: 0,
    status: 'active',
    placeId: 'from',
    title: '现场',
    presence: [
      {
        participant: { kind: 'actor', actorId: 'watcher' },
        joinedVersion: 1,
        sourceVersion: 1,
        sourceEventId: 'e',
      },
      {
        participant: { kind: 'actor', actorId: 'absent' },
        joinedVersion: 2,
        sourceVersion: 2,
        sourceEventId: 'future',
      },
    ],
  };
  const delta = committedAwarenessDelta(world, event, { scene });
  assert.equal(delta.positions.length, 1);
  assert.deepEqual(delta.positions[0]?.subject, { kind: 'actor', actorId: 'watcher' });
  assert.deepEqual(delta.knowledge, []);
});
test('unchanged plans and previous decisions do not force re-evaluation for every speech', () => {
  const { world, event } = awarenessFixture();
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'watcher' }, 'def', 1);
  state.decisions = [
    { id: 'd', responsibilityId: 'r', sourceId: 'input', kind: 'declined', quote: '不去' },
  ];
  state.plans = [
    {
      id: 'p',
      goalId: 'g',
      summary: '另作安排',
      sourceIds: [],
      status: 'active',
      actionIds: [],
      nextActionId: null,
      triggers: [],
      missingConditions: [],
    },
  ];
  event.type = 'turn.resolved';
  event.data = {
    actorId: 'watcher',
    agentRuntime: { stateAfter: state, proposal: {}, results: [] },
  };
  const first = committedAwarenessDelta(world, event);
  assert.deepEqual(
    first.reasons.map((r) => r.kind),
    ['plan_changed', 'player_decision'],
  );
  assert.deepEqual(
    committedAwarenessDelta(world, event, { previousAgentState: structuredClone(state) }).reasons,
    [],
  );
});
test('real runtime results produce explicit references, speech cannot masquerade as a result', () => {
  const { world, event } = awarenessFixture();
  const state = emptyActorAgentState({ worldId: 'w', actorId: 'watcher' }, 'def', 1);
  event.type = 'agent.state_committed';
  event.data = {
    actorId: 'watcher',
    agentRuntime: {
      stateAfter: state,
      proposal: {},
      results: [{ id: 'result', worldId: 'w', actorId: 'watcher', eventId: 'e', worldVersion: 1 }],
    },
  };
  assert.deepEqual(committedAwarenessDelta(world, event).reasons[0]?.ref, {
    kind: 'action_result',
    id: 'result',
    actorId: 'watcher',
  });
});
test('boundary defaults to none, preserves actual map IDs and uses UTC+08 local time', () => {
  const { world } = awarenessFixture();
  assert.equal(worldBoundary(world, 'e').extensionPermission, 'none');
  assert.deepEqual(worldBoundary(world, 'e').placeIds, ['from', 'to']);
  assert.deepEqual(worldBoundary(world, 'e', []).capabilityIds, []);
  assert.deepEqual(awarenessLocalTime('2026-10-15T19:10:00Z'), {
    storyAt: '2026-10-15T19:10:00.000Z',
    timeZone: 'UTC+08:00',
    localDateTime: '2026-10-16T03:10:00',
  });
});
