import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { SeedRepository } from '../../src/modules/discovery/infrastructure/seed-repository.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
test('approved seeds preserve explicit selections, photo revisions and immutable ownership boundaries', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    owner = randomUUID(),
    other = randomUUID(),
    dir = await mkdtemp(join(tmpdir(), 'pl-seeds-'));
  try {
    const identity = new IdentityRepository(db);
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    const profiles = new ProfileRepository(db),
      seeds = new SeedRepository(db),
      assets = new AssetRepository(db, new PrivateDiskStore(dir));
    let p = await profiles.edit(owner, {
      expectedVersion: 0,
      operation: { kind: 'set-fact', category: 'interest', value: '喜欢修车' },
    });
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#10263a' },
    })
      .png()
      .toBuffer();
    const photo = await assets.upload(owner, bytes),
      foreign = await assets.upload(other, bytes);
    p = await profiles.edit(owner, {
      expectedVersion: p.version,
      operation: { kind: 'set-portrait', assetId: photo.id },
    });
    const friendPhoto = await assets.upload(owner, bytes);
    p = await profiles.edit(owner, {
      expectedVersion: p.version,
      operation: { kind: 'add-reference-photo', assetId: friendPhoto.id },
    });
    const person = {
      id: randomUUID(),
      name: '测试朋友',
      relationship: '同学',
      assetId: friendPhoto.id,
    };
    p = await profiles.edit(owner, {
      expectedVersion: p.version,
      operation: { kind: 'set-person', person },
    });
    const direction = {
      id: randomUUID(),
      title: '如果开一间工坊',
      premise: '学习经营一家小店',
      opening: '一个周末开门的早晨',
      tradeoff: '自由与收入波动',
      reason: '这段私密推荐依据不应进入世界',
      sources: [{ factId: p.facts[0]!.id, category: 'interest', value: '喜欢修车' }],
    };
    await db.transaction(owner, (sql) =>
      sql.query(
        'INSERT INTO parallel_life.discoveries(profile_id,owner_id,version,profile_version,document) VALUES($1,$2,1,$3,$4)',
        [p.id, owner, p.version, { brief: '私人构想过程', directions: [direction] }],
      ),
    );
    const request = {
      commandId: randomUUID(),
      profileVersion: p.version,
      discoveryVersion: 1,
      directionId: direction.id,
      factIds: [p.facts[0]!.id],
      personIds: [person.id],
      includePortrait: true,
    };
    const saved = await seeds.approve(owner, request);
    assert.equal((await seeds.approve(owner, request)).id, saved.id);
    assert.deepEqual(
      [...saved.assets].sort((a, b) => a.assetId.localeCompare(b.assetId)),
      [photo.id, friendPhoto.id].sort().map((assetId) => ({ assetId, revision: 1 })),
    );
    const portraitOnly = await seeds.approve(owner, {
      ...request,
      commandId: randomUUID(),
      personIds: [],
    });
    assert.deepEqual(portraitOnly.assets, [{ assetId: photo.id, revision: 1 }]);
    const friendOnly = await seeds.approve(owner, {
      ...request,
      commandId: randomUUID(),
      includePortrait: false,
    });
    assert.deepEqual(friendOnly.assets, [{ assetId: friendPhoto.id, revision: 1 }]);
    assert.equal(friendOnly.portraitAssetId, null);
    assert.deepEqual(saved.people, [person]);
    assert.equal(saved.portraitAssetId, photo.id);
    assert.deepEqual(Object.keys(saved.facts[0]!), ['factId', 'category', 'value']);
    assert.equal('reason' in saved.story, false);
    assert.equal(JSON.stringify(saved).includes('私人构想过程'), false);
    assert.deepEqual(await seeds.list(other), []);
    await assert.rejects(seeds.approve(owner, { ...request, includePortrait: false }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    const minimal = await seeds.approve(owner, {
      ...request,
      commandId: randomUUID(),
      factIds: [],
      personIds: [],
      includePortrait: false,
    });
    assert.deepEqual(minimal.facts, []);
    assert.deepEqual(minimal.people, []);
    assert.deepEqual(minimal.assets, []);
    assert.equal(minimal.portraitAssetId, null);
    await assert.rejects(seeds.approve(other, request), { code: 'VERSION_CONFLICT' });
    await assert.rejects(
      seeds.approve(owner, { ...request, commandId: randomUUID(), personIds: [randomUUID()] }),
      { code: 'INVALID_INPUT' },
    );
    await assert.rejects(
      admin.query('UPDATE parallel_life.approved_seeds SET document=document WHERE id=$1', [
        saved.id,
      ]),
      { code: '23514' },
    );
    await profiles.edit(owner, {
      expectedVersion: p.version,
      operation: {
        kind: 'set-fact',
        id: p.facts[0]!.id,
        category: 'interest',
        value: '现在喜欢种花',
      },
    });
    assert.deepEqual(
      (await seeds.list(owner)).find((s) => s.id === saved.id),
      saved,
    );
    await assert.rejects(seeds.approve(owner, { ...request, commandId: randomUUID() }), {
      code: 'VERSION_CONFLICT',
    });
    // Even a malformed stored profile cannot smuggle another owner's photograph into a seed.
    await admin.query(
      "UPDATE parallel_life.profiles SET version=$2,document=jsonb_set(document,'{portraitAssetId}',to_jsonb($3::text)) WHERE owner_id=$1",
      [owner, p.version, foreign.id],
    );
    await assert.rejects(seeds.approve(owner, { ...request, commandId: randomUUID() }), {
      code: 'INVALID_INPUT',
    });
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1)', [[owner, other]]);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
