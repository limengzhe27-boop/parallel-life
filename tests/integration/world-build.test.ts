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
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import type { TurnCommand, WorldEvent } from '../../src/modules/world/domain/types.ts';
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
    const olderSeed = { ...seed, id: randomUUID(), directionId: randomUUID() };
    const olderWorldId = randomUUID();
    await db.transaction(owner, async (sql) => {
      await sql.query(
        'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
        [olderSeed.id, owner, p.id, randomUUID(), 'older-build-fixture', olderSeed],
      );
      await sql.query(
        'INSERT INTO parallel_life.world_builds(seed_id,owner_id,world_id) VALUES($1,$2,$3)',
        [olderSeed.id, owner, olderWorldId],
      );
    });
    const olderBuild = (await builds.list(owner)).find((item) => item.seedId === olderSeed.id);
    assert.equal(olderBuild?.worldId, olderWorldId);
    assert.equal(olderBuild?.task, null, 'a legacy build without a task still appears');
    const phone = await new BuildRepository(db).phone(owner, first.worldId);
    assert.equal(phone.messages.length, 1);
    assert.equal(phone.actors.length, 3);
    assert.equal(phone.notes[0]?.title, '今天');
    const actorId = phone.actors[0]!.id;
    const worlds = new PostgresWorldRepository(db);
    const choiceCommand: TurnCommand = {
      id: randomUUID(),
      worldId: first.worldId,
      expectedVersion: 0,
      actorId,
      text: '我决定先把短片剪到十五分钟。',
    };
    const choiceEvent: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: first.worldId,
      version: 1,
      commandId: choiceCommand.id,
      type: 'turn.resolved',
      occurredAt: new Date().toISOString(),
      data: {
        actorId,
        userText: choiceCommand.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId, text: '剪完发我看看。' },
          {
            type: 'choice.recorded',
            id: randomUUID(),
            quote: '我决定先把短片剪到十五分钟',
            intent: '完成十五分钟版本',
          },
        ],
      },
    };
    const chosen = await worlds.commit({ userId: owner }, choiceCommand, choiceEvent);
    const reportCommand: TurnCommand = {
      id: randomUUID(),
      worldId: first.worldId,
      expectedVersion: 1,
      actorId,
      text: '我把短片剪完了，十五分钟版本已经导出。',
    };
    const reportEvent: WorldEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      worldId: first.worldId,
      version: 2,
      commandId: reportCommand.id,
      type: 'turn.resolved',
      occurredAt: new Date().toISOString(),
      data: {
        actorId,
        userText: reportCommand.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId, text: '发我文件，我看看。' },
          {
            type: 'choice.result_reported',
            id: randomUUID(),
            choiceId: chosen.state.choices![0]!.id,
            quote: '我把短片剪完了，十五分钟版本已经导出',
            outcome: 'reported_done',
          },
        ],
      },
    };
    await worlds.commit({ userId: owner }, reportCommand, reportEvent);
    const storyPhone = await new BuildRepository(db).phone(owner, first.worldId);
    assert.equal(storyPhone.choices?.length, 1);
    assert.equal(storyPhone.choices?.[0]?.sourceEventId, choiceEvent.id);
    assert.equal(storyPhone.choices?.[0]?.result?.sourceEventId, reportEvent.id);
    assert.equal(storyPhone.choices?.[0]?.result?.kind, 'reported_done');
    assert.equal(storyPhone.choices?.[0]?.at, choiceEvent.occurredAt);
    assert.equal(storyPhone.choices?.[0]?.result?.at, reportEvent.occurredAt);
    await assert.rejects(builds.phone(other, first.worldId), { code: 'NOT_FOUND' });
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
