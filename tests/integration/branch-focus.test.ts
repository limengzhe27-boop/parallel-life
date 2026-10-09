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
import { DraftRepository } from '../../src/modules/discovery/infrastructure/draft-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import type { Task } from '../../src/contracts/api.ts';
async function fixture() {
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
  for (const id of [owner, other]) await new IdentityRepository(db).ensureGuest(id);
  const repo = new DiscoveryRepository(db),
    profiles = new ProfileRepository(db),
    tasks = new TaskRepository(db),
    drafts = new DraftRepository(db);
  const execute = (task: Task, planner: DiscoveryPlanner) =>
    runOne(
      {
        claim: () => queue.claimForOwner(task.id, owner, ['profile']),
        renew: queue.renew.bind(queue),
        finish: queue.finish.bind(queue),
      },
      { profile: discoveryHandler(queue, planner, 'explicit-test-double') },
    );
  return {
    admin,
    db,
    queue,
    owner,
    other,
    repo,
    profiles,
    tasks,
    drafts,
    execute,
    async close() {
      await queue.close();
      await db.close();
      await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
        [owner, other],
      ]);
      await admin.end();
    },
  };
}
const fields = (n: number, sources: string[] = []) => ({
  title: '测试虚构方向' + n,
  premise: '明确的测试替身构思',
  opening: '测试开场',
  tradeoff: '测试取舍',
  reason: '本次用户构思',
  sourceFactIds: sources,
});
test('focused mode persists one proposal, preserves old draft snapshots, binds mode to the command and isolates owners', async () => {
  const f = await fixture();
  try {
    const profile = await f.profiles.edit(f.owner, {
      expectedVersion: 0,
      operation: { kind: 'set-fact', category: 'interest', value: '喜欢修自行车' },
    });
    const base = {
      commandId: randomUUID(),
      expectedVersion: 0,
      expectedProfileVersion: profile.version,
      brief: '',
      basedOnId: null,
    };
    const oldTask = await f.repo.generate(f.owner, base);
    await f.execute(
      oldTask,
      new DiscoveryPlanner({
        async complete(messages) {
          const basis = JSON.parse(messages[1]!.content).basis;
          return JSON.stringify({ directions: [1, 2, 3].map((n) => fields(n, [basis[0].factId])) });
        },
      }),
    );
    const old = await f.repo.get(f.owner);
    assert.equal(old.directions.length, 3);
    const oldDraft = await f.drafts.prepare(f.owner, {
      commandId: randomUUID(),
      directionId: old.directions[0]!.id,
      discoveryVersion: old.version,
    });
    const request = {
      ...base,
      commandId: randomUUID(),
      expectedVersion: old.version,
      mode: 'focused' as const,
      brief: '这次想体验舞台摄影师，修车只是现实爱好',
    };
    const task = await f.repo.generate(f.owner, request);
    assert.equal((await f.repo.generate(f.owner, request)).id, task.id);
    await assert.rejects(f.repo.generate(f.owner, { ...request, mode: 'explore' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    assert.deepEqual((await f.repo.get(f.owner)).directions, old.directions);
    await assert.rejects(f.tasks.get(f.other, task.id), { code: 'NOT_FOUND' });
    await f.execute(
      task,
      new DiscoveryPlanner({
        async complete(messages) {
          assert.match(messages[0]!.content, /恰好一个方向/);
          return JSON.stringify({
            directions: [{ ...fields(4), premise: '作为舞台摄影师拍摄演出' }],
          });
        },
      }),
    );
    const saved = await f.repo.get(f.owner);
    assert.equal(saved.directions.length, 1);
    assert.equal(saved.activeTask?.status, 'succeeded');
    assert.deepEqual(saved.directions[0]!.sources, []);
    assert.equal(saved.version, old.version + 1);
    assert.deepEqual(await f.drafts.get(f.owner, oldDraft.id), oldDraft);
    assert.deepEqual(await f.profiles.get(f.owner), profile);
    assert.deepEqual((await f.repo.get(f.other)).directions, []);
    await assert.rejects(
      f.repo.generate(f.other, {
        ...request,
        commandId: randomUUID(),
        expectedVersion: 0,
        expectedProfileVersion: 0,
        basedOnId: saved.directions[0]!.id,
      }),
      { code: 'NOT_FOUND' },
    );
  } finally {
    await f.close();
  }
});
test('a focused task with uncertain upstream outcome leaves prior proposals and does not pay again on replay', async () => {
  const f = await fixture();
  try {
    const req = {
      commandId: randomUUID(),
      expectedVersion: 0,
      expectedProfileVersion: 0,
      mode: 'focused' as const,
      brief: '想体验摄影师',
      basedOnId: null,
    };
    const task = await f.repo.generate(f.owner, req);
    let calls = 0;
    const planner = new DiscoveryPlanner({
      async complete() {
        calls++;
        throw Object.assign(Error('SYNTHETIC_LOST_RESPONSE'), { code: 'UPSTREAM_FAILED' });
      },
    });
    await f.execute(task, planner);
    assert.equal((await f.tasks.get(f.owner, task.id)).status, 'unknown');
    assert.deepEqual((await f.repo.get(f.owner)).directions, []);
    assert.equal((await f.repo.generate(f.owner, req)).id, task.id);
    assert.equal(await f.execute(task, planner), false);
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});
