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
  } finally {
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await db.close();
    await admin.end();
  }
});
