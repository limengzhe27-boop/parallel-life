import { formatChatTime } from '../../src/features/phone/apps/helpers.ts';
import { LifeSettingContentSchema } from '../../src/contracts/life-settings.ts';
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
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { TaskRepository } from '../../src/modules/tasks/infrastructure/task-repository.ts';
import { actorContext } from '../../src/modules/world/application/actor-context.ts';
import { replayWorldHistory } from '../../src/modules/world/domain/world-history.ts';
import {
  validateMessageHistory,
  type MessageHistoryProposal,
} from '../../src/modules/world/domain/genesis-messages.ts';
import { WorldOpeningSchema, type WorldOpening } from '../../src/contracts/world-build.ts';
import { ApprovedSeedSchema, type ApprovedSeed } from '../../src/contracts/seeds.ts';
import type { TurnCommand, WorldEvent, WorldState } from '../../src/modules/world/domain/types.ts';
import { SettingDraftRepository } from '../../src/modules/settings/infrastructure/setting-draft-repository.ts';
import { SettingTrialRepository } from '../../src/modules/settings/infrastructure/setting-trial-repository.ts';
import { settingContent } from '../fixtures/life-setting.ts';
import { worldAppData } from '../../src/features/phone/world-app-data.ts';
import { projectMessageNotifications } from '../../src/features/phone/notification-projection.ts';

// Explicit synthetic model output. All persistence below uses real PostgreSQL and queue leases.
function opening(keys = ['person_0', 'b', 'c']): WorldOpening {
  return WorldOpeningSchema.parse({
    identity: '独立摄影师',
    setting: '杭州摄影工作室',
    actors: keys.map((key, i) => ({
      key,
      name: ['小芳', '小李', '小陈'][i] ?? key,
      relationship: '同事',
      persona: `后台私有动机_${key}`,
    })),
    actorTies: [
      { fromKey: keys[0], toKey: keys[1], relationship: '共同租用工作室', mayShare: true },
    ],
    // Deliberately unordered; earlier means story time, not array position.
    messageHistory: {
      version: 1,
      messages: [
        {
          key: 'a_new',
          actorKey: keys[0],
          text: '场地周五之前仍为你保留。',
          minutesBeforeStart: 120,
          replyToKey: 'a_old',
        },
        {
          key: 'a_old',
          actorKey: keys[0],
          text: '我们上周讨论的场地保留到周五。',
          minutesBeforeStart: 10080,
        },
        ...keys.slice(1).map((actorKey, i) => ({
          key: `other_${i}`,
          actorKey,
          text: `只在本会话谈过的器材_${actorKey}`,
          minutesBeforeStart: i === 0 ? 60 : 43200,
        })),
      ],
    },
    messages: [
      { actorKey: keys[0], text: '今天要不要看看场地？' },
      { actorKey: keys[1], text: '设备可以先检查。' },
    ],
    notes: [{ title: '内部开场便签', text: '不可直接公开的后台私有记录' }],
  });
}

function normalizedState(state: WorldState): WorldState {
  return { ...state, notes: state.notes ?? [] };
}

test('BOOT Q write validation rejects missing or coerced history keys independently of model schema', () => {
  const valid = opening().messageHistory!;
  for (const key of [undefined, 123, null]) {
    const bad = structuredClone(valid) as unknown as {
      version: 1;
      messages: Record<string, unknown>[];
    };
    if (key === undefined) delete bad.messages[0]!.key;
    else bad.messages[0]!.key = key;
    assert.throws(
      () =>
        validateMessageHistory(bad as unknown as MessageHistoryProposal, ['person_0', 'b', 'c']),
      /INVALID_MESSAGE_HISTORY/,
    );
  }
});

