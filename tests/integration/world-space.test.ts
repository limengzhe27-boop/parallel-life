import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import {
  officialLifeCatalog,
  OFFICIAL_LIFE_PACKS,
} from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import { PostgresWorldSpace } from '../../src/modules/world/infrastructure/space-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import {
  SceneRepository,
  commitSceneProposal,
} from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { replayWorldHistory } from '../../src/modules/world/domain/world-history.ts';
import type { WorldHistoryEvent } from '../../src/modules/world/domain/world-history.ts';
import type { OfficialLifePack } from '../../src/modules/settings/application/official-life-pack.ts';
import { buildAgenda } from '../../src/modules/world/domain/agenda.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';
import { historyFixture } from '../helpers/genesis-fixture.ts';

test('atomic sourced spatial commands against real owner-RLS PostgreSQL', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    db = new PostgresDatabase(
      'postgresql://pl_app:' + c.appPassword + '@127.0.0.1:' + c.port + '/parallel_life_test',
    ),
    identity = new IdentityRepository(db),
    owner = randomUUID(),
    other = randomUUID();
  await identity.ensureGuest(owner);
  await identity.ensureGuest(other);
  const official = new OfficialLifeRepository(db, officialLifeCatalog),
    space = new PostgresWorldSpace(db, officialLifeCatalog),
    clocks = new PostgresClockStore(db),
    scenes = new SceneRepository(db),
    worlds = new PostgresWorldRepository(db),
    pack = OFFICIAL_LIFE_PACKS[0],
    started = await official.start(owner, pack.card.id, {
      commandId: randomUUID(),
      version: pack.card.version,
    }),
    worldId = started.worldId;
  const command = () => ({
    commandId: randomUUID(),
    expectedVersion: 0,
    routeId: 'repair_shop_to_lin_home',
  });
  try {
    await t.test(
      'consistent read and paused refusal; cross owner read/receipt/direct rows hidden',
      async () => {
        await clocks.setClock(owner, worldId, { paused: true, speed: 0 });
        const before = await space.read(owner, worldId);
        assert.equal(before.currentPlaceId, 'repair_shop');
        assert.equal(before.routes.length, 2);
        const request = command();
        await assert.rejects(space.travel(owner, worldId, request), { code: 'INVALID_COMMAND' });
        assert.equal((await space.read(owner, worldId)).worldVersion, 0);
        await assert.rejects(space.read(other, worldId), { code: 'NOT_FOUND' });
        await assert.rejects(space.recover(other, worldId, request), { code: 'NOT_FOUND' });
        assert.equal(
          (
            await db.transaction(other, (sql) =>
              sql.query('SELECT * FROM parallel_life.world_space_receipts WHERE world_id=$1', [
                worldId,
              ]),
            )
          ).rowCount,
          0,
        );
        await clocks.setClock(owner, worldId, { paused: false });
      },
    );
    let receipt: Awaited<ReturnType<PostgresWorldSpace['travel']>>,
      request = command();
    await t.test(
      'one canonical route-minute jump with persisted original receipt and no offline double count',
      async () => {
        receipt = await space.travel(owner, worldId, request);
        assert.equal(Date.parse(receipt.arrivedAt) - Date.parse(receipt.departedAt), 12 * 60000);
        const clock = await clocks.read(owner, worldId),
          current = await worlds.get({ userId: owner }, worldId);
        assert.equal(clock.storyNow, receipt.arrivedAt);
        assert.equal(current.time, receipt.arrivedAt);
        assert.equal(current.space!.currentPlaceId, 'lin_home');
        await clocks.setClock(owner, worldId, { paused: true });
        assert.deepEqual(await space.travel(owner, worldId, request), receipt);
        assert.deepEqual(await space.recover(owner, worldId, request), receipt);
        await assert.rejects(
          space.recover(owner, worldId, { ...request, routeId: 'repair_shop_to_old_workshop' }),
          { code: 'IDEMPOTENCY_CONFLICT' },
        );
        assert.equal((await clocks.read(owner, worldId)).storyNow, receipt.arrivedAt);
        await clocks.setClock(owner, worldId, { paused: false });
      },
    );
    await t.test(
      'concurrent distinct requests commit at most one; same command later returns exact receipt',
      async () => {
        const a = {
            commandId: randomUUID(),
            expectedVersion: 1,
            routeId: 'lin_home_to_repair_shop',
          },
          b = { ...a, commandId: randomUUID(), routeId: 'lin_home_to_old_workshop' };
        const attempts = await Promise.allSettled([
          space.travel(owner, worldId, a),
          space.travel(owner, worldId, b),
        ]);
        assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
        const i = attempts.findIndex((r) => r.status === 'fulfilled'),
          result = attempts[i]!;
        if (result.status === 'fulfilled')
          assert.deepEqual(await space.travel(owner, worldId, i === 0 ? a : b), result.value);
        assert.equal((await space.read(owner, worldId)).worldVersion, 2);
      },
    );
    await t.test(
      'same command in parallel converges on one immutable receipt; concurrent clock control cannot reset travel',
      async () => {
        const before = await space.read(owner, worldId),
          request = {
            commandId: randomUUID(),
            expectedVersion: before.worldVersion,
            routeId: before.routes[0]!.id,
          };
        const results = await Promise.allSettled([
          space.travel(owner, worldId, request),
          space.travel(owner, worldId, request),
        ]);
        const success = results.find((r) => r.status === 'fulfilled');
        assert.ok(success && success.status === 'fulfilled');
        const replay = await space.travel(owner, worldId, request);
        if (success.status === 'fulfilled') assert.deepEqual(replay, success.value);
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int AS n FROM parallel_life.world_events WHERE world_id=$1 AND command_id=$2',
              [worldId, request.commandId],
            )
          ).rows[0].n,
          1,
        );
        await clocks.setClock(owner, worldId, { paused: true });
        assert.equal((await clocks.read(owner, worldId)).storyNow, replay.arrivedAt);
        await clocks.setClock(owner, worldId, { paused: false });
        await assert.rejects(
          db.transaction(other, (sql) =>
            sql.query(
              'INSERT INTO parallel_life.world_space_receipts(world_id,owner_id,command_id,request_hash,source_event_id,document) VALUES($1,$2,$3,$4,$5,$6)',
              [worldId, owner, request.commandId, 'a'.repeat(64), replay.sourceEventId, replay],
            ),
          ),
          (error: unknown) =>
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === '42501',
        );
      },
    );
    await t.test(
      'advance/paid-call advisory lock refuses travel and clock control without deadlock',
      async () => {
        const held = await db.pool.connect();
        await held.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [worldId]);
        try {
          const now = await space.read(owner, worldId);
          await assert.rejects(
            space.travel(owner, worldId, {
              commandId: randomUUID(),
              expectedVersion: now.worldVersion,
              routeId: now.routes[0]!.id,
            }),
            { code: 'BUSY' },
          );
          await assert.rejects(clocks.setClock(owner, worldId, { paused: true }), {
            code: 'VERSION_CONFLICT',
          });
        } finally {
          await held.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [worldId]);
          held.release();
        }
      },
    );
    await t.test(
      'clock write failure rolls back command/event/position/receipt/time together',
      async () => {
        const before = await space.read(owner, worldId),
          clock = await clocks.read(owner, worldId),
          request = {
            commandId: randomUUID(),
            expectedVersion: before.worldVersion,
            routeId: before.routes[0]!.id,
          };
        await admin.query(
          "CREATE FUNCTION parallel_life.space_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$",
        );
        await admin.query(
          'CREATE TRIGGER space_test_fail BEFORE UPDATE ON parallel_life.world_clock FOR EACH ROW EXECUTE FUNCTION parallel_life.space_test_fail()',
        );
        try {
          await assert.rejects(space.travel(owner, worldId, request));
          assert.equal((await space.read(owner, worldId)).currentPlaceId, before.currentPlaceId);
          assert.deepEqual(await clocks.read(owner, worldId), clock);
          assert.equal((await space.recover(owner, worldId, request)).status, 'unconfirmed');
          assert.equal(
            (
              await admin.query(
                'SELECT 1 FROM parallel_life.commands WHERE world_id=$1 AND id=$2',
                [worldId, request.commandId],
              )
            ).rowCount,
            0,
          );
        } finally {
          await admin.query('DROP TRIGGER space_test_fail ON parallel_life.world_clock');
          await admin.query('DROP FUNCTION parallel_life.space_test_fail()');
        }
      },
    );
    await t.test(
      'actual place entry creates free-action scene; queued/unknown task refuses travel; observed departure replay respects knowledge',
      async () => {
        let current = await space.read(owner, worldId);
        const entered = await scenes.enterPlace(owner, worldId, {
          commandId: randomUUID(),
          expectedVersion: current.worldVersion,
          placeId: current.currentPlaceId!,
        });
        assert.ok(entered.task);
        assert.equal((await scenes.read(owner, worldId)).scene!.placeId, current.currentPlaceId);
        await assert.rejects(
          space.travel(owner, worldId, {
            commandId: randomUUID(),
            expectedVersion: entered.version,
            routeId: current.routes[0]!.id,
          }),
          { code: 'BUSY' },
        );
        await admin.query("UPDATE parallel_life.tasks SET status='unknown' WHERE id=$1", [
          entered.task!.id,
        ]);
        await assert.rejects(
          space.travel(owner, worldId, {
            commandId: randomUUID(),
            expectedVersion: entered.version,
            routeId: current.routes[0]!.id,
          }),
          { code: 'BUSY' },
        );
        await admin.query("UPDATE parallel_life.tasks SET status='cancelled' WHERE id=$1", [
          entered.task!.id,
        ]);
        // Explicit synthetic planner result, not a model success.
        await db.transaction(owner, (sql) =>
          commitSceneProposal(
            sql,
            owner,
            worldId,
            {
              type: 'scene',
              sceneId: entered.sceneId,
              actionId: null,
              expectedVersion: entered.version,
            },
            {
              location: current.places.find((p) => p.id === current.currentPlaceId)!.name,
              narration: 'Synthetic public environment.',
              presentActorIds: [],
              outcome: null,
              observation: null,
              matterTitle: null,
              initialMatters: [],
              matterUpdates: [],
              dialogues: [],
            },
            randomUUID(),
          ),
        );
        const sceneRead = await scenes.read(owner, worldId);
        assert.equal(
          sceneRead.scene!.presence.filter((p) => p.participant.kind === 'actor').length,
          0,
        );
        const actor = (await worlds.get({ userId: owner }, worldId)).actors[0]!;
        // Synthetic existing presence fixture has explicit source, never derived from contactActorIds.
        const doc = structuredClone(sceneRead.scene!);
        doc.presence.push({
          participant: { kind: 'actor', actorId: actor.id },
          joinedVersion: doc.sourceVersion,
          sourceEventId: doc.sourceEventId,
          sourceVersion: doc.sourceVersion,
        });
        await admin.query('UPDATE parallel_life.scene_sessions SET document=$2 WHERE id=$1', [
          doc.id,
          doc,
        ]);
        current = await space.read(owner, worldId);
        const arrived = await space.travel(owner, worldId, {
          commandId: randomUUID(),
          expectedVersion: current.worldVersion,
          routeId: current.routes[0]!.id,
        });
        assert.equal(arrived.leftSceneId, entered.sceneId);
        assert.equal((await scenes.read(owner, worldId)).scene, null);
        const persisted = (
          await admin.query('SELECT document FROM parallel_life.scene_sessions WHERE id=$1', [
            entered.sceneId,
          ])
        ).rows[0].document;
        assert.equal(persisted.status, 'active');
        assert.equal(
          persisted.presence.find(
            (p: { participant: { kind: string } }) => p.participant.kind === 'player',
          ).leftVersion,
          arrived.version,
        );
        const initial = (
            await admin.query(
              'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
              [worldId],
            )
          ).rows[0].state,
          events = (
            await admin.query(
              'SELECT payload FROM parallel_life.world_events WHERE world_id=$1 ORDER BY version',
              [worldId],
            )
          ).rows.map((r) => r.payload) as WorldHistoryEvent[];
        const replayed = replayWorldHistory(initial, events).world,
          world = await worlds.get({ userId: owner }, worldId);
        assert.deepEqual(replayed.space, world.space);
        const departure = world.facts.find((f) => f.sourceEventId === arrived.sourceEventId)!;
        assert.ok(departure);
        assert.deepEqual(
          replayed.facts.find((f) => f.id === departure.id),
          departure,
        );
        assert.ok(!departure.text.includes(arrived.destinationLabel));
        assert.deepEqual(departure.visibility, { kind: 'actors', actorIds: [actor.id] });
        assert.ok(departure.departure);
        assert.equal(departure.departure.fromPlaceName, arrived.fromLabel);
        assert.equal(departure.departure.eventVersion, arrived.version);
        const agenda = buildAgenda(world);
        const observerThread = agenda.find(
          (t) => t.kind === 'departure_inquiry' && t.actorId === actor.id,
        );
        assert.ok(observerThread, 'Observer receives departure_inquiry');
        assert.match(observerThread.detail, /绝不能假装知道目的地/);
        for (const otherActor of world.actors.filter((a) => a.id !== actor.id)) {
          assert.ok(
            !agenda.some((t) => t.kind === 'departure_inquiry' && t.actorId === otherActor.id),
            'Uninformed NPC must not get departure_inquiry',
          );
        }
      },
    );
    await t.test(
      'explicit old official v0 establish binds shuffled original actors by verified identities; immutable remains unchanged',
      async () => {
        const oldPack: OfficialLifePack = structuredClone(pack);
        oldPack.card.version = 1;
        delete oldPack.opening.space;
        oldPack.opening.actors.reverse();
        const oldRepo = new OfficialLifeRepository(db, {
            list: () => [oldPack],
            get: () => oldPack,
          }),
          freshOwner = randomUUID();
        await identity.ensureGuest(freshOwner);
        try {
          const saved = await oldRepo.start(freshOwner, pack.card.id, {
            commandId: randomUUID(),
            version: 1,
          });
          const initial = (
            await admin.query(
              'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
              [saved.worldId],
            )
          ).rows[0].state;
          await clocks.setClock(freshOwner, saved.worldId, { paused: true, speed: 0 });
          assert.equal((await space.read(freshOwner, saved.worldId)).canEstablish, true);
          const input = { commandId: randomUUID(), expectedVersion: 0 };
          const result = await space.establish(freshOwner, saved.worldId, input);
          assert.deepEqual(await space.establish(freshOwner, saved.worldId, input), result);
          const read = await space.read(freshOwner, saved.worldId);
          assert.equal(read.currentPlaceId, 'repair_shop');
          assert.deepEqual(
            read.places.find((p) => p.id === 'repair_shop')!.contactActorIds,
            pack.opening.space!.places[0]!.actorKeys.map((key) => {
              const name = pack.opening.actors.find((a) => a.key === key)!.name;
              return initial.actors.find((a: { name: string }) => a.name === name).id;
            }),
          );
          assert.deepEqual(
            (
              await admin.query(
                'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
                [saved.worldId],
              )
            ).rows[0].state,
            initial,
          );
          const catalog = await official.list(freshOwner);
          assert.equal(catalog.lives.find((p) => p.id === pack.card.id)!.worldId, saved.worldId);
        } finally {
          await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [freshOwner]);
        }
      },
    );
    await t.test(
      'modified legacy lives and unverified old identities remain honest unknown',
      async () => {
        for (const mismatch of [false, true]) {
          const fresh = randomUUID();
          await identity.ensureGuest(fresh);
          try {
            const old = structuredClone(pack);
            old.card.version = 1;
            delete old.opening.space;
            if (mismatch) old.opening.actors[0]!.relationship = 'Unsupported old role';
            const started = await new OfficialLifeRepository(db, {
              list: () => [old],
              get: () => old,
            }).start(fresh, pack.card.id, { commandId: randomUUID(), version: 1 });
            await clocks.setClock(fresh, started.worldId, { paused: true, speed: 0 });
            if (!mismatch)
              await worlds.saveNote(
                { userId: fresh },
                {
                  worldId: started.worldId,
                  commandId: randomUUID(),
                  expectedVersion: 0,
                  id: randomUUID(),
                  title: 'Fixture old activity',
                  text: 'Only private note.',
                },
              );
            const read = await space.read(fresh, started.worldId);
            assert.equal(read.currentPlaceId, null);
            assert.deepEqual(read.places, []);
            assert.equal(read.canEstablish, false);
            await assert.rejects(
              space.establish(fresh, started.worldId, {
                commandId: randomUUID(),
                expectedVersion: read.worldVersion,
              }),
              { code: 'INVALID_COMMAND' },
            );
          } finally {
            await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [fresh]);
          }
        }
      },
    );
    await t.test(
      'normal world genesis attaches reliable space from approved seed; travel/empty/legacy establish respect verification and owner isolation',
      async () => {
        const queue = new PostgresTaskQueue(
          `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
        );
        const builds = new BuildRepository(db);
        const normalOwner = randomUUID();
        await identity.ensureGuest(normalOwner);
        const profiles = new ProfileRepository(db);
        const p = await profiles.edit(normalOwner, {
          expectedVersion: 0,
          operation: {
            kind: 'set-fact',
            category: 'identity',
            value: '个人资料\n姓名：测试用户\n生日：2000-01-01\n所在城市：杭州',
          },
        });
        try {
          // 1. Normal world genesis with reliable setup place
          const seedId = randomUUID();
          const seed = {
            id: seedId,
            createdAt: new Date().toISOString(),
            profileVersion: 1,
            discoveryVersion: 1,
            directionId: randomUUID(),
            story: {
              title: '老街汽修',
              premise: '修车铺的故事',
              opening: '清晨开门',
              tradeoff: '收入波动',
            },
            setup: { identity: '修车师傅', place: '青石老街·林记汽修', tone: '朴实自然' },
            facts: [],
            people: [],
            portraitAssetId: null,
            assets: [],
          };
          await db.transaction(normalOwner, (sql) =>
            sql.query(
              'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
              [seedId, normalOwner, p.id, randomUUID(), 'hash_normal', seed],
            ),
          );
          const buildReq = { seedId, commandId: randomUUID() };
          const built = await builds.create(normalOwner, buildReq);
          const output = {
            identity: '修车师傅',
            setting: '清晨的青石老街·林记汽修门前，修车铺拉起了卷帘门。',
            actors: ['actor_a', 'actor_b', 'actor_c'].map((k) => ({
              key: k,
              name: '邻里_' + k,
              relationship: '老主顾',
              persona: '待人和气',
            })),
            actorTies: [
              { fromKey: 'actor_a', toKey: 'actor_b', relationship: '同条街做街坊', mayShare: true },
            ],
            messages: [{ actorKey: 'actor_a', text: '师傅，今天能帮忙补个胎吗？' }],
            notes: [{ title: '今日待办', text: '整理工具箱' }],
          };
          const planner = new WorldPlanner({
            async complete() {
              return JSON.stringify(historyFixture(output));
            },
          });
          await runOne(queue, { 'world-build': buildHandler(queue, planner, 'test-model') });

          const normalWorldId = built.worldId;
          const read = await space.read(normalOwner, normalWorldId);
          assert.equal(read.currentPlaceId, 'primary_place');
          assert.equal(read.places.length, 2);
          assert.equal(read.places[0]!.name, '青石老街·林记汽修');
          assert.equal(read.places[0]!.source.kind, 'seed_genesis');
          assert.ok(read.routes.length >= 1);
          assert.equal(read.routes[0]!.toPlaceId, 'community_area');
          assert.equal(read.canEstablish, false);

          // Travel on normal world
          const route = read.routes[0]!;
          const travelRec = await space.travel(normalOwner, normalWorldId, {
            commandId: randomUUID(),
            expectedVersion: read.worldVersion,
            routeId: route.id,
          });
          assert.equal(travelRec.status, 'committed');
          assert.equal(travelRec.toPlaceId, route.toPlaceId);
          const afterTravel = await space.read(normalOwner, normalWorldId);
          assert.equal(afterTravel.currentPlaceId, route.toPlaceId);

          // Owner isolation
          await assert.rejects(space.read(other, normalWorldId), { code: 'NOT_FOUND' });
          await assert.rejects(
            space.travel(other, normalWorldId, {
              commandId: randomUUID(),
              expectedVersion: afterTravel.worldVersion,
              routeId: route.id,
            }),
            { code: 'NOT_FOUND' },
          );

          // 2. Normal world creation without reliable place stays empty
          const emptySeedId = randomUUID();
          const emptySeed = {
            id: emptySeedId,
            createdAt: new Date().toISOString(),
            profileVersion: 1,
            discoveryVersion: 1,
            directionId: randomUUID(),
            story: {
              title: '无地点人生',
              premise: '故事未设定具体地点',
              opening: '生活继续',
              tradeoff: '自由发展',
            },
            setup: { identity: '自由职业者', place: '   ', tone: '平静' },
            facts: [],
            people: [],
            portraitAssetId: null,
            assets: [],
          };
          await db.transaction(normalOwner, (sql) =>
            sql.query(
              'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
              [emptySeedId, normalOwner, p.id, randomUUID(), 'hash_empty', emptySeed],
            ),
          );
          const emptyBuilt = await builds.create(normalOwner, {
            seedId: emptySeedId,
            commandId: randomUUID(),
          });
          await runOne(queue, { 'world-build': buildHandler(queue, planner, 'test-model') });
          const emptyRead = await space.read(normalOwner, emptyBuilt.worldId);
          assert.equal(emptyRead.currentPlaceId, null);
          assert.deepEqual(emptyRead.places, []);
          assert.equal(emptyRead.canEstablish, false);

          // 3. Legacy unestablished normal world at v0 can establish with verified basis
          const legSeedId = randomUUID();
          const legWorldId = randomUUID();
          const legSeed = {
            id: legSeedId,
            createdAt: new Date().toISOString(),
            profileVersion: 1,
            discoveryVersion: 1,
            directionId: randomUUID(),
            story: {
              title: '旧版自建世界',
              premise: '旧版本创建的人生起点',
              opening: '故事开端',
              tradeoff: '时间取舍',
            },
            setup: { identity: '摄影师', place: '海边灯塔工作室', tone: '艺术质感' },
            facts: [],
            people: [],
            portraitAssetId: null,
            assets: [],
          };
          const legActors = [
            { id: randomUUID(), name: '助手小周', relationship: '助理', persona: '细致周到' },
            { id: randomUUID(), name: '模特阿琳', relationship: '合作者', persona: '专业敬业' },
          ];
          const legOpening = {
            identity: '摄影师',
            setting: '海边灯塔下的工作室里潮气未退。',
            actors: [
              { key: 'actor_1', name: '助手小周', relationship: '助理', persona: '细致周到' },
              { key: 'actor_2', name: '模特阿琳', relationship: '合作者', persona: '专业敬业' },
            ],
            messages: [{ actorKey: 'actor_1', text: '老师，今天的胶片已经到了。' }],
            notes: [{ title: '拍摄备忘', text: '下午两点' }],
          };
          const legInitialState = {
            schemaVersion: 1,
            id: legWorldId,
            ownerId: normalOwner,
            version: 0,
            title: legSeed.story.title,
            time: '2026-10-10T10:00:00.000Z',
            actors: legActors,
            facts: [],
            messages: [],
            appointments: [],
            mediaRequests: [],
          };
          await db.transaction(normalOwner, async (sql) => {
            await sql.query(
              'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
              [legSeedId, normalOwner, p.id, randomUUID(), 'hash_leg', legSeed],
            );
            await sql.query(
              'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
              [legWorldId, normalOwner, legSeed.story.title, legInitialState],
            );
            await sql.query(
              'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
              [legWorldId, normalOwner, legInitialState, legSeed],
            );
            await sql.query(
              'INSERT INTO parallel_life.world_builds(seed_id,owner_id,world_id,opening) VALUES($1,$2,$3,$4)',
              [legSeedId, normalOwner, legWorldId, legOpening],
            );
            await sql.query(
              'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,speed,paused,last_tick_at,missed_beats,summary) VALUES($1,$2,$3,1,false,$4,0,NULL)',
              [legWorldId, normalOwner, legInitialState.time, new Date().toISOString()],
            );
          });

          // Verify canEstablish is true for verified legacy world
          const legBefore = await space.read(normalOwner, legWorldId);
          assert.equal(legBefore.currentPlaceId, null);
          assert.equal(legBefore.canEstablish, true);

          // Establish space explicitly
          const estCmd = { commandId: randomUUID(), expectedVersion: 0 };
          const estRes = (await space.establish(normalOwner, legWorldId, estCmd)) as {
            status: string;
            version: number;
          };
          assert.equal(estRes.status, 'established');
          assert.equal(estRes.version, 1);

          // Replay establish returns identical receipt without creating duplicate event
          assert.deepEqual(await space.establish(normalOwner, legWorldId, estCmd), estRes);

          // Now space is established
          const legAfter = await space.read(normalOwner, legWorldId);
          assert.equal(legAfter.currentPlaceId, 'primary_place');
          assert.equal(legAfter.places[0]!.name, '海边灯塔工作室');
          assert.equal(legAfter.canEstablish, false);

          // 4. Old developed normal world (version > 0) cannot establish space
          const divergedWorldId = randomUUID();
          const divergedSeedId = randomUUID();
          const divergedSeed = { ...legSeed, id: divergedSeedId };
          const divergedState = { ...legInitialState, id: divergedWorldId, version: 1 };
          await db.transaction(normalOwner, async (sql) => {
            await sql.query(
              'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
              [divergedSeedId, normalOwner, p.id, randomUUID(), 'hash_diverged', divergedSeed],
            );
            await sql.query(
              'INSERT INTO parallel_life.worlds(id,owner_id,title,state,version) VALUES($1,$2,$3,$4,1)',
              [divergedWorldId, normalOwner, legSeed.story.title, divergedState],
            );
            await sql.query(
              'INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES($1,$2,$3,$4)',
              [divergedWorldId, normalOwner, legInitialState, divergedSeed],
            );
            await sql.query(
              'INSERT INTO parallel_life.world_builds(seed_id,owner_id,world_id,opening) VALUES($1,$2,$3,$4)',
              [divergedSeedId, normalOwner, divergedWorldId, legOpening],
            );
            await sql.query(
              'INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,speed,paused,last_tick_at,missed_beats,summary) VALUES($1,$2,$3,1,false,$4,0,NULL)',
              [divergedWorldId, normalOwner, divergedState.time, new Date().toISOString()],
            );
          });
          const divergedRead = await space.read(normalOwner, divergedWorldId);
          assert.equal(divergedRead.canEstablish, false);
          await assert.rejects(
            space.establish(normalOwner, divergedWorldId, {
              commandId: randomUUID(),
              expectedVersion: 1,
            }),
            { code: 'INVALID_COMMAND' },
          );
        } finally {
          await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [normalOwner]);
        }
      },
    );
  } finally {
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await db.close();
    await admin.end();
  }
});
