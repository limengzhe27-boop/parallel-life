import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneAction } from '../src/modules/world/domain/experience-rules.ts';
import type { WorldMatter } from '../src/modules/world/domain/matters.ts';
import { matterSceneObservation } from '../src/modules/world/domain/matter-scene-observation.ts';
import {
  createWorldMatter,
  transitionWorldMatter,
  claimMatterReward,
} from '../src/modules/world/domain/matters.ts';
import { WorldMatterSchema } from '../src/contracts/world-matters.ts';
import { projectPlayerRecords } from '../src/modules/world/domain/player-records.ts';
import {
  sceneAttendanceSource,
  type SceneAttendanceEvent,
} from '../src/modules/world/domain/scene-attendance-source.ts';
import type { WorldState, Appointment } from '../src/modules/world/domain/types.ts';
import type { SceneSession } from '../src/modules/world/domain/experience-rules.ts';

const at = '2026-10-11T03:00:00.000Z';
const source = {
  ownerId: 'owner',
  worldId: 'world',
  worldVersion: 6,
  eventId: 'result',
  eventVersion: 6,
};
const evidence = {
  kind: 'scene_action' as const,
  sceneId: 'scene',
  actionId: 'action',
  outcome: 'succeeded' as const,
  eventId: 'result',
  eventVersion: 6,
  at,
};
const matter: WorldMatter = {
  ...createWorldMatter({
    id: 'matter',
    worldId: 'world',
    title: '核对工单',
    description: '核对维修摘要。',
    span: 'near_term',
    source: { kind: 'preset', presetId: 'test', version: 3, matterKey: 'r17' },
    now: at,
  }),
  status: 'completed',
  assertion: 'world_verified',
  evidence,
};
const action: SceneAction = {
  id: 'action',
  ownerId: 'owner',
  worldId: 'world',
  sceneId: 'scene',
  commandId: 'command',
  sourceEventId: 'input',
  sourceVersion: 5,
  intent: 'attempt',
  kind: 'inspect',
  text: '我核对工单。',
  relatedMatterIds: ['matter'],
  status: 'resolved',
  resolution: {
    sourceEventId: 'result',
    sourceVersion: 6,
    outcome: 'succeeded',
    observation: '维修编号和签收记录一致。',
  },
};

test('only a matching persisted player action contributes an objective matter observation', () => {
  assert.equal(matterSceneObservation(matter, action, source), '维修编号和签收记录一致。');
  for (const invalid of [
    { ...action, ownerId: 'another' },
    { ...action, worldId: 'another' },
    { ...action, sceneId: 'another' },
    { ...action, id: 'another' },
    { ...action, relatedMatterIds: [] },
    { ...action, intent: 'plan' as const },
    { ...action, intent: 'hypothesis' as const },
    { ...action, status: 'pending' as const },
    { ...action, resolution: undefined },
    { ...action, resolution: { ...action.resolution!, sourceEventId: 'invented' } },
    { ...action, resolution: { ...action.resolution!, sourceVersion: 7 } },
    { ...action, resolution: { ...action.resolution!, outcome: 'partial' as const } },
  ])
    assert.equal(matterSceneObservation(matter, invalid, source), undefined);
  assert.equal(matterSceneObservation(matter, action, { ...source, worldVersion: 5 }), undefined);
  assert.equal(
    matterSceneObservation({ ...matter, visibility: 'hidden' }, action, source),
    undefined,
  );
  assert.equal(
    matterSceneObservation(
      {
        ...matter,
        evidence: {
          kind: 'user_report',
          quote: '我做完了',
          outcome: 'reported_done',
          eventId: 'result',
          eventVersion: 6,
          at,
        },
      },
      action,
      source,
    ),
    undefined,
  );
});

test('a failed or partial action remains visible as feedback, never as a completed achievement', () => {
  for (const outcome of ['failed', 'partial'] as const) {
    const blocked = { ...matter, status: 'blocked' as const, evidence: { ...evidence, outcome } };
    const actual = {
      ...action,
      resolution: { ...action.resolution!, outcome, observation: '没有签收，仍需要核对编号。' },
    };
    assert.equal(matterSceneObservation(blocked, actual, source), actual.resolution.observation);
    assert.equal(
      matterSceneObservation({ ...blocked, status: 'completed' }, actual, source),
      undefined,
    );
  }
});

