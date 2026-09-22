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
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
test('private images decode, strip metadata, enforce ownership and remove profile references', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    owner = randomUUID(),
    other = randomUUID(),
    dir = await mkdtemp(path.join(tmpdir(), 'pl-assets-test-')),
    repo = new AssetRepository(db, new PrivateDiskStore(dir)),
    profile = new ProfileRepository(db);
  try {
    const identity = new IdentityRepository(db);
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    const fixture = await sharp({
      create: { width: 240, height: 320, channels: 3, background: '#335577' },
    })
      .jpeg()
      .withExif({ IFD0: { Artist: 'SYNTHETIC-TEST' } })
      .toBuffer();
    const saved = await repo.upload(owner, fixture);
    const image = await repo.read(owner, saved.id),
      meta = await sharp(image).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.exif, undefined);
    await assert.rejects(repo.read(other, saved.id), { code: 'NOT_FOUND' });
    await assert.rejects(repo.upload(owner, Buffer.from('<svg></svg>')), { code: 'INVALID_INPUT' });
    await assert.rejects(
      profile.edit(other, {
        expectedVersion: 0,
        operation: { kind: 'set-portrait', assetId: saved.id },
      }),
      { code: 'NOT_FOUND' },
    );
    await assert.rejects(
      profile.edit(other, {
        expectedVersion: 0,
        operation: {
          kind: 'set-person',
          person: { id: randomUUID(), name: '朋友', relationship: '好友', assetId: saved.id },
        },
      }),
      { code: 'NOT_FOUND' },
    );
    await profile.edit(owner, {
      expectedVersion: 0,
      operation: { kind: 'set-portrait', assetId: saved.id },
    });
    await profile.edit(owner, {
      expectedVersion: 1,
      operation: {
        kind: 'set-person',
        person: { id: randomUUID(), name: '朋友', relationship: '好友', assetId: saved.id },
      },
    });
    await repo.remove(owner, saved.id);
    assert.equal((await profile.get(owner)).portraitAssetId, null);
    assert.equal((await profile.get(owner)).people[0]?.assetId, null);
    await assert.rejects(repo.read(owner, saved.id), { code: 'NOT_FOUND' });
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await admin.end();
    await rm(dir, { recursive: true });
  }
});
