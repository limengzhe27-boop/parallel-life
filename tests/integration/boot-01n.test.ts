import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { LifeSettingContentSchema } from '../../src/contracts/life-settings.ts';
import { settingContent } from '../fixtures/life-setting.ts';
import { ApprovedSeedSchema, type ApprovedSeed } from '../../src/contracts/seeds.ts';
import { SettingDraftRepository } from '../../src/modules/settings/infrastructure/setting-draft-repository.ts';
import { SettingTrialRepository } from '../../src/modules/settings/infrastructure/setting-trial-repository.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
import { worldAppData } from '../../src/features/phone/world-app-data.ts';
import { projectMessageNotifications } from '../../src/features/phone/notification-projection.ts';
import type { TextModel } from '../../src/modules/ai/application/ports.ts';
const opening = {
  identity: '社区维修铺店主',
  setting: '杭州的社区维修铺',
  actors: ['a', 'b', 'c'].map((key, i) => ({
    key,
    name: '街坊' + i,
    relationship: '邻居',
    persona: '不公开的幕后动机' + i,
  })),
  messages: [{ actorKey: 'a', text: '今天能先检查自行车吗？' }],
  notes: [{ title: '待核对', text: '库存与配件' }],
};
// Explicit synthetic model output. This file verifies persistence, never claims provider generation success.
test('two-step builds atomically persist complete historical baseline for ordinary and authored worlds', async (t) => {
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
    other = randomUUID(),
    builds = new BuildRepository(db),
    tasks = new TaskRepository(db),
    worlds = new PostgresWorldRepository(db);
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    await new IdentityRepository(db).ensureGuest(other);
    const profile = await new ProfileRepository(db).get(owner);
    async function create(authored = false) {
      if (authored) {
        const draft = await new SettingDraftRepository(db).create(owner, {
          commandId: randomUUID(),
          content: LifeSettingContentSchema.parse(settingContent()),
        });
        const commandId = randomUUID();
        const build = await new SettingTrialRepository(db).create(owner, draft.id, {
          commandId,
          version: draft.version,
        });
        const request = { seedId: build.seedId, commandId };
        const lease = await queue.claimForOwner(build.task!.id, owner, ['world-build']);
        assert(lease);
        return { request, build, lease };
      }
      const id = randomUUID(),
        content = settingContent();
      const seed: ApprovedSeed = ApprovedSeedSchema.parse(
        authored
          ? {
              id,
              createdAt: new Date().toISOString(),
              source: { kind: 'setting_draft', draftId: randomUUID(), version: 0 },
              settingContent: content,
              story: content.story,
              setup: content.setup,
              people: [],
              facts: [],
              events: [],
              assets: [],
              portraitAssetId: null,
            }
          : {
              id,
              createdAt: new Date().toISOString(),
              profileVersion: profile.version,
              discoveryVersion: 1,
              directionId: randomUUID(),
              story: {
                title: '两步事务夹具',
                premise: '经营社区维修铺',
                opening: '开始一天',
                tradeoff: '自己协调时间',
              },
              facts: [],
              people: [],
              assets: [],
              portraitAssetId: null,
            },
      );
      await db.transaction(owner, (s) =>
        s.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
          [id, owner, profile.id, randomUUID(), 'explicit-two-step-fixture', seed],
        ),
      );
      const request = { seedId: id, commandId: randomUUID() },
        build = await builds.create(owner, request),
        lease = await queue.claimForOwner(build.task!.id, owner, ['world-build']);
      assert(lease);
      return { request, build, lease };
    }
    async function absent(worldId: string) {
      const row = (
        await admin.query(
          'SELECT (SELECT count(*) FROM parallel_life.worlds WHERE id=$1)::int AS worlds,(SELECT count(*) FROM parallel_life.world_initial_snapshots WHERE world_id=$1)::int AS initial',
          [worldId],
        )
      ).rows[0];
      assert.deepEqual(row, { worlds: 0, initial: 0 });
      assert.equal((await builds.list(owner)).find((b) => b.worldId === worldId)?.ready, false);
    }
    for (const authored of [false, true])
      await t.test(
        authored
          ? 'authored cast stays fixed across both phases'
          : 'ordinary complete genesis is initially read and preserves stable IDs',
        async () => {
          const f = await create(authored);
          let calls = 0;
          let anchor = '';
          const model: TextModel = {
            async complete(messages) {
              calls++;
              const input = JSON.parse(messages[1]!.content);
              anchor = input.storyTime.startAt;
              if (calls === 1)
                return JSON.stringify(
                  authored
                    ? {
                        messages: [{ actorKey: input.openingKey, text: '场地等你来确认。' }],
                        notes: [{ title: '场地', text: '先核对场地' }],
                      }
                    : opening,
                );
              assert(!JSON.stringify(input).includes('幕后'));
              assert(!JSON.stringify(input).includes('库存'));
              return JSON.stringify({
                groups: [...input.cast].reverse().map((a: { actorIndex: number }) => ({
                  actorIndex: a.actorIndex,
                  messages: [
                    {
                      text: '上次借你的工具已经检查好了。',
                      minutesBeforeStart: 1440 + a.actorIndex,
                    },
                  ],
                })),
              });
            },
          };
          await buildHandler(
            queue,
            new WorldPlanner(model, { historyEnabled: true, historyMode: 'two-step' }),
            'explicit-fixture',
          )(f.lease, new AbortController().signal);
          assert.equal(calls, 2);
          const state = await worlds.get({ userId: owner }, f.build.worldId),
            phone = await builds.phone(owner, f.build.worldId);
          assert.equal(state.time, anchor);
          assert.equal(state.messageHistory!.startAt, anchor);
          assert.equal(
            state.messages.filter((m) => m.initialRead === true).length,
            state.actors.length,
          );
          for (const actor of state.actors) {
            assert(state.messages.some((m) => m.actorId === actor.id && m.initialRead === true));
            assert(
              actorContext(state, actor.id, '借工具').messages.every((m) => m.actorId === actor.id),
            );
          }
          const current = state.messages.filter((m) => m.initialRead === false);
          assert.equal(current.length, 1);
          const data = worldAppData(phone);
          assert.equal(
            projectMessageNotifications(data.messages, data.contacts, new Set(), (x) => x).length,
            1,
          );
          assert.equal((await tasks.get(owner, f.build.task!.id)).status, 'succeeded');
          assert.deepEqual((await builds.phone(owner, f.build.worldId)).messages, phone.messages);
          assert.equal((await builds.create(owner, f.request)).worldId, f.build.worldId);
          await assert.rejects(builds.phone(other, f.build.worldId));
          const initial = (
            await admin.query(
              'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
              [state.id],
            )
          ).rows[0].state;
          assert.deepEqual(initial.messages, state.messages);
        },
      );
    await t.test(
      'invalid history cannot persist a previously valid world stage or cause world regeneration',
      async () => {
        const f = await create();
        let calls = 0;
        const model: TextModel = {
          async complete() {
            calls++;
            return JSON.stringify(calls === 1 ? opening : { groups: [] });
          },
        };
        await assert.rejects(
          buildHandler(
            queue,
            new WorldPlanner(model, { historyEnabled: true, historyMode: 'two-step' }),
            'fixture',
          )(f.lease, new AbortController().signal),
          { code: 'INVALID_RESPONSE' },
        );
        assert.equal(calls, 3);
        await absent(f.build.worldId);
      },
    );
    await t.test('cancelled second phase and expired lease leave no half-world', async () => {
      for (const cancelled of [true, false]) {
        const f = await create();
        const controller = new AbortController();
        let calls = 0;
        const model: TextModel = {
          async complete(messages) {
            calls++;
            if (calls === 1) return JSON.stringify(opening);
            const input = JSON.parse(messages[1]!.content);
            if (cancelled)
              controller.abort(Object.assign(Error('cancelled'), { code: 'CANCELLED' }));
            else
              await admin.query(
                "UPDATE parallel_life.tasks SET lease_until=now()-interval '1 minute' WHERE id=$1",
                [f.lease.id],
              );
            return JSON.stringify({
              groups: input.cast.map((a: { actorIndex: number }) => ({
                actorIndex: a.actorIndex,
                messages: [{ text: '工具放在柜台下了。', minutesBeforeStart: 1440 }],
              })),
            });
          },
        };
        await assert.rejects(
          buildHandler(
            queue,
            new WorldPlanner(model, { historyEnabled: true, historyMode: 'two-step' }),
            'fixture',
          )(f.lease, controller.signal),
        );
        assert.equal(calls, 2);
        await absent(f.build.worldId);
      }
    });
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
    await admin.end();
  }
});