test('failed and partial results cannot pass completion validation or claim a reward even from a forged state', () => {
  const active = { ...matter, status: 'in_progress' as const };
  for (const outcome of ['failed', 'partial'] as const) {
    const result = { ...evidence, outcome };
    assert.throws(
      () => transitionWorldMatter(active, { status: 'completed', evidence: result, now: at }),
      /cannot complete/,
    );
    const forged = { ...matter, evidence: result };
    assert.equal(WorldMatterSchema.safeParse(forged).success, false);
    assert.throws(() => claimMatterReward(forged, at), /MATTER_NOT_COMPLETED/);
  }
  assert.throws(
    () => claimMatterReward({ ...matter, evidence: undefined }, at),
    /MATTER_NOT_COMPLETED/,
  );
});

test('system records show the stored consequence and correctly move terminal matters into history', () => {
  const base = {
    worldId: 'world',
    worldVersion: 6,
    actors: [],
    choices: [],
    appointments: [],
    events: [],
    messages: [],
    matters: [matter],
  };
  const fallback = projectPlayerRecords(base);
  assert.equal(fallback.current.length, 0);
  assert.equal(fallback.history[0]!.text, matter.description);
  const records = projectPlayerRecords({
    ...base,
    matterObservations: new Map([['matter', action.resolution!.observation]]),
  });
  assert.equal(records.history[0]!.assertion, 'world_verified');
  assert.match(records.history[0]!.text, /这次行动的反馈：维修编号和签收记录一致/);
  assert.equal(records.history[0]!.state, 'completed');
});

test('attendance proves a due confirmed appointment with a present invited actor, not a successful unrelated action', () => {
  const appointment: Appointment = {
    id: 'dinner',
    title: '晚饭',
    at,
    participantIds: ['invited'],
    sourceEventId: 'genesis:world',
    status: 'attended',
    responseVersion: 6,
    responseAt: at,
  };
  const world = {
    id: 'world',
    ownerId: 'owner',
    version: 8,
    space: { currentPlaceId: 'elsewhere', places: [{ id: 'home', appointmentIds: ['dinner'] }] },
  } as WorldState;
  const scene: SceneSession = {
    id: 'scene',
    worldId: 'world',
    ownerId: 'owner',
    placeId: 'home',
    appointmentId: 'dinner',
    title: '晚饭现场',
    status: 'active',
    sourceEventId: 'entry',
    sourceVersion: 5,
    presence: [
      {
        participant: { kind: 'player' },
        joinedVersion: 5,
        sourceEventId: 'entry',
        sourceVersion: 5,
      },
      {
        participant: { kind: 'actor', actorId: 'invited' },
        joinedVersion: 6,
        sourceEventId: 'result',
        sourceVersion: 6,
      },
    ],
  };
  const event: SceneAttendanceEvent = {
    id: 'result',
    worldId: 'world',
    version: 6,
    storyAt: at,
    type: 'scene.opened',
    data: { sceneId: 'scene', worldResults: { scene, attendance: { appointmentId: 'dinner' } } },
  };
  const proof = sceneAttendanceSource(world, appointment, event);
  assert.equal(proof?.eventId, 'result');
  // The player may subsequently move; the previously saved attendance remains valid.
  for (const altered of [
    { ...scene, ownerId: 'another' },
    { ...scene, worldId: 'another' },
    { ...scene, placeId: 'elsewhere' },
    { ...scene, presence: scene.presence.slice(0, 1) },
    { ...scene, presence: scene.presence.slice(1) },
    { ...scene, presence: scene.presence.map((p) => ({ ...p, leftVersion: 6 })) },
  ])
    assert.equal(
      sceneAttendanceSource(world, appointment, {
        ...event,
        data: {
          ...event.data,
          worldResults: { scene: altered, attendance: { appointmentId: 'dinner' } },
        },
      }),
      undefined,
    );
  assert.equal(
    sceneAttendanceSource(world, { ...appointment, responseVersion: 7 }, event),
    undefined,
  );
  assert.equal(
    sceneAttendanceSource(world, { ...appointment, status: 'cancelled' }, event),
    undefined,
  );
  assert.equal(
    sceneAttendanceSource(world, { ...appointment, at: '2026-10-12T03:00:00.000Z' }, event),
    undefined,
  );
  assert.equal(
    sceneAttendanceSource(world, appointment, {
      ...event,
      data: { sceneId: scene.id, worldResults: { scene } },
    }),
    undefined,
  );
});
