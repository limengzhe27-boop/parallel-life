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
import {
  DiscoveryPlanner,
  DISCOVERY_PROMPT_VERSION,
} from '../../src/modules/discovery/infrastructure/discovery-planner.ts';
import { discoveryHandler } from '../../src/modules/discovery/infrastructure/discovery-handler.ts';
import { DraftRepository } from '../../src/modules/discovery/infrastructure/draft-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { YibuTextModel } from '../../src/modules/ai/infrastructure/yibu-text-model.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import type { Task } from '../../src/contracts/api.ts';
const config = {
  apiKey: 'private-recovery-fixture-key',
  model: 'test-recovery-model',
  baseUrl: 'https://yibuapi.com',
  timeoutMs: 20,
};
const positive = {
  title: '舞台摄影师的一天',
  premise: '作为舞台摄影师跟剧组拍演出',
  opening: '演出即将开场',
  tradeoff: '需要应对现场灯光',
  reason: '本次想法',
  sourceFactIds: [],
};
function untilAbort(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(Error('fixture abort missing')), 1000);
    const fail = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}
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
  const profiles = new ProfileRepository(db),
    repo = new DiscoveryRepository(db),
    tasks = new TaskRepository(db),
    drafts = new DraftRepository(db);
  const profile = await profiles.edit(owner, {
    expectedVersion: 0,
    operation: { kind: 'set-fact', category: 'interest', value: '合成维修自行车爱好' },
  });
  const execute = (task: Task, planner: DiscoveryPlanner) =>
    runOne(
      {
        claim: () => queue.claimForOwner(task.id, owner, ['profile']),
        renew: queue.renew.bind(queue),
        finish: queue.finish.bind(queue),
      },
      { profile: discoveryHandler(queue, planner, config.model) },
    );
  const base = {
    expectedVersion: 0,
    expectedProfileVersion: profile.version,
    mode: 'focused' as const,
    brief: '我想体验舞台摄影师',
    basedOnId: null,
  };
  const original = await repo.generate(owner, { ...base, commandId: randomUUID() });
  await execute(
    original,
    new DiscoveryPlanner({
      async complete() {
        return JSON.stringify({ directions: [positive] });
      },
    }),
  );
  const before = await repo.get(owner),
    snapshot = await drafts.prepare(owner, {
      commandId: randomUUID(),
      directionId: before.directions[0]!.id,
      discoveryVersion: before.version,
    });
  return {
    admin,
    db,
    queue,
    owner,
    other,
    profile,
    profiles,
    repo,
    tasks,
    drafts,
    before,
    snapshot,
    execute,
    base: { ...base, expectedVersion: before.version },
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
for (const sample of ['request', 'response', 'parse', 'proposal'] as const) {
  test(`real PostgreSQL recovery: ${sample} failure preserves prior proposals, metadata and no automatic execution`, async (t) => {
    const f = await fixture();
    let calls = 0;
    const logs: string[] = [];
    t.mock.method(console, 'error', (line: string) => logs.push(line));
    t.mock.method(console, 'warn', () => {});
    try {
      const transport: typeof fetch = async (_url, init) => {
        calls++;
        if (sample === 'request') return untilAbort(init!.signal!);
        if (sample === 'response')
          return new Response(
            new ReadableStream({
              start(controller) {
                void untilAbort(init!.signal!).catch((e) => controller.error(e));
              },
            }),
            { status: 200 },
          );
        if (sample === 'parse')
          return new Response('private-recovery-provider-body: bad JSON', { status: 200 });
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  directions: [{ ...positive, premise: '改成舞台设计师' }],
                }),
              },
            },
          ],
        });
      };
      const request = { ...f.base, commandId: randomUUID() },
        task = await f.repo.generate(f.owner, request);
      await f.execute(task, new DiscoveryPlanner(new YibuTextModel(config, transport)));
      const saved = await f.tasks.get(f.owner, task.id);
      assert.equal(saved.status, ['request', 'response'].includes(sample) ? 'unknown' : 'failed');
      assert.equal(
        saved.errorCode,
        ['request', 'response'].includes(sample) ? 'UNKNOWN' : 'INVALID_AI_OUTPUT',
      );
      const row = (
        await f.admin.query(
          'SELECT model,prompt_version,duration_ms FROM parallel_life.tasks WHERE id=$1',
          [task.id],
        )
      ).rows[0];
      assert.equal(row.model, config.model);
      assert.equal(row.prompt_version, DISCOVERY_PROMPT_VERSION);
      assert(Number.isInteger(row.duration_ms) && row.duration_ms >= 0 && row.duration_ms < 10000);
      const log = JSON.parse(logs.find((l) => JSON.parse(l).taskId === task.id)!);
      assert.equal(log.durationMs, row.duration_ms);
      assert.equal(log.stage, sample);
      assert.equal(log.httpStatus, sample === 'request' || sample === 'proposal' ? undefined : 200);
      assert.doesNotMatch(logs.join(''), /private-recovery/);
      assert.deepEqual((await f.repo.get(f.owner)).directions, f.before.directions);
      assert.equal((await f.repo.get(f.owner)).version, f.before.version);
      assert.deepEqual(await f.profiles.get(f.owner), f.profile);
      assert.deepEqual(await f.drafts.get(f.owner, f.snapshot.id), f.snapshot);
      assert.equal((await f.repo.generate(f.owner, request)).id, task.id);
      assert.equal(
        await f.execute(task, new DiscoveryPlanner(new YibuTextModel(config, transport))),
        false,
      );
      assert.equal(calls, sample === 'proposal' ? 2 : 1);
      await assert.rejects(f.tasks.get(f.other, task.id), { code: 'NOT_FOUND' });
    } finally {
      await f.close();
    }
  });
}
