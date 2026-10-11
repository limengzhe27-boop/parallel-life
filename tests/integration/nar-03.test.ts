import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import { PostgresPlayerRecords } from '../../src/modules/world/infrastructure/player-records-repository.ts';
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { sceneTaskHandler } from '../../src/modules/world/infrastructure/scene-task-handler.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { buildAgenda, threadFor } from '../../src/modules/world/domain/agenda.ts';

test('NAR-03: Official branch matter progression, calendar attendance and NPC WeChat aftermath', async () => {
  try {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID();
  await new IdentityRepository(db).ensureGuest(owner);

  const officialRepo = new OfficialLifeRepository(db, officialLifeCatalog);
  const sceneRepo = new SceneRepository(db);
  const recordsRepo = new PostgresPlayerRecords(db);

  // 1. Start official life "county-yellow-hair"
  const startResult = await officialRepo.start(owner, 'county-yellow-hair', {
    commandId: randomUUID(),
    version: 2,
  });
  const worldId = startResult.worldId;
  assert.ok(worldId);

  // 2. Verify initial matters in player records
  const initialRecords = await recordsRepo.read(owner, worldId);
  const r17Matter = initialRecords.current.find((r) => r.title.includes('R17'));
  const dinnerMatter = initialRecords.current.find((r) => r.title.includes('晚饭'));
  const pursuitMatter = initialRecords.about.find((r) => r.span === 'pursuit');

  assert.ok(r17Matter, 'R17 matter must be in current records');
  assert.equal(r17Matter.state, 'in_progress');
  assert.ok(dinnerMatter, 'Dinner matter must be in current records');
  assert.ok(pursuitMatter, 'Pursuit matter must be in about records');
  assert.equal(pursuitMatter.stateLabel, '长期追求');

  // Extract actual matter ID from sys/matter/... id
  const r17MatterId = r17Matter.source.kind === 'world_matter' ? r17Matter.source.matterId : '';
  assert.ok(r17MatterId);

  // 3. Enter scene at repair shop
  const enterReceipt = await sceneRepo.enterPlace(owner, worldId, {
    commandId: randomUUID(),
    expectedVersion: (await sceneRepo.read(owner, worldId)).worldVersion,
    placeId: 'repair_shop',
  });
  assert.ok(enterReceipt.sceneId);
  assert.ok(enterReceipt.task);

  // Run opening worker task
  let laozhouId = '';
  await db.transaction(owner, async (sql) => {
    const row = (await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [worldId])).rows[0];
    laozhouId = row.state.actors.find((a: { name: string; id: string }) => a.name.includes('老周')).id;
  });
  assert.ok(laozhouId);

  const openingHandler = sceneTaskHandler(
    queue,
    {
      async propose() {
        return {
          location: '老周修车铺',
          narration: '修车铺里的扳手和机油气味依旧熟悉，门口停着刚检修完的车辆。',
          presentActorIds: [],
          outcome: null,
          observation: null,
          matterTitle: null,
          initialMatters: [],
          matterUpdates: [],
          dialogues: [],
        };
      },
    },
    'nar-03-test',
  );

  const runWorker = async (taskId: string, handler = openingHandler) =>
    runOne(
      {
        claim: (k) => queue.claimForOwner(taskId, owner, k),
        renew: (l) => queue.renew(l),
        finish: (l, o) => queue.finish(l, o),
      },
      { world: handler },
    );

  await runWorker(enterReceipt.task.id);

  // Verify scene read has seeded matters
  const sceneRead = await sceneRepo.read(owner, worldId);
  assert.equal(sceneRead.scene?.id, enterReceipt.sceneId);
  assert.ok(sceneRead.matters.some((m) => m.id === r17MatterId));

  // 4. Submit player action attempting to deliver R17
  const actionCmdId = randomUUID();
  const inputReceipt = await sceneRepo.input(owner, worldId, enterReceipt.sceneId, {
    commandId: actionCmdId,
    expectedVersion: sceneRead.worldVersion,
    text: '我核对R17维修工单，交接钥匙并完成车辆交付。',
    relatedMatterIds: [r17MatterId],
  });
  assert.ok(inputReceipt.task);

  // Adjudicate attempt as succeeded
  const actionHandler = sceneTaskHandler(
    queue,
    {
      async propose(ctx) {
        return {
          location: '老周修车铺',
          narration: '钥匙交接完成，工单上已结清签收。',
          presentActorIds: [],
          outcome: 'succeeded',
          observation: '车主对排气检查和接头加固表示满意，工单结算完毕，R17顺利完成交付。',
          matterTitle: null,
          matterUpdates: [{ id: r17MatterId, status: 'completed' }],
          dialogues: [],
        };
      },
    },
    'nar-03-test',
  );

  await runWorker(inputReceipt.task.id, actionHandler);

  // 5. Verify atomic progression in WorldState and PlayerRecords
  let updatedWorldState: any;
  await db.transaction(owner, async (sql) => {
    const row = (await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [worldId])).rows[0];
    updatedWorldState = row.state;
  });
  const updatedR17 = updatedWorldState.matters.find((m: any) => m.id === r17MatterId);
  assert.equal(updatedR17.status, 'completed', 'WorldMatter must be marked completed in WorldState');
  assert.equal(updatedR17.evidence?.outcome, 'succeeded');

  // Verify PlayerRecords: R17 matter has moved to history!
  const afterActionRecords = await recordsRepo.read(owner, worldId);
  assert.ok(
    !afterActionRecords.current.some((r) => r.source.kind === 'world_matter' && r.source.matterId === r17MatterId),
    'Completed matter must be removed from current items',
  );
  assert.ok(
    afterActionRecords.history.some((r) => r.source.kind === 'world_matter' && r.source.matterId === r17MatterId),
    'Completed matter must be moved to history items',
  );

  // 6. Verify NPC WeChat Aftermath: agenda generates matter_result for laozhou
  const agenda = buildAgenda(updatedWorldState);
  const laozhouThread = threadFor(agenda, laozhouId);
  assert.ok(laozhouThread, 'Agenda thread for Lao Zhou must exist');
  assert.equal(laozhouThread.kind, 'matter_result');
  assert.match(laozhouThread.detail, /交付已修缮的R17/);

  // 7. Calendar Attendance: confirm family dinner appointment and attend it
  let dinnerAppointmentId = '';
  await db.transaction(owner, async (sql) => {
    const rows = (await sql.query('SELECT document FROM parallel_life.world_appointments WHERE world_id=$1', [worldId])).rows;
    const dinner = rows.map((r: any) => r.document).find((a: any) => a.title.includes('晚饭'));
    dinnerAppointmentId = dinner.id;
    // Set status to confirmed and time to current
    const confirmed = { ...dinner, status: 'confirmed', at: updatedWorldState.time };
    await sql.query(
      'INSERT INTO parallel_life.world_appointments(id,world_id,owner_id,document) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
      [dinner.id, worldId, owner, confirmed],
    );
  });
  assert.ok(dinnerAppointmentId);

  // Leave previous scene first
  await sceneRepo.leave(owner, worldId, enterReceipt.sceneId, {
    commandId: randomUUID(),
    expectedVersion: (await sceneRepo.read(owner, worldId)).worldVersion,
  });

  // Travel to lin_home
  const spaceRepo = new PostgresWorldSpace(db, officialLifeCatalog);
  const spaceRead = await spaceRepo.read(owner, worldId);
  await spaceRepo.travel(owner, worldId, {
    commandId: randomUUID(),
    expectedVersion: spaceRead.worldVersion,
    routeId: 'repair_shop_to_lin_home',
  });

  // Enter scene at lin_home
  const dinnerSceneReceipt = await sceneRepo.enterPlace(owner, worldId, {
    commandId: randomUUID(),
    expectedVersion: (await sceneRepo.read(owner, worldId)).worldVersion,
    placeId: 'lin_home',
  });
  assert.ok(dinnerSceneReceipt.sceneId);

  // Run dinner opening
  let linyueId = '';
  await db.transaction(owner, async (sql) => {
    const row = (await sql.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [worldId])).rows[0];
    linyueId = row.state.actors.find((a: { name: string; id: string }) => a.name.includes('林悦')).id;
  });
  assert.ok(linyueId);

  const dinnerOpeningHandler = sceneTaskHandler(
    queue,
    {
      async propose() {
        return {
          location: '林悦家',
          narration: '林悦打开门，饭菜的香气飘散在屋里。',
          presentActorIds: [linyueId],
          outcome: null,
          observation: null,
          matterTitle: null,
          initialMatters: [],
          matterUpdates: [],
          dialogues: [{ actorId: linyueId, text: '你来啦，快进屋坐。' }],
        };
      },
    },
    'nar-03-test',
  );
  await runWorker(dinnerSceneReceipt.task!.id, dinnerOpeningHandler);

  // Player action at dinner succeeds
  const dinnerActionReceipt = await sceneRepo.input(owner, worldId, dinnerSceneReceipt.sceneId, {
    commandId: randomUUID(),
    expectedVersion: (await sceneRepo.read(owner, worldId)).worldVersion,
    text: '我递上买的水果，在桌边坐下，向林悦一家诚恳打招呼。',
    relatedMatterIds: [],
  });

  const dinnerActionHandler = sceneTaskHandler(
    queue,
    {
      async propose() {
        return {
          location: '林悦家',
          narration: '林悦笑着接过水果洗好端上桌，饭桌上的气氛逐渐缓和。',
          presentActorIds: [linyueId],
          outcome: 'succeeded',
          observation: '你得体地出席了晚饭并表达了诚恳态度。',
          matterTitle: null,
          matterUpdates: [],
          dialogues: [{ actorId: linyueId, text: '谢谢你愿意过来。' }],
        };
      },
    },
    'nar-03-test',
  );
  await runWorker(dinnerActionReceipt.task!.id, dinnerActionHandler);

  // Verify appointment has become 'attended'
  let attendedDoc: any;
  await db.transaction(owner, async (sql) => {
    const row = (await sql.query('SELECT document FROM parallel_life.world_appointments WHERE id=$1', [dinnerAppointmentId])).rows[0];
    attendedDoc = row.document;
  });
  assert.equal(attendedDoc.status, 'attended', 'Calendar appointment must be marked attended upon successful scene action');
  assert.ok(attendedDoc.responseAt);

  // Verify records show appointment as attended in history
  const recordsAfterDinner = await recordsRepo.read(owner, worldId);
  const dinnerRecord = recordsAfterDinner.history.find((r) => r.navigation?.app === 'calendar' && r.navigation.invitationId === dinnerAppointmentId);
  assert.ok(dinnerRecord, 'Attended dinner must be in history records');
  assert.equal(dinnerRecord.state, 'attended');
  } catch (err) {
    console.error('NAR-03 TEST ERROR:', err);
    throw err;
  }
});
