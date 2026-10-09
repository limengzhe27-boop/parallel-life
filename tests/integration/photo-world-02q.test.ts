import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
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
import { InterviewRepository } from '../../src/modules/profile/infrastructure/interview-repository.ts';
import { InterviewPlanner } from '../../src/modules/profile/infrastructure/interview-planner.ts';
import { interviewHandler } from '../../src/modules/profile/infrastructure/interview-handler.ts';
import { DraftRepository } from '../../src/modules/discovery/infrastructure/draft-repository.ts';
import { SeedRepository } from '../../src/modules/discovery/infrastructure/seed-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { BuildRepository } from '../../src/modules/world/infrastructure/build-repository.ts';
import { WorldPlanner } from '../../src/modules/world/infrastructure/world-planner.ts';
import { buildHandler } from '../../src/modules/world/infrastructure/build-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
import type { ApprovedSeed } from '../../src/contracts/seeds.ts';

// Real persisted repositories and owner-scoped queue; model responses are explicit fixtures.
test('PHOTO-WORLD-02Q: real PG caption → selection → two immutable world photo snapshots', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const owners = [randomUUID(), randomUUID()],
    owner = owners[0]!,
    other = owners[1]!;
  const dir = await mkdtemp(path.join(tmpdir(), 'pl-photoworld02q-'));
  const profiles = new ProfileRepository(db),
    interviews = new InterviewRepository(db);
  const assets = new AssetRepository(db, new PrivateDiskStore(dir)),
    drafts = new DraftRepository(db);
  const seeds = new SeedRepository(db),
    builds = new BuildRepository(db);
  let fixtureCalls = 0;
  const planner = new InterviewPlanner({
    async complete() {
      fixtureCalls++;
      return JSON.stringify({
        reply: '测试替身回复，不代表真实模型。',
        facts: [],
        events: [],
        people: [],
      });
    },
  });
  const send = async (text: string, photoAssetId?: string, streaming = false) => {
    const current = await interviews.get(owner);
    const command = {
      commandId: randomUUID(),
      expectedVersion: current.interview.version,
      text,
      ...(photoAssetId ? { photoAssetId } : {}),
    };
    if (streaming) await interviews.sendStreaming(owner, command, planner, () => {});
    else {
      const sent = await interviews.send(owner, command);
      const lease = await queue.claimForOwner(sent.task.id, owner, ['interview']);
      assert(lease);
      await interviewHandler(
        queue,
        planner,
        'fixture-no-real-model',
      )(lease, new AbortController().signal);
    }
    return interviews.get(owner);
  };
  const upload = async (colour: string) => {
    const bytes = await sharp({
      create: { width: 80, height: 80, channels: 3, background: colour },
    })
      .png()
      .toBuffer();
    const asset = await assets.upload(owner, bytes),
      p = await profiles.get(owner);
    await profiles.edit(owner, {
      expectedVersion: p.version,
      operation: { kind: 'add-reference-photo', assetId: asset.id },
    });
    return asset;
  };
  const prepare = async (personIds: string[], title: string) => {
    const p = await profiles.get(owner),
      directionId = randomUUID();
    const prior = await db.transaction(owner, (sql) =>
      sql.query('SELECT version FROM parallel_life.discoveries WHERE owner_id=$1', [owner]),
    );
    const version = (prior.rows[0]?.version ?? 0) + 1;
    const story = {
      title,
      premise: '合成照片验收场景',
      opening: '正在准备一本相册',
      tradeoff: '时间有限',
    };
    await db.transaction(owner, (sql) =>
      sql.query(
        'INSERT INTO parallel_life.discoveries(profile_id,owner_id,version,profile_version,document) VALUES($1,$2,$3,$4,$5) ON CONFLICT(profile_id) DO UPDATE SET version=$3,profile_version=$4,document=$5',
        [
          p.id,
          owner,
          version,
          p.version,
          {
            brief: '仅测试来源',
            directions: [{ id: directionId, ...story, reason: '合成', sources: [] }],
          },
        ],
      ),
    );
    const d = await drafts.prepare(owner, {
      commandId: randomUUID(),
      directionId,
      discoveryVersion: version,
    });
    const request = {
      commandId: randomUUID(),
      expectedVersion: d.version,
      expectedProfileVersion: p.version,
      story: d.story,
      setup: d.setup,
      selection: {
        ...d.selection,
        personIds,
        personRoles: personIds.map((personId) => ({ personId, role: '我的搭档' })),
      },
    };
    const saved = await drafts.save(owner, d.id, request);
    assert.deepEqual(await drafts.save(owner, d.id, request), saved);
    const confirm = {
      commandId: randomUUID(),
      expectedVersion: saved.version,
      expectedProfileVersion: p.version,
    };
    const confirmed = await drafts.confirm(owner, d.id, confirm);
    assert.deepEqual(await drafts.confirm(owner, d.id, confirm), confirmed);
    return seeds.get(owner, confirmed.seedId!);
  };
  const execute = async (seed: ApprovedSeed) => {
    const request = { commandId: randomUUID(), seedId: seed.id },
      pending = await builds.create(owner, request);
    assert.deepEqual(await builds.create(owner, request), pending);
    const worldPlanner = new WorldPlanner({
      async complete(messages) {
        fixtureCalls++;
        const input = JSON.parse(messages[1]!.content);
        assert.equal(input.people.length, seed.people.length);
        assert.equal(
          /assetId|sourceMessageIds|照片:\/api/.test(messages[1]!.content),
          false,
          'world prompt receives no private images or original chat',
        );
        return JSON.stringify({
          identity: '相册整理者',
          setting: '合成工作室',
          actors: [
            ...seed.people.map((p, i) => ({
              key: `person_${i}`,
              name: p.name,
              relationship: '我的搭档',
              persona: '整理自己负责的照片',
            })),
            ...Array.from({ length: Math.max(0, 3 - seed.people.length) }, (_, i) => ({
              key: `extra_${i}`,
              name: `原创${i}`,
              relationship: '同伴',
              persona: '有自己的生活',
            })),
          ],
          messages: [
            { actorKey: seed.people.length ? 'person_0' : 'extra_0', text: '一起来整理相册吧。' },
          ],
          notes: [{ title: '相册', text: '只整理被选中的照片' }],
        });
      },
    });
    const lease = await queue.claimForOwner(pending.task!.id, owner, ['world-build']);
    assert(lease);
    await buildHandler(
      queue,
      worldPlanner,
      'fixture-no-real-model',
    )(lease, new AbortController().signal);
    const built = (await builds.list(owner)).find((b) => b.worldId === pending.worldId)!;
    assert.equal(built.ready, true);
    await new PostgresClockStore(db).setClock(owner, built.worldId, { paused: true });
    return new BuildRepository(db).phone(owner, built.worldId);
  };
  try {
    for (const who of owners) await new IdentityRepository(db).ensureGuest(who);
    const a = await upload('#bb3344'),
      b = await upload('#3377bb');
    await send('[照片]', a.id);
    let workspace = await send('这是小芳。');
    assert.equal(workspace.profile.people.length, 1);
    const first = workspace.profile.people[0]!;
    assert.equal(first.assetId, a.id);
    const caption = workspace.interview.messages.filter((m) => m.role === 'user').at(-1)!;
    assert.ok(first.sourceMessageIds?.includes(caption.id));
    await send('[照片]', b.id, true);
    workspace = await send('这是小芳。', undefined, true);
    assert.equal(workspace.profile.people.length, 2);
    const second = workspace.profile.people.find((p) => p.assetId === b.id)!;
    assert(second && second.id !== first.id);
    assert.equal(second.name, first.name);
    assert.equal(workspace.profile.portraitAssetId, null);
    const seed1 = await prepare([first.id, second.id], '合成世界一'),
      world1 = await execute(seed1);
    await t.test('same-name actor IDs, avatar/album revision and actual stored bytes', async () => {
      assert.equal(world1.actors.filter((a) => a.name === first.name).length, 2);
      for (const [p, asset] of [
        [first, a],
        [second, b],
      ] as const) {
        const actor = world1.actors.find((a) => a.sourcePersonId === p.id)!;
        assert.deepEqual(actor.photo, { assetId: asset.id, revision: asset.revision });
        const photo = world1.photos!.find((p) => p.sourcePersonId === actor.sourcePersonId)!;
        assert.equal(photo.id, asset.id);
        assert.equal(photo.revision, asset.revision);
        const bytes = await assets.read(owner, asset.id),
          worldBytes = await assets.readForWorld(owner, world1.id, photo.id, photo.revision);
        assert.equal(
          createHash('sha256').update(worldBytes).digest('hex'),
          createHash('sha256').update(bytes).digest('hex'),
        );
      }
      assert.deepEqual(await new BuildRepository(db).phone(owner, world1.id), world1);
    });
    const replacement = await upload('#33bb77');
    let p = await profiles.get(owner);
    p = await profiles.edit(owner, {
      expectedVersion: p.version,
      operation: {
        kind: 'set-person',
        person: {
          id: first.id,
          name: first.name,
          knownName: first.knownName,
          temporaryLabel: first.temporaryLabel,
          relationship: first.relationship,
          assetId: replacement.id,
          interaction: first.interaction,
          experiences: first.experiences,
        },
      },
    });
    const seed2 = await prepare([first.id], '合成世界二'),
      world2 = await execute(seed2);
    await t.test(
      'current avatar sync preserves immutable seed/album; unselected same-name person excluded',
      async () => {
        assert.deepEqual((await builds.phone(owner, world1.id)).photos, world1.photos);
        assert.deepEqual(
          (await builds.phone(owner, world1.id)).actors.find((a) => a.sourcePersonId === first.id)!
            .photo,
          { assetId: replacement.id, revision: replacement.revision },
        );
        assert.deepEqual(world2.actors.find((a) => a.sourcePersonId === first.id)!.photo, {
          assetId: replacement.id,
          revision: replacement.revision,
        });
        assert.equal(
          world2.actors.some((a) => a.sourcePersonId === second.id),
          false,
        );
        assert.equal(world2.photos!.length, 1);
        assert.equal(world2.photos![0]!.id, replacement.id);
        assert.equal((await seeds.get(owner, seed1.id)).people[0]!.assetId, a.id);
        assert.deepEqual(
          await assets.readForWorld(owner, world1.id, replacement.id, replacement.revision),
          await assets.read(owner, replacement.id),
        );
        for (const asset of [a, b])
          await assert.rejects(assets.readForWorld(owner, world2.id, asset.id, asset.revision), {
            code: 'NOT_FOUND',
          });
      },
    );
    await t.test('cross-owner repository and RLS deny world, photos, seeds and draft', async () => {
      await assert.rejects(builds.phone(other, world1.id), { code: 'NOT_FOUND' });
      await assert.rejects(seeds.get(other, seed1.id), { code: 'NOT_FOUND' });
      if ('draftRef' in seed1)
        await assert.rejects(drafts.get(other, seed1.draftRef!.id), { code: 'NOT_FOUND' });
      await assert.rejects(assets.read(other, a.id), { code: 'NOT_FOUND' });
      await assert.rejects(assets.readForWorld(other, world1.id, a.id, a.revision), {
        code: 'NOT_FOUND',
      });
      const hidden = await db.transaction(other, (sql) =>
        sql.query('SELECT * FROM parallel_life.world_person_bindings WHERE world_id=$1', [
          world1.id,
        ]),
      );
      assert.equal(hidden.rowCount, 0);
      await assert.rejects(assets.remove(other, a.id), { code: 'NOT_FOUND' });
    });
    await t.test(
      'approved sources deletion protected; disposable deletion leaves both worlds intact',
      async () => {
        for (const asset of [a, b, replacement])
          await assert.rejects(assets.remove(owner, asset.id), { code: 'CONFLICT' });
        const unbound = await upload('#889988');
        await assets.remove(owner, unbound.id);
        await assert.rejects(assets.read(owner, unbound.id), { code: 'NOT_FOUND' });
        const current = await builds.phone(owner, world1.id);
        assert.deepEqual(current.photos, world1.photos);
        assert.deepEqual(
          current.actors.find((a) => a.sourcePersonId === second.id)!.photo,
          world1.actors.find((a) => a.sourcePersonId === second.id)!.photo,
        );
        assert.deepEqual(await builds.phone(owner, world2.id), world2);
      },
    );
    await t.test(
      'display-only and denied binding create no person or implicit player portrait',
      async () => {
        const display = await upload('#888888'),
          before = (await profiles.get(owner)).people;
        await send('只用这张图片作头像，不要认人。', display.id);
        await send('不要把这张照片绑定成小陈。');
        const after = await profiles.get(owner);
        assert.deepEqual(after.people, before);
        assert.equal(after.portraitAssetId, null);
        const emptySeed = await prepare([], '合成未选照片世界'),
          empty = await execute(emptySeed);
        assert.deepEqual(emptySeed.assets, []);
        assert.deepEqual(empty.photos, []);
        assert.equal(
          empty.actors.some((a) => a.photo),
          false,
        );
        await assert.rejects(assets.readForWorld(owner, empty.id, display.id, display.revision), {
          code: 'NOT_FOUND',
        });
      },
    );
    await t.test(
      'immutable bindings and restricted real DB role; one world task per seed',
      async () => {
        const rows = await admin.query(
          'SELECT person_id,asset_id,asset_revision FROM parallel_life.world_person_bindings WHERE world_id=$1',
          [world1.id],
        );
        assert.equal(rows.rowCount, 2);
        await assert.rejects(
          db.transaction(owner, (sql) =>
            sql.query(
              'UPDATE parallel_life.world_person_bindings SET asset_id=$2 WHERE world_id=$1',
              [world1.id, replacement.id],
            ),
          ),
          { code: '42501' },
        );
        const roles = await admin.query(
          "SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('pl_app','pl_worker')",
        );
        assert.equal(
          roles.rows.every((r) => !r.rolsuper && !r.rolbypassrls),
          true,
        );
        const tasks = await admin.query(
          'SELECT scope_kind,status FROM parallel_life.tasks WHERE owner_id=$1',
          [owner],
        );
        assert.equal(tasks.rows.filter((r) => r.scope_kind === 'world-build').length, 3);
        assert.equal(
          tasks.rows.every((r) => r.status === 'succeeded'),
          true,
        );
        assert.equal(fixtureCalls, tasks.rowCount);
      },
    );
  } finally {
    await db.close();
    await queue.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [owners]);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
