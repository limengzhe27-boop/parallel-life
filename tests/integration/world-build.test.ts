import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
test('world build persists genesis, isolates owners, deduplicates and fences cancelled results', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    queue = new PostgresTaskQueue(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    owner = randomUUID(),
    other = randomUUID();
  try {
    const identity = new IdentityRepository(db);
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    const profiles = new ProfileRepository(db);
    let p = await profiles.edit(owner, {
      expectedVersion: 0,
      operation: {
        kind: 'set-fact',
        category: 'identity',
        value: '个人资料\n姓名：资料测试\n生日：1998-06-18\n所在城市：杭州',
      },
    });
    assert.equal((await new ProfileRepository(db).get(owner)).facts[0]?.value, p.facts[0]?.value);
    const seedId = randomUUID();
    const seed = {
      id: seedId,
      createdAt: new Date().toISOString(),
      profileVersion: p.version,
      discoveryVersion: 1,
      directionId: randomUUID(),
      story: {
        title: '如果开一间维修铺',
        premise: '修理社区单车',
        opening: '清晨开门',
        tradeoff: '收入不稳定',
      },
      facts: [],
      people: [],
      portraitAssetId: null,
      assets: [],
    };
    await db.transaction(owner, (sql) =>
      sql.query(
        'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
        [seedId, owner, p.id, randomUUID(), 'fixture', seed],
      ),
    );
    const builds = new BuildRepository(db),
      tasks = new TaskRepository(db),
      request = { seedId, commandId: randomUUID() };
    const first = await builds.create(owner, request);
    assert.equal((await builds.create(owner, request)).task?.id, first.task?.id);
    assert.equal(
      (await builds.create(owner, { ...request, commandId: randomUUID() })).worldId,
      first.worldId,
    );
    await assert.rejects(builds.create(other, { ...request, commandId: randomUUID() }), {
      code: 'NOT_FOUND',
    });
    assert.deepEqual(await builds.list(other), []);
    await assert.rejects(builds.phone(owner, first.worldId), { code: 'NOT_FOUND' });
    const output = {
      identity: '社区维修铺店主',
      setting: '杭州的清晨',
      actors: ['a', 'b', 'c'].map((key) => ({
        key,
        name: key,
        relationship: '邻居',
        persona: '喜欢骑车',
      })),
      messages: [{ actorKey: 'a', text: '店开了吗？我车胎有点漏气。' }],
      notes: [{ title: '今天', text: '检查工具' }],
    };
    const slow = new WorldPlanner({
      async complete() {
        await tasks.cancel(owner, first.task!.id);
        return JSON.stringify(output);
      },
    });
    await runOne(queue, { 'world-build': buildHandler(queue, slow, 'test-model') });
    assert.equal((await builds.list(owner))[0]?.ready, false);
    assert.equal((await tasks.get(owner, first.task!.id)).status, 'cancelled');
    await tasks.retry(owner, first.task!.id, randomUUID());
    const planner = new WorldPlanner({
      async complete() {
        return JSON.stringify(output);
      },
    });
    await runOne(queue, { 'world-build': buildHandler(queue, planner, 'test-model') });
    const ready = (await new BuildRepository(db).list(owner))[0]!;
    assert.equal(ready.ready, true);
    assert.equal(ready.task?.status, 'succeeded');
    assert.equal(ready.worldId, first.worldId);
    const phone = await new BuildRepository(db).phone(owner, first.worldId);
    assert.equal(phone.messages.length, 1);
    assert.equal(phone.actors.length, 3);
    assert.equal(phone.notes[0]?.title, '今天');
    await assert.rejects(builds.phone(other, first.worldId), { code: 'NOT_FOUND' });
    const snapshot = (
      await admin.query(
        'SELECT state,approved_seed FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
        [first.worldId],
      )
    ).rows[0];
    assert.equal(snapshot.state.version, 0);
    assert.deepEqual(snapshot.approved_seed, seed);
    assert.equal((await builds.create(owner, { ...request, commandId: randomUUID() })).ready, true);
    assert.equal(
      (
        await admin.query('SELECT count(*)::int count FROM parallel_life.worlds WHERE id=$1', [
          first.worldId,
        ])
      ).rows[0].count,
      1,
    );
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
    await admin.end();
  }
});
