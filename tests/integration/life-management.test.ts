import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  WorldListItemSchema,
  WorldListResponseSchema,
  WorldPatchRequestSchema,
} from '../../src/contracts/life-management.ts';

test('L-01: Life management - listing, switching, renaming, archiving, deletion and isolation', async (t) => {
  const cfg = await localConfig();
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);

  const app = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const repo = new PostgresWorldRepository(app);
  const clockStore = new PostgresClockStore(app);

  const userA = randomUUID();
  const userB = randomUUID();
  const world1Id = randomUUID();
  const world2Id = randomUUID();
  const world3Id = randomUUID();
  const worldBId = randomUUID();

  t.after(async () => {
    await admin.query('DELETE FROM parallel_life.world_clock WHERE world_id=ANY($1)', [
      [world1Id, world2Id, world3Id, worldBId],
    ]);
    await admin.query('DELETE FROM parallel_life.worlds WHERE id=ANY($1)', [
      [world1Id, world2Id, world3Id, worldBId],
    ]);
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[userA, userB]]);
    await app.close();
    await admin.end();
  });

  // 1. Setup accounts
  await admin.query(
    `INSERT INTO parallel_life.accounts (id, kind)
     VALUES ($1, 'guest'), ($2, 'guest') ON CONFLICT DO NOTHING`,
    [userA, userB],
  );

  // 2. Setup worlds for userA
  // World 1: Active with 2 actors and 2 messages
  await admin.query(
    `INSERT INTO parallel_life.worlds (id, owner_id, version, title, state, created_at, updated_at)
     VALUES ($1, $2, 2, '海边咖啡馆的人生', $3, now() - interval '2 hours', now() - interval '1 hour')`,
    [
      world1Id,
      userA,
      {
        id: world1Id,
        title: '海边咖啡馆的人生',
        version: 2,
        time: '2026-10-17T08:00:00.000Z',
        setting: '海边小镇，风很温柔。',
        actors: [
          { id: 'actor-1', name: '青青', relationship: '咖啡店主' },
          { id: 'actor-2', name: '林白语', relationship: '常客' },
        ],
        messages: [
          { id: 'msg-1', actorId: 'actor-1', role: 'assistant', text: '欢迎来到海边咖啡馆！' },
          { id: 'msg-2', actorId: 'actor-2', role: 'assistant', text: '今天特调是海风冷萃。' },
        ],
        appointments: [],
      },
    ],
  );
  await clockStore.setClock(userA, world1Id, { paused: false });

  // World 2: Active world with 1 actor
  await admin.query(
    `INSERT INTO parallel_life.worlds (id, owner_id, version, title, state, created_at, updated_at)
     VALUES ($1, $2, 1, '山林木屋隐居记', $3, now() - interval '1 hour', now() - interval '30 minutes')`,
    [
      world2Id,
      userA,
      {
        id: world2Id,
        title: '山林木屋隐居记',
        version: 1,
        time: '2026-10-17T09:00:00.000Z',
        setting: '深山木屋，炉火正旺。',
        actors: [{ id: 'actor-3', name: '守林人', relationship: '邻居' }],
        messages: [{ id: 'msg-3', actorId: 'actor-3', role: 'assistant', text: '下雪了，喝点热茶吧。' }],
        appointments: [],
      },
    ],
  );
  await clockStore.setClock(userA, world2Id, { paused: false });

  // World 3: Another active world
  await admin.query(
    `INSERT INTO parallel_life.worlds (id, owner_id, version, title, state, created_at, updated_at)
     VALUES ($1, $2, 1, '都市创业风云', $3, now() - interval '20 minutes', now() - interval '10 minutes')`,
    [
      world3Id,
      userA,
      {
        id: world3Id,
        title: '都市创业风云',
        version: 1,
        time: '2026-10-17T10:00:00.000Z',
        setting: '繁华都市，新创公司。',
        actors: [],
        messages: [],
        appointments: [],
      },
    ],
  );
  await clockStore.setClock(userA, world3Id, { paused: false });

  // Setup World for userB
  await admin.query(
    `INSERT INTO parallel_life.worlds (id, owner_id, version, title, state, created_at, updated_at)
     VALUES ($1, $2, 1, '用户B的私密人生', $3, now(), now())`,
    [
      worldBId,
      userB,
      {
        id: worldBId,
        title: '用户B的私密人生',
        version: 1,
        time: '2026-10-17T11:00:00.000Z',
        actors: [{ id: 'actor-b', name: '管家' }],
        messages: [],
        appointments: [],
      },
    ],
  );
  await clockStore.setClock(userB, worldBId, { paused: false });

  // Test 1: listUserWorlds returns user's worlds with correct sorting and isolation
  await t.test('1. listUserWorlds returns userA worlds and isolates userB', async () => {
    const listA = await repo.listUserWorlds(userA);
    assert.equal(listA.length, 3);
    // Ordered by updated_at DESC: World 3, World 2, World 1
    assert.equal(listA[0]!.id, world3Id);
    assert.equal(listA[1]!.id, world2Id);
    assert.equal(listA[2]!.id, world1Id);

    // Validate schema
    assert.doesNotThrow(() => WorldListResponseSchema.parse({ worlds: listA }));

    // Details for World 1
    const w1 = listA.find((w) => w.id === world1Id)!;
    assert.equal(w1.title, '海边咖啡馆的人生');
    assert.equal(w1.version, 2);
    assert.equal(w1.status, 'active');
    assert.equal(w1.archivedAt, null);
    assert.equal(w1.actorCount, 2);
    assert.equal(w1.previewText, '今天特调是海风冷萃。');

    // Details for World 3 (no messages, uses setting)
    const w3 = listA.find((w) => w.id === world3Id)!;
    assert.equal(w3.previewText, '繁华都市，新创公司。');

    // Isolation: userB only sees their own world
    const listB = await repo.listUserWorlds(userB);
    assert.equal(listB.length, 1);
    assert.equal(listB[0]!.id, worldBId);
    assert.equal(listB[0]!.title, '用户B的私密人生');
  });

  // Test 2: renameWorld updates title and preserves constraints
  await t.test('2. renameWorld updates title and checks input bounds', async () => {
    const renamed = await repo.renameWorld(userA, world1Id, '海边漫步与晨曦小酒馆');
    assert.equal(renamed.id, world1Id);
    assert.equal(renamed.title, '海边漫步与晨曦小酒馆');

    // Verify in database
    const check = await repo.listUserWorlds(userA);
    const updated = check.find((w) => w.id === world1Id)!;
    assert.equal(updated.title, '海边漫步与晨曦小酒馆');

    // Constraint: empty title rejected
    await assert.rejects(repo.renameWorld(userA, world1Id, ''), /INVALID_COMMAND/);
    await assert.rejects(repo.renameWorld(userA, world1Id, '   '), /INVALID_COMMAND/);

    // Constraint: title too long (>60) rejected
    await assert.rejects(
      repo.renameWorld(userA, world1Id, 'A'.repeat(61)),
      /INVALID_COMMAND/,
    );
  });

  // Test 3: archiveWorld pauses clock and filters by status
  await t.test('3. archiveWorld pauses clock and updates lifecycle status', async () => {
    const archived = await repo.archiveWorld(userA, world2Id);
    assert.equal(archived.id, world2Id);
    assert.equal(archived.status, 'archived');
    assert.ok(archived.archivedAt);

    // Clock should now be paused
    const clock = await clockStore.read(userA, world2Id);
    assert.equal(clock.paused, true);

    // Filter 'active' (default) excludes world2
    const activeList = await repo.listUserWorlds(userA, { status: 'active' });
    assert.equal(activeList.length, 2);
    assert.ok(!activeList.some((w) => w.id === world2Id));

    // Filter 'archived' only includes world2
    const archivedList = await repo.listUserWorlds(userA, { status: 'archived' });
    assert.equal(archivedList.length, 1);
    assert.equal(archivedList[0]!.id, world2Id);
    assert.equal(archivedList[0]!.status, 'archived');

    // Filter 'all' includes all 3
    const allList = await repo.listUserWorlds(userA, { status: 'all' });
    assert.equal(allList.length, 3);
  });

  // Test 4: restoreWorld unarchives and returns to active
  await t.test('4. restoreWorld restores archived life to active status', async () => {
    const restored = await repo.restoreWorld(userA, world2Id);
    assert.equal(restored.id, world2Id);
    assert.equal(restored.status, 'active');

    const activeList = await repo.listUserWorlds(userA, { status: 'active' });
    assert.equal(activeList.length, 3);
    const item = activeList.find((w) => w.id === world2Id)!;
    assert.equal(item.status, 'active');
    assert.equal(item.archivedAt, null);
  });

  // Test 5: deleteWorld soft-deletes, pauses clock, and excludes from lists
  await t.test('5. deleteWorld soft-deletes and makes world inaccessible', async () => {
    const deleted = await repo.deleteWorld(userA, world3Id);
    assert.equal(deleted.id, world3Id);
    assert.equal(deleted.status, 'deleted');

    // Excluded from all list filters
    const allList = await repo.listUserWorlds(userA, { status: 'all' });
    assert.equal(allList.length, 2);
    assert.ok(!allList.some((w) => w.id === world3Id));

    // get() throws NOT_FOUND
    await assert.rejects(repo.get({ userId: userA }, world3Id), /NOT_FOUND/);

    // Operations on deleted world throw NOT_FOUND
    await assert.rejects(repo.renameWorld(userA, world3Id, '新名字'), /NOT_FOUND/);
    await assert.rejects(repo.archiveWorld(userA, world3Id), /NOT_FOUND/);
    await assert.rejects(repo.restoreWorld(userA, world3Id), /NOT_FOUND/);
    await assert.rejects(repo.deleteWorld(userA, world3Id), /NOT_FOUND/);
  });

  // Test 6: Cross-user permission boundaries
  await t.test('6. cross-user manipulation attempts strictly rejected with NOT_FOUND', async () => {
    // userA cannot rename userB's world
    await assert.rejects(repo.renameWorld(userA, worldBId, '非法窃取'), /NOT_FOUND/);

    // userA cannot archive userB's world
    await assert.rejects(repo.archiveWorld(userA, worldBId), /NOT_FOUND/);

    // userA cannot restore userB's world
    await assert.rejects(repo.restoreWorld(userA, worldBId), /NOT_FOUND/);

    // userA cannot delete userB's world
    await assert.rejects(repo.deleteWorld(userA, worldBId), /NOT_FOUND/);

    // userA cannot get userB's world
    await assert.rejects(repo.get({ userId: userA }, worldBId), /NOT_FOUND/);

    // userB's world remains untouched and intact
    const bWorlds = await repo.listUserWorlds(userB);
    assert.equal(bWorlds.length, 1);
    assert.equal(bWorlds[0]!.title, '用户B的私密人生');
  });

  // Test 7: Contracts schema validation
  await t.test('7. WorldPatchRequestSchema validates requests properly', async () => {
    assert.ok(WorldPatchRequestSchema.safeParse({ title: '合法标题' }).success);
    assert.ok(WorldPatchRequestSchema.safeParse({ action: 'archive' }).success);
    assert.ok(WorldPatchRequestSchema.safeParse({ action: 'restore' }).success);
    assert.ok(WorldPatchRequestSchema.safeParse({ title: '合法', action: 'archive' }).success);

    // Neither provided
    assert.ok(!WorldPatchRequestSchema.safeParse({}).success);
    // Invalid action
    assert.ok(!WorldPatchRequestSchema.safeParse({ action: 'destroy' }).success);
    // Empty title
    assert.ok(!WorldPatchRequestSchema.safeParse({ title: '' }).success);
  });
});
