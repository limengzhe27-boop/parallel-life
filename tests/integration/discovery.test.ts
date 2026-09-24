import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { DiscoveryRepository } from '../../src/modules/discovery/infrastructure/discovery-repository.ts';
import { DiscoveryPlanner } from '../../src/modules/discovery/infrastructure/discovery-planner.ts';
import { discoveryHandler } from '../../src/modules/discovery/infrastructure/discovery-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
test('discovery persists personalized revisions, rejects stale commits, supports retries and isolates owners', async () => {
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
    const repo = new DiscoveryRepository(db),
      profiles = new ProfileRepository(db),
      tasks = new TaskRepository(db);
    await assert.rejects(
      repo.generate(owner, {
        commandId: randomUUID(),
        expectedVersion: 0,
        expectedProfileVersion: 0,
        brief: '',
        basedOnId: null,
      }),
      { code: 'INVALID_INPUT' },
    );
    const profile = await profiles.edit(owner, {
      expectedVersion: 0,
      operation: { kind: 'set-fact', category: 'interest', value: '喜欢维修自行车' },
    });
    const request = {
      commandId: randomUUID(),
      expectedVersion: 0,
      expectedProfileVersion: profile.version,
      brief: '',
      basedOnId: null,
    };
    const task = await repo.generate(owner, request);
    assert.equal((await repo.generate(owner, request)).id, task.id);
    await assert.rejects(repo.generate(owner, { ...request, brief: 'changed' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    assert.deepEqual((await repo.get(other)).directions, []);
    await assert.rejects(tasks.get(other, task.id), { code: 'NOT_FOUND' });
    const planner = new DiscoveryPlanner({
      async complete(messages) {
        const { basis } = JSON.parse(messages[1]!.content);
        return JSON.stringify({
          directions: ['开一家小店', '骑着车去修车', '教大家修车'].map((title) => ({
            title,
            premise: '虚构生活',
            opening: '一个周末的新开场',
            tradeoff: '自由与收入的不确定',
            reason: '你喜欢修车',
            sourceFactIds: [basis[0].factId],
          })),
        });
      },
    });
    await runOne(queue, { profile: discoveryHandler(queue, planner, 'test-model') });
    const saved = await new DiscoveryRepository(db).get(owner);
    assert.equal(saved.version, 1);
    assert.equal(saved.directions.length, 3);
    assert.equal(saved.activeTask?.status, 'succeeded');
    assert.equal(saved.directions[0]?.sources[0]?.value, '喜欢维修自行车');
    const next = {
      ...request,
      commandId: randomUUID(),
      expectedVersion: 1,
      brief: '想要轻松一些',
      basedOnId: saved.directions[0]!.id,
    };
    const cancelled = await repo.generate(owner, next);
    await tasks.cancel(owner, cancelled.id);
    const retryId = randomUUID();
    const retried = await tasks.retry(owner, cancelled.id, retryId);
    assert.equal((await tasks.retry(owner, cancelled.id, retryId)).id, retried.id);
    const slow = new DiscoveryPlanner({
      async complete(messages) {
        await profiles.edit(owner, {
          expectedVersion: profile.version,
          operation: { kind: 'set-fact', category: 'wish', value: '不想离开家乡' },
        });
        return JSON.stringify({
          directions: ['甲', '乙', '丙'].map((title) => ({
            title,
            premise: '假设',
            opening: '开场',
            tradeoff: '取舍',
            reason: '兴趣',
            sourceFactIds: [JSON.parse(messages[1]!.content).basis[0].factId],
          })),
        });
      },
    });
    await runOne(queue, { profile: discoveryHandler(queue, slow, 'test-model') });
    const after = await repo.get(owner);
    assert.equal(after.version, 1);
    assert.deepEqual(after.directions, saved.directions);
    assert.equal(after.activeTask?.status, 'conflict');
    await assert.rejects(
      repo.generate(owner, { ...next, commandId: randomUUID(), expectedProfileVersion: 2 }),
      { code: 'VERSION_CONFLICT' },
    );
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
    await admin.end();
  }
});

/**
 * 根因回归：用户在对话里说"帮我创建一个分支"时，UI 曾经传空的 brief 且用可能过期的画像版本，
 * 服务端因此分别抛 INVALID_INPUT / VERSION_CONFLICT —— 表现就是"它根本不给我生成分支"。
 */
test('a branch request needs a basis: the conversation brief is what makes it work', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID();
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    const repo = new DiscoveryRepository(db),
      profiles = new ProfileRepository(db);
    const profile = await profiles.get(owner);
    const discovery = await repo.get(owner);

    /* ① 没有已确认事实、brief 为空 → 服务端拒绝（这就是用户遇到的现象："它不给我生成分支"）。 */
    await assert.rejects(
      repo.generate(owner, {
        commandId: randomUUID(),
        expectedVersion: discovery.version,
        expectedProfileVersion: profile.version,
        brief: '',
        basedOnId: null,
      }),
      { code: 'INVALID_INPUT' },
    );

    /* ② 带上"用户说过的话"作为 brief → 被接受，不再需要先凑够确认事实。 */
    const accepted = await repo.generate(owner, {
      commandId: randomUUID(),
      expectedVersion: discovery.version,
      expectedProfileVersion: profile.version,
      brief: '我在做街头摄影，想把作品整理成一册；但房租压力挺大，在犹豫要不要找份稳定工作',
      basedOnId: null,
    });
    assert.ok(accepted.id, '服务端接受了带 brief 的分支请求');

    /* ③ 画像版本过期 → VERSION_CONFLICT（UI 现在用实时版本并自动重试一次）。 */
    await assert.rejects(
      repo.generate(owner, {
        commandId: randomUUID(),
        expectedVersion: discovery.version,
        expectedProfileVersion: profile.version + 99,
        brief: '随便说点什么',
        basedOnId: null,
      }),
      { code: 'VERSION_CONFLICT' },
    );
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
