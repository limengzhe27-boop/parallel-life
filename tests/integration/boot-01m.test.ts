import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
import { replayWorldHistory } from '../../src/modules/world/domain/world-history.ts';
import { worldAppData } from '../../src/features/phone/world-app-data.ts';
import { projectMessageNotifications } from '../../src/features/phone/notification-projection.ts';
import type { WorldOpening } from '../../src/contracts/world-build.ts';
const proposal = (): WorldOpening => ({
  identity: '社区维修铺店主',
  setting: '社区清晨',
  actors: [
    { key: 'a', name: '阿陈', relationship: '隔壁店主', persona: '不公开的A自己的内心' },
    { key: 'b', name: '小林', relationship: '同行', persona: '不公开的B自己的内心' },
    { key: 'c', name: '周叔', relationship: '街坊', persona: '不公开的C自己的内心' },
  ],
  messageHistory: {
    version: 1,
    messages: [
      {
        key: 'a_1',
        actorKey: 'a',
        text: '上周借的打气筒还在我这，开门再取。',
        minutesBeforeStart: 10080,
      },
      { key: 'b_1', actorKey: 'b', text: '前天说的刹车配件还有一套。', minutesBeforeStart: 2880 },
      {
        key: 'c_1',
        actorKey: 'c',
        text: '昨天经过铺子，门口那盏灯已经修好。',
        minutesBeforeStart: 1440,
      },
      {
        key: 'a_2',
        actorKey: 'a',
        text: '打气筒我放在柜台下了。',
        minutesBeforeStart: 120,
        replyToKey: 'a_1',
      },
    ],
  },
  messages: [
    { actorKey: 'a', text: '今天开门吗？' },
    { actorKey: 'b', text: '配件要先留下吗？' },
  ],
  notes: [{ title: '内部线索', text: '没有公开来源不能作为便签' }],
});
test('BOOT message genesis persists one immutable read baseline with real owner transactions', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    other = randomUUID(),
    builds = new BuildRepository(db),
    tasks = new TaskRepository(db),
    worlds = new PostgresWorldRepository(db);
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    await new IdentityRepository(db).ensureGuest(other);
    const profile = await new ProfileRepository(db).get(owner);
    async function create() {
      const id = randomUUID(),
        seed = {
          id,
          createdAt: new Date().toISOString(),
          profileVersion: profile.version,
          discoveryVersion: 1,
          directionId: randomUUID(),
          story: {
            title: '前史真实事务验收',
            premise: '经营社区维修铺',
            opening: '清晨开门',
            tradeoff: '自己协调时间',
          },
          facts: [],
          people: [],
          portraitAssetId: null,
          assets: [],
        };
      await db.transaction(owner, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
          [id, owner, profile.id, randomUUID(), 'explicit-boot-test-fixture', seed],
        ),
      );
      const request = { seedId: id, commandId: randomUUID() },
        build = await builds.create(owner, request),
        lease = await queue.claimForOwner(build.task!.id, owner, ['world-build']);
      assert(lease);
      return { seed, request, build, lease };
    }
    await t.test(
      'disabled production write preserves current-only genesis without invented history',
      async () => {
        const f = await create();
        const opening = proposal();
        delete opening.messageHistory;
        const planner = new WorldPlanner(
          {
            async complete() {
              return JSON.stringify(opening);
            },
          },
          { historyEnabled: false },
        );
        await buildHandler(
          queue,
          planner,
          'explicit-fixture',
        )(f.lease, new AbortController().signal);
        const state = await worlds.get({ userId: owner }, f.build.worldId);
        assert.equal(state.messageHistory, undefined);
        assert.equal(state.messages.length, opening.messages.length);
        assert(state.messages.every((m) => m.initialRead === undefined && m.history === undefined));
        assert.equal((await tasks.get(owner, f.build.task!.id)).status, 'succeeded');
      },
    );
    await t.test(
      'fixed request start, stable references, read projection, NPC isolation and replay persist through reload',
      async () => {
        const f = await create();
        let anchor = '';
        await buildHandler(
          queue,
          new WorldPlanner({
            async complete(messages) {
              anchor = JSON.parse(messages[1]!.content).storyTime.startAt;
              return JSON.stringify(proposal());
            },
          }),
          'explicit-fixture',
        )(f.lease, new AbortController().signal);
        const phone = await builds.phone(owner, f.build.worldId),
          state = await worlds.get({ userId: owner }, f.build.worldId);
        assert.equal(state.messageHistory!.startAt, anchor);
        assert.equal(state.time, anchor);
        assert.equal(state.messages.length, 6);
        assert(state.messages.every((m) => m.role === 'assistant'));
        const initial = (
          await admin.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [state.id],
          )
        ).rows[0].state;
        assert.deepEqual(state.messages, initial.messages);
        assert.deepEqual(replayWorldHistory(initial, []).world.messages, state.messages);
        assert.equal(
          new Set(
            state.messages.filter((m) => m.initialRead === false).map((m) => m.at.slice(0, 16)),
          ).size,
          2,
        );
        for (const actor of state.actors) {
          assert(state.messages.some((m) => m.actorId === actor.id && m.initialRead));
          const own = actorContext(state, actor.id, '以前那件事');
          assert(own.messages.every((m) => m.actorId === actor.id));
        }
        const a = state.messages.find((m) => m.history?.key === 'a_2')!,
          old = state.messages.find((m) => m.history?.key === 'a_1')!;
        assert.equal(a.history!.replyToMessageId, old.id);
        assert(!JSON.stringify(phone).includes('不公开'));
        assert.equal(phone.actors.length, 3);
        assert.equal(phone.messages.filter((m) => m.origin === 'fictional_history').length, 4);
        assert.deepEqual(phone.notes, []);
        const data = worldAppData(phone);
        assert.equal(
          data.contacts.reduce((n, x) => n + x.unread, 0),
          2,
        );
        assert.equal(
          projectMessageNotifications(data.messages, data.contacts, new Set(), (x) => x).length,
          2,
        );
        assert.deepEqual((await builds.phone(owner, state.id)).messages, phone.messages);
        assert.deepEqual((await worlds.get({ userId: owner }, state.id)).messages, state.messages);
        assert.equal((await builds.create(owner, f.request)).worldId, state.id);
        assert.equal(
          (await builds.create(owner, { ...f.request, commandId: randomUUID() })).worldId,
          state.id,
        );
        await assert.rejects(builds.phone(other, state.id), { code: 'NOT_FOUND' });
        await assert.rejects(worlds.get({ userId: other }, state.id), { code: 'NOT_FOUND' });
        assert.equal((await tasks.get(owner, f.build.task!.id)).status, 'succeeded');
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int AS n FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
              [state.id],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      'write boundary independently refuses forged player history before creating any world',
      async () => {
        const f = await create(),
          bad = proposal();
        (bad.messageHistory!.messages[0] as unknown as Record<string, unknown>).role = 'user';
        const bypass = { propose: async () => bad } as unknown as WorldPlanner;
        await assert.rejects(
          buildHandler(
            queue,
            bypass,
            'explicit-invalid-fixture',
          )(f.lease, new AbortController().signal),
          /INVALID_MESSAGE_HISTORY/,
        );
        assert.equal(
          (await builds.list(owner)).find((x) => x.worldId === f.build.worldId)!.ready,
          false,
        );
        assert.equal(
          (
            await admin.query('SELECT count(*)::int AS n FROM parallel_life.worlds WHERE id=$1', [
              f.build.worldId,
            ])
          ).rows[0].n,
          0,
        );
        await tasks.cancel(owner, f.build.task!.id);
      },
    );
    await t.test(
      'cancelled lease cannot commit a half world, history snapshot or successful task',
      async () => {
        const f = await create();
        const planner = new WorldPlanner({
          async complete() {
            await tasks.cancel(owner, f.build.task!.id);
            return JSON.stringify(proposal());
          },
        });
        await assert.rejects(
          buildHandler(
            queue,
            planner,
            'explicit-cancel-fixture',
          )(f.lease, new AbortController().signal),
        );
        for (const table of ['worlds', 'world_initial_snapshots'])
          assert.equal(
            (
              await admin.query(
                `SELECT count(*)::int AS n FROM parallel_life.${table} WHERE ${table === 'worlds' ? 'id' : 'world_id'}=$1`,
                [f.build.worldId],
              )
            ).rows[0].n,
            0,
          );
        assert.equal((await tasks.get(owner, f.build.task!.id)).status, 'cancelled');
        assert.equal(
          (await builds.list(owner)).find((x) => x.worldId === f.build.worldId)!.ready,
          false,
        );
      },
    );
    await t.test(
      'failure after world insert rolls back the entire genesis and leaves no success receipt',
      async () => {
        const f = await create();
        await admin.query(
          `CREATE FUNCTION parallel_life.boot01m_test_fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.world_id='${f.build.worldId}' THEN RAISE EXCEPTION 'BOOT_TEST_SNAPSHOT_FAILURE'; END IF; RETURN NEW; END $$`,
        );
        await admin.query(
          'CREATE TRIGGER boot01m_test_fail_snapshot BEFORE INSERT ON parallel_life.world_initial_snapshots FOR EACH ROW EXECUTE FUNCTION parallel_life.boot01m_test_fail_snapshot()',
        );
        try {
          await assert.rejects(
            buildHandler(
              queue,
              new WorldPlanner({
                async complete() {
                  return JSON.stringify(proposal());
                },
              }),
              'explicit-failure-fixture',
            )(f.lease, new AbortController().signal),
            /BOOT_TEST_SNAPSHOT_FAILURE/,
          );
        } finally {
          await admin.query(
            'DROP TRIGGER boot01m_test_fail_snapshot ON parallel_life.world_initial_snapshots',
          );
          await admin.query('DROP FUNCTION parallel_life.boot01m_test_fail_snapshot()');
        }
        assert.equal(
          (
            await admin.query('SELECT count(*)::int AS n FROM parallel_life.worlds WHERE id=$1', [
              f.build.worldId,
            ])
          ).rows[0].n,
          0,
        );
        assert.equal(
          (await builds.list(owner)).find((x) => x.worldId === f.build.worldId)!.ready,
          false,
        );
        assert.equal((await tasks.get(owner, f.build.task!.id)).status, 'running');
        await tasks.cancel(owner, f.build.task!.id);
      },
    );
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
    await admin.end();
  }
});
