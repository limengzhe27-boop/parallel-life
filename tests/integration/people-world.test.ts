import { historyFixture } from '../helpers/genesis-fixture.ts';
import { DraftRepository } from '../../src/modules/discovery/infrastructure/draft-repository.ts';
import { SeedRepository } from '../../src/modules/discovery/infrastructure/seed-repository.ts';
import type { Profile } from '../../src/contracts/api.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { runOne } from '../../src/modules/tasks/application/run-worker.ts';

test('PostgreSQL person bindings pin originals, enforce RLS and roll back an invalid material atomically', async () => {
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
    dir = await mkdtemp(path.join(tmpdir(), 'pl-people-'));
  const assets = new AssetRepository(db, new PrivateDiskStore(dir)),
    profiles = new ProfileRepository(db),
    builds = new BuildRepository(db);
  try {
    const identity = new IdentityRepository(db);
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    const bytes = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#8866aa' },
    })
      .png()
      .toBuffer();
    const photo = await assets.upload(owner, bytes),
      person = { id: randomUUID(), name: '合成人物', relationship: '老板', assetId: photo.id };
    const profile = await profiles.edit(owner, {
      expectedVersion: 0,
      operation: { kind: 'set-person', person },
    });
    const makeSeed = async (
      people: Profile['people'] = [person],
      assetList = [{ assetId: photo.id, revision: photo.revision }],
    ) => {
      const seed = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        profileVersion: profile.version,
        discoveryVersion: 1,
        directionId: randomUUID(),
        story: {
          title: '合成工作室',
          premise: '创建自己的团队',
          opening: '准备新项目',
          tradeoff: '预算有限',
        },
        facts: [],
        people,
        personRoles: people.map((p) => ({ personId: p.id, role: '我的下属' })),
        portraitAssetId: null,
        assets: assetList,
      };
      await db.transaction(owner, (sql) =>
        sql.query(
          'INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document) VALUES($1,$2,$3,$4,$5,$6)',
          [seed.id, owner, profile.id, randomUUID(), 'people-test', seed],
        ),
      );
      return seed;
    };
    const execute = async (seed: import('../../src/contracts/seeds.ts').ApprovedSeed) => {
      const request = { seedId: seed.id, commandId: randomUUID() };
      const pending = await builds.create(owner, request);
      assert.equal((await builds.create(owner, request)).worldId, pending.worldId);
      const planner = new WorldPlanner({
        async complete() {
          return JSON.stringify(
            historyFixture({
              identity: '负责人',
              setting: '合成工作室',
              actors: [
                ...seed.people.map((p, i) => ({
                  key: `p${i}`,
                  name: p.name,
                  sourcePersonId: p.id,
                  relationship: '同事',
                  persona: '独立生活，有自己的愿望',
                })),
                ...['a', 'b', 'c'].map((key) => ({
                  key,
                  name: key,
                  relationship: '朋友',
                  persona: '各有生活',
                })),
              ],
              messages: [{ actorKey: seed.people.length ? 'p0' : 'a', text: '初稿好了，你看看？' }],
              notes: [{ title: '今天', text: '看初稿' }],
            }),
          );
        },
      });
      await runOne(queue, { 'world-build': buildHandler(queue, planner, 'fixture-no-real-model') });
      return (await builds.list(owner)).find((b) => b.seedId === seed.id)!;
    };
    const direction = randomUUID(),
      story = {
        title: '合成工作室',
        premise: '创建自己的团队',
        opening: '准备新项目',
        tradeoff: '预算有限',
      };
    await db.transaction(owner, (sql) =>
      sql.query(
        'INSERT INTO parallel_life.discoveries(profile_id,owner_id,version,profile_version,document) VALUES($1,$2,1,$3,$4)',
        [
          profile.id,
          owner,
          profile.version,
          {
            brief: '合成用例',
            directions: [{ id: direction, ...story, reason: '合成', sources: [] }],
          },
        ],
      ),
    );
    const drafts = new DraftRepository(db),
      draft = await drafts.prepare(owner, {
        commandId: randomUUID(),
        directionId: direction,
        discoveryVersion: 1,
      });
    const saved = await drafts.save(owner, draft.id, {
      commandId: randomUUID(),
      expectedVersion: draft.version,
      expectedProfileVersion: profile.version,
      story: draft.story,
      setup: draft.setup,
      selection: {
        ...draft.selection,
        personIds: [person.id],
        personRoles: [{ personId: person.id, role: '我的下属' }],
      },
    });
    assert.deepEqual(saved.assets, [{ assetId: photo.id, revision: photo.revision }]);
    const confirm = {
      commandId: randomUUID(),
      expectedVersion: saved.version,
      expectedProfileVersion: profile.version,
    };
    const confirmed = await drafts.confirm(owner, draft.id, confirm);
    assert.deepEqual(await drafts.confirm(owner, draft.id, confirm), confirmed);
    const seeds = new SeedRepository(db),
      approved = await seeds.get(owner, confirmed.seedId!);
    assert.equal(approved.people[0]!.assetId, photo.id);
    assert.equal('personRoles' in approved, true);
    const directRequest = {
      commandId: randomUUID(),
      discoveryVersion: 1,
      profileVersion: profile.version,
      directionId: direction,
      factIds: [],
      personIds: [person.id],
      includePortrait: false,
    };
    const direct = await seeds.approve(owner, directRequest);
    assert.deepEqual(await seeds.approve(owner, directRequest), direct);
    assert.equal(direct.people[0]!.assetId, photo.id);
    const seed = approved,
      built = await execute(seed);
    assert.equal(built.ready, true);
    const phone = await builds.phone(owner, built.worldId);
    const actor = phone.actors.find((a) => a.sourcePersonId === person.id)!;
    assert.equal(actor.name, person.name);
    assert.equal(actor.relationship, '我的下属');
    assert.deepEqual(actor.photo, { assetId: photo.id, revision: photo.revision });
    const imported = phone.photos!.find((p) => p.sourcePersonId === person.id)!;
    assert.equal(imported.id, photo.id);
    assert.match(imported.title, /用户带入/);
    assert.equal(imported.date, photo.createdAt);
    assert.deepEqual(
      await assets.readForWorld(owner, built.worldId, photo.id, photo.revision),
      await assets.read(owner, photo.id),
    );
    await assert.rejects(assets.readForWorld(other, built.worldId, photo.id, photo.revision), {
      code: 'NOT_FOUND',
    });
    await assert.rejects(assets.readForWorld(owner, built.worldId, photo.id, photo.revision + 1), {
      code: 'NOT_FOUND',
    });
    assert.deepEqual(
      await db
        .transaction(other, (sql) => sql.query('SELECT * FROM parallel_life.world_person_bindings'))
        .then((r) => r.rows),
      [],
    );
    await assert.rejects(
      db.transaction(owner, (sql) =>
        sql.query(
          'UPDATE parallel_life.world_person_bindings SET asset_revision=2 WHERE world_id=$1',
          [built.worldId],
        ),
      ),
      { code: '42501' },
    );
    await assert.rejects(
      admin.query(
        'UPDATE parallel_life.world_person_bindings SET asset_revision=2 WHERE world_id=$1',
        [built.worldId],
      ),
    );
    const replacement = await assets.upload(owner, bytes);
    await profiles.edit(owner, {
      expectedVersion: profile.version,
      operation: {
        kind: 'set-person',
        person: { ...person, name: '改名后', assetId: replacement.id },
      },
    });
    assert.equal((await profiles.get(owner)).people[0]!.relationship, '老板');
    const updatedPhone = await builds.phone(owner, built.worldId);
    assert.deepEqual(
      updatedPhone.actors,
      phone.actors.map((actor) =>
        actor.sourcePersonId === person.id
          ? { ...actor, photo: { assetId: replacement.id, revision: replacement.revision } }
          : actor,
      ),
    );
    assert.deepEqual(updatedPhone.photos, phone.photos);
    assert.deepEqual(
      await assets.readForWorld(owner, built.worldId, replacement.id, replacement.revision),
      await assets.read(owner, replacement.id),
    );
    await assert.rejects(assets.remove(owner, photo.id), { code: 'CONFLICT' });
    const noPhoto = await execute(await makeSeed([{ ...person, assetId: null }], []));
    assert.equal(noPhoto.ready, true);
    const noPhotoPhone = await builds.phone(owner, noPhoto.worldId);
    assert.equal(noPhotoPhone.photos!.length, 0);
    assert.deepEqual(noPhotoPhone.actors[0]!.photo, {
      assetId: replacement.id,
      revision: replacement.revision,
    });
    assert.deepEqual(
      await assets.readForWorld(owner, noPhoto.worldId, replacement.id, replacement.revision),
      await assets.read(owner, replacement.id),
    );
    await assert.rejects(assets.readForWorld(owner, noPhoto.worldId, photo.id, photo.revision), {
      code: 'NOT_FOUND',
    });
    const noPeople = await execute(await makeSeed([], []));
    assert.equal(noPeople.ready, true);
    // A stale revision is detected inside the genesis transaction, after INSERT worlds.
    const invalid = await execute(
      await makeSeed([person], [{ assetId: photo.id, revision: photo.revision + 1 }]),
    );
    assert.equal(invalid.ready, false);
    assert.equal(invalid.task?.status, 'failed');
    assert.equal(
      (
        await admin.query('SELECT count(*)::int n FROM parallel_life.worlds WHERE id=$1', [
          invalid.worldId,
        ])
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.world_person_bindings WHERE world_id=$1',
          [invalid.worldId],
        )
      ).rows[0].n,
      0,
    );
    const replay = await builds.create(owner, { seedId: seed.id, commandId: randomUUID() });
    assert.equal(replay.worldId, built.worldId);
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int n FROM parallel_life.world_person_bindings WHERE world_id=$1',
          [built.worldId],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
