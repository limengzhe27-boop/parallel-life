import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWorldMatterSceneUpdate,
  sceneMatterResultFact,
  witnessedMatterResult,
  sceneAttendance,
  sceneMatterId,
} from '../src/modules/world/domain/scene-matter-policy.ts';
import type { WorldState } from '../src/modules/world/domain/types.ts';
import type { SceneSession, SceneAction } from '../src/modules/world/domain/experience-rules.ts';
import type { WorldMatter } from '../src/modules/world/domain/matters.ts';
const at = '2026-10-11T10:00:00.000Z';
function fixture() {
  const m: WorldMatter = {
    id: 'r17',
    worldId: 'w',
    span: 'near_term',
    title: '交付已修缮的R17',
    description: '核对单据、交代接头细节并实际交付',
    status: 'in_progress',
    assertion: 'actor_statement',
    visibility: 'player_visible',
    relatedPlaceId: 'repair_shop',
    relatedActorIds: ['laozhou'],
    source: {
      kind: 'preset',
      presetId: 'county-yellow-hair',
      version: 3,
      matterKey: 'deliver_r17',
    },
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  const world = {
    id: 'w',
    ownerId: 'o',
    version: 3,
    time: at,
    matters: [m],
    officialLife: { presetId: 'county-yellow-hair', version: 3, contacts: [], notes: [] },
    actors: [{ id: 'laozhou' }],
    appointments: [],
    facts: [],
    space: {
      currentPlaceId: 'repair_shop',
      places: [{ id: 'repair_shop', appointmentIds: [] }],
      routes: [],
    },
  } as unknown as WorldState;
  const scene = { id: 's', worldId: 'w', ownerId: 'o', placeId: 'repair_shop' } as SceneSession;
  const action = {
    id: 'a',
    ownerId: 'o',
    worldId: 'w',
    sceneId: 's',
    intent: 'attempt',
    relatedMatterIds: [sceneMatterId('s', 'r17')],
    text: '我核对R17工单，解释电源接头检修细节并交付车辆。',
    resolution: {
      sourceEventId: 'e',
      sourceVersion: 4,
      outcome: 'succeeded',
      observation: '你已完成R17接头检查及车辆交付，工单已签收。',
    },
  } as SceneAction;
  return {
    world,
    initial: structuredClone(world),
    scene,
    action,
    status: 'completed' as const,
    matterId: m.id,
    eventId: 'e',
    eventVersion: 4,
    at,
  };
}
test('completion requires the exact bound target, action, adjudicated observation and source', () => {
  const f = fixture(),
    m = validateWorldMatterSceneUpdate(f);
  assert.equal(m.status, 'completed');
  assert.equal(m.assertion, 'world_verified');
  assert.equal(m.version, 2);
  assert.equal(m.evidence?.kind, 'scene_action');
  assert.equal(f.world.matters![0]!.status, 'in_progress');
});
test('successful looking, greeting and empty/all related lists never complete the goal', () => {
  for (const text of [
    '我看看R17。',
    '我向老周打招呼。',
    '我已经把R17做完了。',
    '我说“核对R17接头并交付车辆”。',
    '我还没核对R17接头或交付车辆。',
    '如果核对R17接头并交付车辆就好了。',
  ]) {
    const f = fixture();
    f.action.text = text;
    assert.throws(() => validateWorldMatterSceneUpdate(f));
  }
  const f = fixture();
  f.action.relatedMatterIds = [];
  assert.throws(() => validateWorldMatterSceneUpdate(f));
});
test('cross-world, location, changed definition, unsupported pursuit and forged source fail closed', () => {
  const edits = [
    (f: ReturnType<typeof fixture>) => (f.scene.worldId = 'other'),
    (f: ReturnType<typeof fixture>) => (f.world.space!.currentPlaceId = 'elsewhere'),
    (f: ReturnType<typeof fixture>) => (f.world.matters![0]!.title = '已完成全部目标'),
    (f: ReturnType<typeof fixture>) => (f.world.matters![0]!.span = 'pursuit'),
    (f: ReturnType<typeof fixture>) => (f.action.resolution!.sourceEventId = 'forged'),
    (f: ReturnType<typeof fixture>) => (f.action.resolution!.outcome = 'partial'),
    (f: ReturnType<typeof fixture>) =>
      (f.action.resolution!.observation = '老周说你已经完成R17接头交付和签收，但没有交付记录。'),
  ];
  for (const edit of edits) {
    const f = fixture();
    edit(f);
    assert.throws(() => validateWorldMatterSceneUpdate(f));
  }
});
test('only actual witnesses obtain result facts; related contact alone never establishes knowledge', () => {
  const f = fixture(),
    m = validateWorldMatterSceneUpdate(f);
  assert.equal(sceneMatterResultFact(m, []), undefined);
  const fact = sceneMatterResultFact(m, ['witness'])!;
  f.world.matters = [m];
  f.world.facts = [fact];
  assert.equal(witnessedMatterResult(f.world, m, 'laozhou'), undefined);
  assert.equal(witnessedMatterResult(f.world, m, 'witness')?.sourceEventId, 'e');
});
test('witnessed actual arrival marks only the confirmed local due invitation, never a matter', () => {
  const f = fixture();
  f.world.appointments = [
    {
      id: 'dinner',
      title: '晚饭',
      status: 'confirmed',
      at,
      participantIds: ['laozhou'],
      sourceEventId: 'inv',
    },
  ];
  f.world.space!.places[0]!.appointmentIds = ['dinner'];
  assert.equal(sceneAttendance(f.world, f.scene, [], at, 4), undefined);
  const arrived = sceneAttendance(f.world, f.scene, ['laozhou'], at, 4);
  assert.equal(arrived?.status, 'attended');
  assert.equal(f.world.matters![0]!.status, 'in_progress');
  f.world.appointments[0]!.at = '2026-10-12T10:00:00.000Z';
  assert.equal(sceneAttendance(f.world, f.scene, ['laozhou'], at, 4), undefined);
});
