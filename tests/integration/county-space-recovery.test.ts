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
import { SceneRepository } from '../../src/modules/world/infrastructure/scene-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { resolveTurn } from '../../src/modules/world/application/resolve-turn.ts';
import { advanceWorld } from '../../src/modules/world/application/advance-world.ts';

test('county travel and entry recover past an unresolved director without discarding its audit', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owner = randomUUID(),
    other = randomUUID();
  const identity = new IdentityRepository(db);
  await identity.ensureGuest(owner);
  await identity.ensureGuest(other);
  const catalog = new OfficialLifeRepository(db, officialLifeCatalog);
  const space = new PostgresWorldSpace(db, officialLifeCatalog);
  const clock = new PostgresClockStore(db);
  const scenes = new SceneRepository(db);
  const worlds = new PostgresWorldRepository(db);
  const pack = OFFICIAL_LIFE_PACKS.find((p) => p.card.id === 'county-yellow-hair')!;
  try {
    for (const status of ['unknown', 'started'] as const) {
      await t.test(
        `${status} without a live lock permits travel then entry; keeps original attempt and blocks automatic repayment`,
        async (t) => {
          const { worldId } = await catalog.start(owner, pack.card.id, {
            commandId: randomUUID(),
            version: pack.card.version,
          });
          t.after(async () => {
            await admin.query('DELETE FROM parallel_life.worlds WHERE id=$1', [worldId]);
          });
          const w = await worlds.get({ userId: owner }, worldId);
          const commandId = randomUUID();
          await clock.beginAttempt(
            owner,
            worldId,
            { commandId, plannedFor: w.time, actorId: w.actors[0]!.id },
            false,
          );
          if (status === 'unknown') await clock.markAttempt(owner, worldId, commandId, 'unknown');
          const before = (
            await admin.query(
              'SELECT * FROM parallel_life.world_director_attempts WHERE world_id=$1',
              [worldId],
            )
          ).rows;
          let calls = 0;
          await assert.rejects(
            advanceWorld(
              {
                clock,
                worlds,
                planner: {
                  async propose() {
                    calls++;
                    throw Error('must not pay');
                  },
                },
                now: () => new Date().toISOString(),
                newId: randomUUID,
                automatic: true,
              },
              { userId: owner },
              worldId,
            ),
            { code: 'VERSION_CONFLICT' },
          );
          assert.equal(calls, 0);
          assert.equal((await space.read(owner, worldId)).busy, false);
          await assert.rejects(space.read(other, worldId), { code: 'NOT_FOUND' });
          const request = {
            commandId: randomUUID(),
            expectedVersion: w.version,
            routeId: 'repair_shop_to_old_workshop',
          };
          const arrived = await space.travel(owner, worldId, request);
          assert.equal(arrived.toPlaceId, 'old_workshop');
          assert.deepEqual(await space.travel(owner, worldId, request), arrived);
          const entry = {
            commandId: randomUUID(),
            expectedVersion: arrived.version,
            placeId: 'old_workshop',
          };
          const scene = await scenes.enterPlace(owner, worldId, entry);
          assert.ok(scene.sceneId);
          assert.equal(scene.task?.status, 'queued');
          assert.deepEqual(await scenes.enterPlace(owner, worldId, entry), scene);
          assert.equal((await space.read(owner, worldId)).currentSceneId, scene.sceneId);
          assert.deepEqual(
            (
              await admin.query(
                'SELECT * FROM parallel_life.world_director_attempts WHERE world_id=$1',
                [worldId],
              )
            ).rows,
            before,
          );
          const back = {
            commandId: randomUUID(),
            expectedVersion: scene.version,
            routeId: 'old_workshop_to_repair_shop',
          };
          for (const taskStatus of ['queued', 'running', 'unknown']) {
            await admin.query('UPDATE parallel_life.tasks SET status=$2 WHERE id=$1', [
              scene.task!.id,
              taskStatus,
            ]);
            assert.equal((await space.read(owner, worldId)).busy, true);
            await assert.rejects(space.travel(owner, worldId, back), { code: 'BUSY' });
          }
          // Another independently started life for the next case; only synthetic rows are removed.
          await admin.query('DELETE FROM parallel_life.worlds WHERE id=$1', [worldId]);
        },
      );
    }
    await t.test(
      'real director lock covers model work and blocks location writes until released',
      async (t) => {
        const { worldId } = await catalog.start(owner, pack.card.id, {
          commandId: randomUUID(),
          version: pack.card.version,
        });
        t.after(async () => {
          await admin.query('DELETE FROM parallel_life.worlds WHERE id=$1', [worldId]);
        });
        const before = await space.read(owner, worldId);
        await clock.withAdvanceLock(worldId, async () => {
          assert.equal((await space.read(owner, worldId)).busy, true);
          await assert.rejects(
            space.travel(owner, worldId, {
              commandId: randomUUID(),
              expectedVersion: before.worldVersion,
              routeId: 'repair_shop_to_old_workshop',
            }),
            { code: 'BUSY' },
          );
          await assert.rejects(
            scenes.enterPlace(owner, worldId, {
              commandId: randomUUID(),
              expectedVersion: before.worldVersion,
              placeId: 'repair_shop',
            }),
            { code: 'BUSY' },
          );
        });
        assert.equal((await space.read(owner, worldId)).busy, false);
        assert.equal((await space.read(owner, worldId)).worldVersion, before.worldVersion);
        await admin.query('DELETE FROM parallel_life.worlds WHERE id=$1', [worldId]);
      },
    );
    await t.test(
      'a late old proposal cannot overwrite travel after its owning connection has been lost',
      async (t) => {
        const { worldId } = await catalog.start(owner, pack.card.id, {
          commandId: randomUUID(),
          version: pack.card.version,
        });
        const world = await worlds.get({ userId: owner }, worldId);
        let respond!: () => void, started!: () => void;
        const waiting = new Promise<void>((r) => {
          respond = r;
        });
        const ready = new Promise<void>((r) => {
          started = r;
        });
        const commandId = randomUUID();
        // Models may finish after a worker/connection disappears. Exercise the actual final commit fence.
        const pending = resolveTurn(
          {
            worlds,
            planner: {
              async propose() {
                started();
                await waiting;
                return {
                  schemaVersion: 1,
                  effects: [
                    {
                      type: 'message.received',
                      id: 'late',
                      actorId: world.actors[0]!.id,
                      text: '这是一条迟到的测试消息。',
                    },
                  ],
                };
              },
            },
            now: () => new Date().toISOString(),
            newId: randomUUID,
          },
          { userId: owner },
          {
            id: commandId,
            origin: 'director',
            worldId,
            actorId: world.actors[0]!.id,
            text: '继续当前事项',
            expectedVersion: world.version,
          },
        );
        const rejected = assert.rejects(pending, { code: 'VERSION_CONFLICT' });
        await ready;
        const travel = await space.travel(owner, worldId, {
          commandId: randomUUID(),
          expectedVersion: world.version,
          routeId: 'repair_shop_to_old_workshop',
        });
        respond();
        await rejected;
        const final = await space.read(owner, worldId);
        assert.equal(final.currentPlaceId, 'old_workshop');
        assert.equal(final.worldVersion, travel.version);
        assert.equal(
          (
            await admin.query(
              'SELECT 1 FROM parallel_life.world_events WHERE world_id=$1 AND command_id=$2',
              [worldId, commandId],
            )
          ).rowCount,
          0,
        );
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