test('BOOT Q real PostgreSQL preserves genesis, safe phone reads and failed-build boundaries', async (t) => {
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
    other = randomUUID();
  const identity = new IdentityRepository(db),
    profiles = new ProfileRepository(db);
  const builds = new BuildRepository(db),
    tasks = new TaskRepository(db),
    worlds = new PostgresWorldRepository(db);
  try {
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    let profile = await profiles.edit(owner, {
      expectedVersion: 0,
      operation: { kind: 'set-fact', category: 'interest', value: 'PRIVATE_REALITY_BOOT_Q' },
    });
    profile = await profiles.edit(owner, {
      expectedVersion: profile.version,
      operation: {
        kind: 'set-person',
        person: { id: randomUUID(), name: '小芳', relationship: '摄影朋友', assetId: null },
      },
    });
    const realityBefore = await profiles.get(owner);
    const candidatesBefore = (
      await admin.query(
        'SELECT id,status FROM parallel_life.memory_candidates WHERE owner_id=$1 ORDER BY id',
        [owner],
      )
    ).rows;
    const personal = async () => {
      const seed = ApprovedSeedSchema.parse({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        profileVersion: profile.version,
        discoveryVersion: 1,
        directionId: randomUUID(),
        story: {
          title: 'BOOT Q 合成摄影生活',
          premise: '筹备一次摄影练习',
          opening: '现在商量场地',
          tradeoff: '需要协调时间',
        },
        facts: [],
        people: [profile.people[0]],
        personRoles: [],
        portraitAssetId: null,
        assets: [],
      });
      await db.transaction(owner, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
          [seed.id, owner, profile.id, randomUUID(), 'boot-q-explicit-fixture', seed],
        ),
      );
      const request = { seedId: seed.id, commandId: randomUUID() };
      const build = await builds.create(owner, request);
      return { seed, request, build };
    };
    const readInitial = async (worldId: string): Promise<WorldState> =>
      (
        await admin.query(
          'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
          [worldId],
        )
      ).rows[0].state;
    const noHalfWorld = async (worldId: string, seedId: string) => {
      for (const table of [
        'worlds',
        'world_initial_snapshots',
        'world_person_bindings',
        'world_messages',
        'world_events',
        'world_media_requests',
        'outbox_jobs',
      ]) {
        const column = table === 'worlds' ? 'id' : 'world_id';
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM parallel_life.${table} WHERE ${column}=$1`,
              [worldId],
            )
          ).rows[0].n,
          0,
          table,
        );
      }
      assert.equal(
        (
          await admin.query('SELECT opening FROM parallel_life.world_builds WHERE seed_id=$1', [
            seedId,
          ])
        ).rows[0].opening,
        null,
      );
    };
    const persist = async (
      build: { worldId: string; task: { id: string } | null },
      output: WorldOpening,
      onCall?: () => Promise<void>,
    ) => {
      assert.ok(build.task);
      const lease = await queue.claimForOwner(build.task.id, owner, ['world-build']);
      assert.ok(lease);
      let calls = 0;
      const planner = new WorldPlanner({
        async complete(messages) {
          calls++;
          assert(!JSON.stringify(messages).includes('PRIVATE_REALITY_BOOT_Q'));
          await onCall?.();
          return JSON.stringify(output);
        },
      });
      await buildHandler(queue, planner, 'boot-q-fixture')(lease, new AbortController().signal);
      return calls;
    };

    await t.test(
      'personal history crosses actual phone projection, own context, receipts and replay without duplicating',
      async () => {
        const { seed, request, build } = await personal();
        assert.equal(await persist(build, opening()), 1);
        const initial = await readInitial(build.worldId),
          initialHash = JSON.stringify(initial);
        assert.equal(initial.version, 0);
        assert.deepEqual(initial.messageHistory, {
          version: 1,
          startAt: initial.time,
          timeZone: 'UTC+08:00',
        });
        assert.equal(initial.messages.length, 6);
        assert(
          initial.messages.every(
            (m) => m.role === 'assistant' && m.sourceEventId === `genesis:${build.worldId}`,
          ),
        );
        assert.equal(new Set(initial.messages.map((m) => m.id)).size, 6);
        for (const actor of initial.actors)
          assert(
            initial.messages.some(
              (m) => m.actorId === actor.id && m.history?.version === 1 && m.initialRead === true,
            ),
          );
        const later = initial.messages.find((m) => m.history?.key === 'a_new')!,
          earlier = initial.messages.find((m) => m.history?.key === 'a_old')!;
        assert.equal(later.history?.replyToMessageId, earlier.id);
        assert(Date.parse(earlier.at) < Date.parse(later.at));
        assert.equal(Date.parse(initial.time) - Date.parse(later.at), 120 * 60000);
        const phone = await builds.phone(owner, build.worldId);
        assert.equal(phone.actors.length, 3);
        assert.equal(
          phone.messages.filter((m) => m.initialRead === true && m.origin === 'fictional_history')
            .length,
          4,
        );
        assert(!JSON.stringify(phone).includes('后台私有动机'));
        assert(!JSON.stringify(phone).includes('不可直接公开'));
        assert(phone.messages.every((m) => !('history' in m) && !('sourceEventId' in m)));
        const apps = worldAppData(phone),
          notifications = projectMessageNotifications(
            phone.messages,
            phone.actors,
            new Set(),
            (at) => at,
          );
        assert.equal(
          apps.contacts.reduce((n, actor) => n + actor.unread, 0),
          2,
        );
        assert.equal(notifications.length, 2);
        const currentMessages = phone.messages.filter((m) => m.initialRead === false);
        assert.equal(
          new Set(currentMessages.map((m) => formatChatTime(m.at, phone.time))).size,
          2,
          'current opening messages are visibly staggered at phone minute precision',
        );
        assert(
          currentMessages.every((m) => {
            const minutes = (Date.parse(initial.time) - Date.parse(m.at)) / 60000;
            return Number.isInteger(minutes) && minutes >= 0 && minutes < 60;
          }),
        );
        assert.deepEqual(
          new Set(notifications.map((n) => n.id)),
          new Set(phone.messages.filter((m) => m.initialRead === false).map((m) => m.id)),
        );
        const a = initial.actors[0]!,
          b = initial.actors[1]!;
        assert(actorContext(initial, a.id, '场地').messages.some((m) => m.id === earlier.id));
        assert(!JSON.stringify(actorContext(initial, b.id, '场地')).includes('场地保留到周五'));
        assert.equal(
          actorContext(initial, a.id, '场地', [], new Set([`genesis:${build.worldId}`])).messages
            .length,
          0,
        );
        assert.equal((await builds.create(owner, request)).worldId, build.worldId);
        assert.equal(
          (await builds.create(owner, { seedId: seed.id, commandId: randomUUID() })).worldId,
          build.worldId,
        );
        const second = await personal();
        await assert.rejects(builds.create(owner, { ...request, seedId: second.seed.id }), {
          code: 'IDEMPOTENCY_CONFLICT',
        });
        assert.equal(await persist(second.build, opening()), 1);
        const otherInitial = await readInitial(second.build.worldId);
        assert(
          otherInitial.messages.every((m) => !initial.messages.some((old) => old.id === m.id)),
        );
        await assert.rejects(builds.phone(other, build.worldId), { code: 'NOT_FOUND' });
        await assert.rejects(worlds.get({ userId: other }, build.worldId), { code: 'NOT_FOUND' });
        const workerLeak = await db.transaction(other, (sql) =>
          sql.query(
            'SELECT world_id FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [build.worldId],
          ),
        );
        assert.equal(workerLeak.rowCount, 0);
        const events: WorldEvent[] = [],
          commands: TurnCommand[] = [];
        for (let i = 1; i <= 2; i++) {
          const command: TurnCommand = {
            id: randomUUID(),
            worldId: build.worldId,
            expectedVersion: i - 1,
            actorId: a.id,
            text: `这是玩家的真实测试输入${i}`,
          };
          const event: WorldEvent = {
            schemaVersion: 1,
            id: randomUUID(),
            worldId: build.worldId,
            version: i,
            commandId: command.id,
            occurredAt: new Date().toISOString(),
            storyAt: new Date(Date.parse(initial.time) + i * 60000).toISOString(),
            type: 'turn.resolved',
            data: {
              actorId: a.id,
              userText: command.text,
              effects: [
                {
                  type: 'message.received',
                  id: randomUUID(),
                  actorId: a.id,
                  text: `同一联系人新的回复${i}`,
                },
              ],
            },
          };
          await worlds.commit({ userId: owner }, command, event);
          commands.push(command);
          events.push(event);
        }
        const oldReceipt = await worlds.receipt({ userId: owner }, commands[0]!);
        assert.ok(oldReceipt);
        assert.equal(oldReceipt.state.version, 1);
        assert(!oldReceipt.state.messages.some((m) => m.sourceEventId === events[1]!.id));
        assert.deepEqual(
          normalizedState(replayWorldHistory(initial, events, 1).world),
          normalizedState(oldReceipt.state),
        );
        assert.deepEqual(
          normalizedState(replayWorldHistory(initial, events).world),
          normalizedState(await worlds.get({ userId: owner }, build.worldId)),
        );
        assert.equal(JSON.stringify(await readInitial(build.worldId)), initialHash);
        const after = await builds.phone(owner, build.worldId);
        const viewed = new Set(
          phone.messages.filter((m) => m.initialRead === false).map((m) => m.id),
        );
        const latest = projectMessageNotifications(
          after.messages,
          after.actors,
          viewed,
          (at) => at,
        );
        assert.equal(
          latest.length,
          2,
          'same actor new IDs alert again; user and old read history do not',
        );
        assert.deepEqual(await profiles.get(owner), realityBefore);
        assert.deepEqual(
          (
            await admin.query(
              'SELECT id,status FROM parallel_life.memory_candidates WHERE owner_id=$1 ORDER BY id',
              [owner],
            )
          ).rows,
          candidatesBefore,
        );
      },
    );

    await t.test(
      'fixed authored cast also persists every actor history without copying real profile',
      async () => {
        const drafts = new SettingDraftRepository(db),
          trials = new SettingTrialRepository(db);
        const draft = await drafts.create(owner, {
          commandId: randomUUID(),
          content: LifeSettingContentSchema.parse(settingContent()),
        });
        const trial = await trials.create(owner, draft.id, { commandId: randomUUID(), version: 0 });
        const full = opening(['c_0', 'c_1']);
        const lease = await queue.claimForOwner(trial.task!.id, owner, ['world-build']);
        assert.ok(lease);
        let calls = 0;
        const planner = new WorldPlanner({
          async complete(input) {
            calls++;
            assert(!JSON.stringify(input).includes('PRIVATE_REALITY_BOOT_Q'));
            return JSON.stringify({
              messages: full.messages,
              notes: full.notes,
              messageHistory: full.messageHistory,
            });
          },
        });
        await buildHandler(
          queue,
          planner,
          'boot-q-setting-fixture',
        )(lease, new AbortController().signal);
        assert.equal(calls, 1);
        const initial = await readInitial(trial.worldId),
          phone = await builds.phone(owner, trial.worldId);
        assert.equal(phone.actors.length, 2);
        for (const actor of initial.actors)
          assert(
            phone.messages.some(
              (m) =>
                m.actorId === actor.id &&
                m.origin === 'fictional_history' &&
                m.initialRead === true,
            ),
          );
        assert.deepEqual(
          initial.actors.map((a) => a.name),
          settingContent().characters.map((a) => a.name),
        );
        assert.equal((await trials.list(owner, draft.id))[0]!.ready, true);
        assert.deepEqual(await profiles.get(owner), realityBefore);
      },
    );

    await t.test(
      'cancelled, expired, wrong-token and unsafe planner results cannot leave any partial world',
      async () => {
        for (const mode of [
          'cancel',
          'expired',
          'wrong-token',
          'unsafe-key',
          'missing-history',
          'cross-actor-reference',
          'future-history',
          'actor-gap',
        ]) {
          const { build, seed } = await personal(),
            lease = await queue.claimForOwner(build.task!.id, owner, ['world-build']);
          assert.ok(lease);
          let output = opening();
          if (mode === 'missing-history') delete output.messageHistory;
          if (mode === 'cross-actor-reference')
            output.messageHistory!.messages[0]!.replyToKey = 'other_0';
          if (mode === 'future-history')
            output.messageHistory!.messages[0]!.minutesBeforeStart = -1;
          if (mode === 'actor-gap')
            output.messageHistory!.messages = output.messageHistory!.messages.filter(
              (m) => m.actorKey !== 'c',
            );
          let calls = 0;
          let planner = new WorldPlanner({
            async complete() {
              calls++;
              if (mode === 'cancel') await tasks.cancel(owner, lease.id);
              if (mode === 'expired')
                await admin.query(
                  "UPDATE parallel_life.tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
                  [lease.id],
                );
              return JSON.stringify(output);
            },
          });
          if (mode === 'unsafe-key') {
            const unsafe = structuredClone(output) as unknown as {
              messageHistory: { messages: Record<string, unknown>[] };
            };
            delete unsafe.messageHistory.messages[0]!.key;
            planner = new (class extends WorldPlanner {
              override async propose(_seed: ApprovedSeed): Promise<WorldOpening> {
                return unsafe as unknown as WorldOpening;
              }
            })({
              async complete() {
                throw Error('UNEXPECTED_MODEL_CALL');
              },
            });
          }
          const fenced = mode === 'wrong-token' ? { ...lease, token: randomUUID() } : lease;
          await assert.rejects(
            buildHandler(
              queue,
              planner,
              'boot-q-negative-fixture',
            )(fenced, new AbortController().signal),
            (error: unknown) => error instanceof Error,
            mode,
          );
          await noHalfWorld(build.worldId, seed.id);
          assert.notEqual((await tasks.get(owner, build.task!.id)).status, 'succeeded');
          if (mode === 'unsafe-key' || mode === 'wrong-token') assert.equal(calls, 0);
          if (
            ['missing-history', 'cross-actor-reference', 'future-history', 'actor-gap'].includes(
              mode,
            )
          )
            assert.equal(calls, 2, 'only bounded fixture correction');
        }
      },
    );

    await t.test(
      'legacy snapshot reads remain unchanged and do not acquire synthetic past or read flags',
      async () => {
        const { build } = await personal(),
          time = new Date().toISOString();
        const oldActors = ['a', 'b'].map((key) => ({
          id: randomUUID(),
          name: `旧联系人${key}`,
          persona: `旧秘密${key}`,
        }));
        const legacy: WorldState = {
          schemaVersion: 1,
          id: build.worldId,
          ownerId: owner,
          version: 0,
          title: '显式旧版测试夹具',
          time,
          actors: oldActors,
          facts: [],
          appointments: [],
          mediaRequests: [],
          messages: oldActors.map((actor) => ({
            id: randomUUID(),
            actorId: actor.id,
            role: 'assistant',
            text: '旧版开场来信',
            at: time,
            sourceEventId: `genesis:${build.worldId}`,
          })),
        };
        await db.transaction(owner, async (sql) => {
          await sql.query(
            'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
            [build.worldId, owner, legacy.title, { ...legacy, messages: [] }],
          );
          await sql.query(
            'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
            [build.worldId, owner, legacy, {}],
          );
        });
        // Only explicit legacy fixture setup uses admin; app has no build UPDATE authority.
        const old = opening();
        delete old.messageHistory;
        await admin.query(
          'UPDATE parallel_life.world_builds SET opening=$2 WHERE world_id=$1 AND owner_id=$3',
          [build.worldId, old, owner],
        );
        const before = JSON.stringify(await readInitial(build.worldId));
        for (let i = 0; i < 2; i++) {
          const phone = await builds.phone(owner, build.worldId);
          assert.equal(phone.messages.length, 2);
          assert(
            phone.messages.every((m) => m.initialRead === undefined && m.origin === undefined),
          );
          assert.equal(
            projectMessageNotifications(phone.messages, phone.actors, new Set(), (at) => at).length,
            2,
          );
          assert.equal(
            (await worlds.get({ userId: owner }, build.worldId)).messageHistory,
            undefined,
          );
        }
        assert.equal(JSON.stringify(await readInitial(build.worldId)), before);
      },
    );
  } finally {
    await queue.close();
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await admin.end();
  }
});
