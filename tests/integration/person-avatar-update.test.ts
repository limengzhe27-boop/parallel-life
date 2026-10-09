import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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
test('PHOTO-AVATAR-UPDATE-01: atomic current avatar sync with immutable history', async (t) => {
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
    const first = workspace.profile.people[0]!;
    await send('[照片]', b.id);
    workspace = await send('这是小芳。');
    const second = workspace.profile.people.find((p) => p.assetId === b.id)!;
    assert.equal(first.name, second.name);
    assert.notEqual(first.id, second.id);
    const seed1 = await prepare([first.id, second.id], '头像验收一'),
      world1 = await execute(seed1);
    const seed2 = await prepare([first.id], '头像验收二'),
      world2 = await execute(seed2);
    const unchanged = async () => {
      assert.deepEqual((await builds.phone(owner, world1.id)).photos, world1.photos);
      assert.deepEqual((await builds.phone(owner, world2.id)).photos, world2.photos);
      assert.deepEqual(await seeds.get(owner, seed1.id), seed1);
      assert.deepEqual(await seeds.get(owner, seed2.id), seed2);
      const original = await admin.query(
        'SELECT asset_id FROM parallel_life.world_person_bindings WHERE owner_id=$1 AND person_id=$2 AND world_id=ANY($3::text[]) ORDER BY world_id',
        [owner, first.id, [world1.id, world2.id]],
      );
      assert(original.rows.every((r) => r.asset_id === a.id));
    };
    const photoOf = async (worldId: string, personId = first.id) =>
      (await builds.phone(owner, worldId)).actors.find((x) => x.sourcePersonId === personId)!.photo;
    const request = async (assetId: string | null) => ({
      commandId: randomUUID(),
      expectedVersion: (await profiles.get(owner)).version,
      operation: {
        kind: 'set-person' as const,
        person: { id: first.id, name: first.name, relationship: first.relationship, assetId },
      },
    });
    const c = await upload('#33bb77'),
      command = await request(c.id);
    await t.test(
      'migration backfill adopts pre-upgrade replacements with same-name isolation',
      async () => {
        const migration = await readFile(
          new URL('../../db/migrations/0039_current_person_avatars.sql', import.meta.url),
          'utf8',
        );
        const start = migration.indexOf('DO $$', migration.indexOf('-- Existing authorized'));
        const end = migration.indexOf('END $$;', start) + 'END $$;'.length;
        assert(start > 0 && end > start);
        await admin.query('BEGIN');
        try {
          await admin.query(
            'ALTER TABLE parallel_life.profiles DISABLE TRIGGER profile_current_avatar_sync',
          );
          await admin.query(
            'DELETE FROM parallel_life.world_person_avatar_updates WHERE owner_id=$1',
            [owner],
          );
          await admin.query('DELETE FROM parallel_life.world_person_avatars WHERE owner_id=$1', [
            owner,
          ]);
          await admin.query(
            `UPDATE parallel_life.profiles SET document=jsonb_set(document,'{people}',
          (SELECT jsonb_agg(CASE WHEN item->>'id'=$2 THEN jsonb_set(item,'{assetId}',to_jsonb($3::text)) ELSE item END)
           FROM jsonb_array_elements(document->'people') item)),version=version+1 WHERE owner_id=$1`,
            [owner, first.id, c.id],
          );
          // Execute the actual migration backfill, not a fixture reimplementation.
          await admin.query(migration.slice(start, end));
          const rows = (
            await admin.query(
              'SELECT person_id,asset_id FROM parallel_life.world_person_avatars WHERE owner_id=$1',
              [owner],
            )
          ).rows;
          assert.equal(
            rows.filter((r) => r.person_id === first.id && r.asset_id === c.id).length,
            2,
          );
          assert.equal(
            rows.filter((r) => r.person_id === second.id && r.asset_id === b.id).length,
            1,
          );
          const history = (
            await admin.query(
              'SELECT person_id,asset_id FROM parallel_life.world_person_bindings WHERE owner_id=$1',
              [owner],
            )
          ).rows;
          assert.equal(
            history.filter((r) => r.person_id === first.id && r.asset_id === a.id).length,
            2,
          );
        } finally {
          await admin.query('ROLLBACK');
        }
        assert.equal((await profiles.get(owner)).version, command.expectedVersion);
        await unchanged();
      },
    );
    await t.test(
      'same person updates two existing worlds; same-name other person and history unchanged',
      async () => {
        const saved = await profiles.edit(owner, command);
        for (const w of [world1, world2]) {
          assert.deepEqual(await photoOf(w.id), { assetId: c.id, revision: c.revision });
          assert.deepEqual(
            await assets.readForWorld(owner, w.id, c.id, c.revision),
            await assets.read(owner, c.id),
          );
        }
        assert.deepEqual(await photoOf(world1.id, second.id), {
          assetId: b.id,
          revision: b.revision,
        });
        assert.deepEqual(await profiles.edit(owner, command), saved);
        await unchanged();
      },
    );
    await t.test(
      'same command replays without extra updates; changed command payload conflicts',
      async () => {
        const before = (
          await admin.query(
            'SELECT * FROM parallel_life.world_person_avatar_updates WHERE owner_id=$1 ORDER BY world_id,avatar_version',
            [owner],
          )
        ).rows;
        await profiles.edit(owner, command);
        assert.deepEqual(
          (
            await admin.query(
              'SELECT * FROM parallel_life.world_person_avatar_updates WHERE owner_id=$1 ORDER BY world_id,avatar_version',
              [owner],
            )
          ).rows,
          before,
        );
        assert.equal(before.filter((r) => r.command_id === command.commandId).length, 2);
        await assert.rejects(
          profiles.edit(owner, {
            ...command,
            operation: {
              ...command.operation,
              person: { ...command.operation.person, assetId: b.id },
            },
          }),
          { code: 'IDEMPOTENCY_CONFLICT' },
        );
      },
    );
    const emptySeed = await prepare([], '未带入人物的世界'),
      empty = await execute(emptySeed);
    await t.test(
      'precise world grant, cross owner and real role cannot change pointers',
      async () => {
        await assert.rejects(assets.readForWorld(owner, empty.id, c.id, c.revision), {
          code: 'NOT_FOUND',
        });
        await assert.rejects(assets.readForWorld(other, world1.id, c.id, c.revision), {
          code: 'NOT_FOUND',
        });
        const hidden = await db.transaction(other, (sql) =>
          sql.query('SELECT * FROM parallel_life.world_person_avatars WHERE world_id=$1', [
            world1.id,
          ]),
        );
        assert.equal(hidden.rowCount, 0);
        await assert.rejects(
          db.transaction(owner, (sql) =>
            sql.query(
              'UPDATE parallel_life.world_person_avatars SET asset_id=$1 WHERE world_id=$2',
              [b.id, world1.id],
            ),
          ),
          { code: '42501' },
        );
        await assert.rejects(
          db.transaction(owner, (sql) =>
            sql.query(
              "SELECT parallel_life.sync_current_person_avatar($1,$2,$3,$4,$5,1,NULL,'profile')",
              [
                owner,
                world1.id,
                first.id,
                world1.actors.find((a) => a.sourcePersonId === first.id)!.id,
                b.id,
              ],
            ),
          ),
          { code: '42501' },
        );
      },
    );
    await t.test(
      'clear photo clears both current avatars without fallback; history remains readable',
      async () => {
        await profiles.edit(owner, await request(null));
        assert.equal(await photoOf(world1.id), undefined);
        assert.equal(await photoOf(world2.id), undefined);
        await assert.rejects(assets.readForWorld(owner, world1.id, c.id, c.revision), {
          code: 'NOT_FOUND',
        });
        assert.deepEqual(
          await assets.readForWorld(owner, world1.id, a.id, a.revision),
          await assets.read(owner, a.id),
        );
        await unchanged();
      },
    );
    await t.test(
      'late world creation from a photo-free seed uses current avatar without changing its album',
      async () => {
        const seed = await prepare([first.id], '无原始照片的人物');
        assert.equal(seed.assets.length, 0);
        await profiles.edit(owner, await request(c.id));
        const late = await execute(seed);
        assert.deepEqual(await photoOf(late.id), { assetId: c.id, revision: c.revision });
        assert.deepEqual(late.photos, []);
        assert.deepEqual(
          await assets.readForWorld(owner, late.id, c.id, c.revision),
          await assets.read(owner, c.id),
        );
        await assert.rejects(assets.readForWorld(owner, late.id, a.id, a.revision), {
          code: 'NOT_FOUND',
        });
        assert.deepEqual(await seeds.get(owner, seed.id), seed);
      },
    );
    const d = await upload('#eebb33');
    await t.test(
      'two commands with same profile version have one winner and atomic latest avatar',
      async () => {
        const one = await request(c.id),
          two = {
            ...one,
            commandId: randomUUID(),
            operation: { ...one.operation, person: { ...one.operation.person, assetId: d.id } },
          };
        const results = await Promise.allSettled([
          profiles.edit(owner, one),
          profiles.edit(owner, two),
        ]);
        assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
        const failed = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
        assert.equal(failed.reason.code, 'VERSION_CONFLICT');
        const current = (await profiles.get(owner)).people.find((p) => p.id === first.id)!.assetId;
        for (const w of [world1, world2]) assert.equal((await photoOf(w.id))!.assetId, current);
        await unchanged();
      },
    );
    await t.test(
      'deleted profile person preserves authorized world avatar and protects active asset',
      async () => {
        await profiles.edit(owner, await request(d.id));
        await profiles.edit(owner, {
          commandId: randomUUID(),
          expectedVersion: (await profiles.get(owner)).version,
          operation: { kind: 'delete-person', id: first.id },
        });
        assert.equal((await photoOf(world1.id))!.assetId, d.id);
        await assert.rejects(assets.remove(owner, d.id), { code: 'CONFLICT' });
        // Remove shared-reference use first; active avatar alone must still protect the upload.
        await profiles.edit(owner, {
          expectedVersion: (await profiles.get(owner)).version,
          operation: { kind: 'delete-reference-photo', assetId: d.id },
        });
        await assert.rejects(assets.discardUnreferencedUpload(owner, d.id), { code: 'CONFLICT' });
        await assert.rejects(
          db.transaction(owner, (sql) =>
            sql.query(
              "UPDATE parallel_life.assets SET status='deleted',revision=revision+1 WHERE id=$1",
              [d.id],
            ),
          ),
          { code: '23514' },
        );
        await unchanged();
      },
    );
    await t.test(
      'transaction sync failure rolls profile and command receipt back; same command can recover',
      async () => {
        const retry = await request(c.id),
          before = await profiles.get(owner);
        await admin.query(
          "CREATE FUNCTION parallel_life.avatar_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture avatar sync failure' USING ERRCODE='23514'; END $$",
        );
        await admin.query(
          'CREATE TRIGGER avatar_test_failure BEFORE INSERT ON parallel_life.world_person_avatar_updates FOR EACH ROW EXECUTE FUNCTION parallel_life.avatar_test_failure()',
        );
        try {
          await assert.rejects(profiles.edit(owner, retry), { code: '23514' });
          assert.deepEqual(await profiles.get(owner), before);
          assert.equal((await photoOf(world1.id))!.assetId, d.id);
          assert.equal(
            (
              await admin.query(
                'SELECT 1 FROM parallel_life.profile_edit_receipts WHERE owner_id=$1 AND command_id=$2',
                [owner, retry.commandId],
              )
            ).rowCount,
            0,
          );
        } finally {
          await admin.query(
            'DROP TRIGGER avatar_test_failure ON parallel_life.world_person_avatar_updates',
          );
          await admin.query('DROP FUNCTION parallel_life.avatar_test_failure()');
        }
        await profiles.edit(owner, retry);
        assert.equal((await photoOf(world1.id))!.assetId, c.id);
        await unchanged();
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
