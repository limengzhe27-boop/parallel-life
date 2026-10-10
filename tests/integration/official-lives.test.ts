import { SeedRepository } from '../../src/modules/discovery/infrastructure/seed-repository.ts';
import { officialLifeCatalog } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresPlayerRecords } from '../../src/modules/world/infrastructure/player-records-repository.ts';
import { officialFixture } from '../fixtures/official-life.ts';

test('official starts are atomic, owner-isolated and idempotent in real PostgreSQL', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    db = new PostgresDatabase(
      'postgresql://pl_app:' + c.appPassword + '@127.0.0.1:' + c.port + '/parallel_life_test',
    );
  const owner = randomUUID(),
    other = randomUUID(),
    identity = new IdentityRepository(db);
  await identity.ensureGuest(owner);
  await identity.ensureGuest(other);
  const pack = officialFixture();
  const catalog = { list: () => [pack], get: () => pack };
  const repo = new OfficialLifeRepository(db, catalog),
    worlds = new PostgresWorldRepository(db),
    builds = new BuildRepository(db);
  try {
    await t.test(
      'all four real approved packs start for two owners with isolated initial phones',
      async () => {
        const real = new OfficialLifeRepository(db, officialLifeCatalog);
        const realOwner = randomUUID(),
          realOther = randomUUID();
        await identity.ensureGuest(realOwner);
        await identity.ensureGuest(realOther);
        try {
          for (const pack of officialLifeCatalog.list()) {
            const a = await real.start(realOwner, pack.card.id, {
              commandId: randomUUID(),
              version: pack.card.version,
            });
            const b = await real.start(realOther, pack.card.id, {
              commandId: randomUUID(),
              version: pack.card.version,
            });
            assert.notEqual(a.worldId, b.worldId);
            const phone = await builds.phone(realOwner, a.worldId);
            assert.equal(phone.actors.length, 6);
            assert.equal(
              phone.messages.filter((m) => m.origin === 'fictional_history').length,
              pack.opening.messages.filter((m) => m.history).length,
            );
            assert.equal(phone.messages.filter((m) => !m.initialRead).length, 3);
            assert.ok(phone.invitations!.every((i) => i.status === 'proposed'));
            const records = await new PostgresPlayerRecords(db).read(realOwner, a.worldId);
            assert.equal(
              records.about.filter(
                (r) => r.source.kind === 'opening_field' && r.source.field === 'official_note',
              ).length,
              3,
            );
            assert.ok(!JSON.stringify(phone).includes('persona'));
            const again = await real.start(realOwner, pack.card.id, {
              commandId: randomUUID(),
              version: pack.card.version,
            });
            assert.equal(again.worldId, a.worldId);
            assert.equal(again.resumed, true);
          }
          assert.deepEqual(await new SeedRepository(db).list(realOwner), []);
          assert.deepEqual(await builds.list(realOwner), []);
        } finally {
          await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [
            [realOwner, realOther],
          ]);
        }
      },
    );
    await t.test(
      'two simultaneous commands and a repeated original command create one ready world with no AI task',
      async () => {
        const input = { commandId: randomUUID(), version: 1 };
        const [a, b] = await Promise.all([
          repo.start(owner, pack.card.id, input),
          repo.start(owner, pack.card.id, { commandId: randomUUID(), version: 1 }),
        ]);
        assert.equal(a.worldId, b.worldId);
        assert.notEqual(a.resumed, b.resumed);
        assert.deepEqual(await repo.start(owner, pack.card.id, input), a);
        const list = await repo.list(owner);
        assert.equal(list.lives[0]!.worldId, a.worldId);
        const state = await worlds.get({ userId: owner }, a.worldId);
        assert.equal(state.version, 0);
        assert.equal(state.messages.length, 9);
        assert.equal(state.appointments[0]!.status, 'proposed');
        const phone = await builds.phone(owner, a.worldId);
        assert.equal(phone.actors.length, 6);
        assert.equal(phone.version, 0);
        assert.deepEqual(await builds.list(owner), []);
        const counts = (
          await admin.query(
            'SELECT (SELECT count(*) FROM parallel_life.tasks WHERE owner_id=$1)::int AS tasks,(SELECT count(*) FROM parallel_life.outbox_jobs WHERE owner_id=$1)::int AS outbox',
            [owner],
          )
        ).rows[0];
        assert.deepEqual(counts, { tasks: 0, outbox: 0 });
        const clock = (
          await admin.query(
            'SELECT story_now,last_tick_at FROM parallel_life.world_clock WHERE world_id=$1',
            [a.worldId],
          )
        ).rows[0];
        assert.equal(clock.story_now.toISOString(), '2026-10-09T09:40:00.000Z');
        assert.ok(Math.abs(Date.now() - clock.last_tick_at.getTime()) < 30000);
        const stored = (
          await admin.query(
            'SELECT document,profile_id FROM parallel_life.approved_seeds WHERE id=$1',
            [a.seedId],
          )
        ).rows[0];
        assert.equal(stored.profile_id, null);
        assert.equal(stored.document.source.kind, 'official_life');
        assert.deepEqual(stored.document.people, []);
        assert.deepEqual(stored.document.facts, []);
        await assert.rejects(
          repo.start(owner, 'retired-star', { ...input }),
          /IDEMPOTENCY_CONFLICT/,
        );
        await assert.rejects(
          repo.start(owner, pack.card.id, { commandId: randomUUID(), version: 2 }),
          /VERSION_CONFLICT/,
        );
      },
    );
    await t.test(
      'a different owner gets independent IDs and RLS rejects cross-owner reads',
      async () => {
        const a = await repo.start(owner, pack.card.id, { commandId: randomUUID(), version: 1 });
        const b = await repo.start(other, pack.card.id, { commandId: randomUUID(), version: 1 });
        assert.notEqual(a.worldId, b.worldId);
        assert.notEqual(a.seedId, b.seedId);
        const sa = await worlds.get({ userId: owner }, a.worldId),
          sb = await worlds.get({ userId: other }, b.worldId);
        assert.ok(sa.actors.every((actor) => !sb.actors.some((x) => x.id === actor.id)));
        await assert.rejects(builds.phone(other, a.worldId), /NOT_FOUND/);
        const query = await db.transaction(other, (sql) =>
          sql.query('SELECT * FROM parallel_life.official_life_instances WHERE owner_id=$1', [
            owner,
          ]),
        );
        assert.equal(query.rowCount, 0);
      },
    );
    await t.test(
      'read-only editorial records retain sources through invitation acceptance and do not mutate genesis',
      async () => {
        const result = await repo.start(owner, pack.card.id, {
          commandId: randomUUID(),
          version: 1,
        });
        const before = (
          await admin.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [result.worldId],
          )
        ).rows[0].state;
        const records = await new PostgresPlayerRecords(db).read(owner, result.worldId);
        assert.ok(records.about.some((r) => r.text.includes('Editorial R17')));
        assert.equal(records.current[0]!.state, 'proposed');
        const state = await worlds.get({ userId: owner }, result.worldId);
        await worlds.respondToInvitation(
          { userId: owner },
          {
            commandId: randomUUID(),
            worldId: result.worldId,
            id: state.appointments[0]!.id,
            expectedVersion: 0,
            operation: 'accept',
          },
        );
        const accepted = await new PostgresPlayerRecords(db).read(owner, result.worldId);
        assert.equal(accepted.current.find((r) => r.kind === 'invitation')!.state, 'confirmed');
        assert.equal(
          accepted.current.find((r) => r.kind === 'invitation')!.source.kind,
          'world_event',
        );
        const after = (
          await admin.query(
            'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1',
            [result.worldId],
          )
        ).rows[0].state;
        assert.deepEqual(after, before);
      },
    );
    await t.test(
      'invalid editorial references roll back without orphan seeds/worlds and null private profile is rejected',
      async () => {
        const fresh = randomUUID();
        await identity.ensureGuest(fresh);
        try {
          const broken = officialFixture();
          broken.opening.invitations[0]!.sourceMessageKey = 'missing';
          const invalid = new OfficialLifeRepository(db, {
            list: () => [broken],
            get: () => broken,
          });
          await assert.rejects(
            invalid.start(fresh, pack.card.id, { commandId: randomUUID(), version: 1 }),
          );
          const n = (
            await admin.query(
              'SELECT count(*)::int AS n FROM parallel_life.approved_seeds WHERE owner_id=$1',
              [fresh],
            )
          ).rows[0].n;
          assert.equal(n, 0);
          await assert.rejects(
            db.transaction(fresh, (sql) =>
              sql.query(
                'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,NULL,$3,$4,$5)',
                [randomUUID(), fresh, randomUUID(), 'a'.repeat(64), {}],
              ),
            ),
          );
        } finally {
          await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [fresh]);
        }
      },
    );
    await t.test(
      'SPACE-02D: user with legacy save continues old save by default, can explicitly start new version, and legacy world remains intact',
      async () => {
        const user = randomUUID();
        const otherUser = randomUUID();
        await identity.ensureGuest(user);
        await identity.ensureGuest(otherUser);
        try {
          // 1. User started v1 previously
          const v1Pack = officialFixture();
          const v1Catalog = { list: () => [v1Pack], get: () => v1Pack };
          const v1Repo = new OfficialLifeRepository(db, v1Catalog);
          const oldCommandId = randomUUID();
          const v1Result = await v1Repo.start(user, v1Pack.card.id, {
            commandId: oldCommandId,
            version: 1,
          });
          const oldWorldId = v1Result.worldId;

          // 2. Now the catalog has been upgraded to v2
          const v2Repo = new OfficialLifeRepository(db, officialLifeCatalog);
          const listBefore = await v2Repo.list(user);
          const cardBefore = listBefore.lives.find((l) => l.id === 'county-yellow-hair');
          assert.ok(cardBefore);
          assert.equal(cardBefore.version, 2);
          // Default continues old save!
          assert.equal(cardBefore.worldId, oldWorldId);
          assert.equal(cardBefore.legacyWorldId, oldWorldId);
          assert.equal(cardBefore.currentVersionWorldId, null);
          assert.equal(cardBefore.hasNewVersion, true);

          // 3. User explicitly starts new version (v2)
          const newCommandId = randomUUID();
          const v2Result = await v2Repo.start(user, 'county-yellow-hair', {
            commandId: newCommandId,
            version: 2,
          });
          const newWorldId = v2Result.worldId;
          assert.notEqual(newWorldId, oldWorldId);
          assert.equal(v2Result.resumed, false);

          // 4. In PostgreSQL official_life_instances, both v1 and v2 rows exist
          const instances = (
            await admin.query(
              'SELECT content_version, world_id FROM parallel_life.official_life_instances WHERE owner_id=$1 AND preset_id=$2 ORDER BY content_version',
              [user, 'county-yellow-hair'],
            )
          ).rows;
          assert.equal(instances.length, 2);
          assert.equal(instances[0].content_version, 1);
          assert.equal(instances[0].world_id, oldWorldId);
          assert.equal(instances[1].content_version, 2);
          assert.equal(instances[1].world_id, newWorldId);

          // 5. Old world state is completely preserved and readable
          const oldPhone = await builds.phone(user, oldWorldId);
          assert.ok(oldPhone);
          const newPhone = await builds.phone(user, newWorldId);
          assert.ok(newPhone);
          assert.ok(oldPhone.actors.length > 0);
          assert.ok(newPhone.actors.length > 0);

          // 6. User queries list: now both current and legacy exist, user can access both
          const listAfter = await v2Repo.list(user);
          const cardAfter = listAfter.lives.find((l) => l.id === 'county-yellow-hair');
          assert.ok(cardAfter);
          assert.equal(cardAfter.worldId, newWorldId);
          assert.equal(cardAfter.currentVersionWorldId, newWorldId);
          assert.equal(cardAfter.legacyWorldId, oldWorldId);
          assert.equal(cardAfter.hasNewVersion, false);

          // 7. Idempotency: replaying newCommandId returns the same result without creating a 3rd world
          const replayed = await v2Repo.start(user, 'county-yellow-hair', {
            commandId: newCommandId,
            version: 2,
          });
          assert.equal(replayed.worldId, newWorldId);
          assert.equal(replayed.resumed, false);

          // Repeated request with another commandId returns resumed: true
          const repeated = await v2Repo.start(user, 'county-yellow-hair', {
            commandId: randomUUID(),
            version: 2,
          });
          assert.equal(repeated.worldId, newWorldId);
          assert.equal(repeated.resumed, true);

          const finalInstances = (
            await admin.query(
              'SELECT count(*)::int AS count FROM parallel_life.official_life_instances WHERE owner_id=$1 AND preset_id=$2',
              [user, 'county-yellow-hair'],
            )
          ).rows[0].count;
          assert.equal(finalInstances, 2);

          // 8. Cross-user isolation
          const otherList = await v2Repo.list(otherUser);
          const otherCard = otherList.lives.find((l) => l.id === 'county-yellow-hair');
          assert.ok(otherCard);
          assert.equal(otherCard.worldId, null);
          assert.equal(otherCard.legacyWorldId, null);
          assert.equal(otherCard.currentVersionWorldId, null);
          assert.equal(otherCard.hasNewVersion, false);
          await assert.rejects(builds.phone(otherUser, oldWorldId), /NOT_FOUND/);
          await assert.rejects(builds.phone(otherUser, newWorldId), /NOT_FOUND/);
        } finally {
          await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [
            [user, otherUser],
          ]);
        }
      },
    );
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
    await admin.end();
  }
});
