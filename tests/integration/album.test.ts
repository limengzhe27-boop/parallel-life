import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import {
  PostgresDatabase,
  type SqlClient,
} from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { AssetRepository } from '../../src/modules/media/infrastructure/asset-repository.ts';
import { albumPhotos } from '../../src/modules/media/infrastructure/album-projection.ts';
import { PrivateDiskStore } from '../../src/modules/media/infrastructure/private-disk-store.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';

test('album upload persists private bytes and scoped entries atomically, replay deduplicates and media leaves narrative version unchanged', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    url = `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`;
  let db = new PostgresDatabase(url);
  const owner = randomUUID(),
    other = randomUUID(),
    world = randomUUID(),
    secondWorld = randomUUID();
  const dir = await mkdtemp(path.join(tmpdir(), 'pl-album-test-'));
  let repo = new AssetRepository(db, new PrivateDiskStore(dir));
  const input = { commandId: randomUUID(), title: '相册测试' };
  const list = (user: string, id = world) => db.transaction(user, (sql) => albumPhotos(sql, id));
  try {
    const identity = new IdentityRepository(db);
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    for (const id of [world, secondWorld])
      await new PostgresWorldRepository(db).initialize(
        { userId: owner },
        {
          schemaVersion: 1,
          id,
          ownerId: owner,
          version: 0,
          title: '相册合成测试',
          time: '2026-09-22T00:00:00.000Z',
          actors: [],
          facts: [],
          messages: [],
          appointments: [],
          mediaRequests: [],
        },
      );
    const bytes = await sharp({
      create: { width: 300, height: 400, channels: 3, background: '#779955' },
    })
      .jpeg()
      .withExif({ IFD0: { Artist: 'SYNTHETIC' } })
      .toBuffer();
    const duplicated = await Promise.all([
      repo.uploadToAlbum(owner, world, bytes, input),
      repo.uploadToAlbum(owner, world, bytes, input),
    ]);
    const saved = duplicated[0]!;
    assert.deepEqual(duplicated[1], saved);
    assert.equal(saved.kind, 'upload');
    assert.equal(saved.date, '2026-09-22T00:00:00.000Z');
    assert.deepEqual(await list(owner), [saved]);
    assert.deepEqual(await list(owner, secondWorld), []);
    assert.deepEqual(await list(other), []);
    assert.equal((await readdir(dir)).length, 1);
    assert.equal((await new PostgresWorldRepository(db).get({ userId: owner }, world)).version, 0);
    await assert.rejects(
      repo.uploadToAlbum(other, world, bytes, { ...input, commandId: randomUUID() }),
      { code: 'NOT_FOUND' },
    );
    await assert.rejects(repo.read(other, saved.id), { code: 'NOT_FOUND' });
    await assert.rejects(repo.uploadToAlbum(owner, world, bytes, { ...input, title: '变更' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await assert.rejects(
      repo.uploadToAlbum(owner, world, Buffer.from('not an image'), {
        ...input,
        commandId: randomUUID(),
      }),
      { code: 'INVALID_INPUT' },
    );
    const profileImage = await repo.upload(owner, bytes);
    assert.deepEqual(await list(owner), [saved]); // No automatic profile-to-world disclosure.
    // Fail after asset insertion: both SQL rows and the newly written file must be removed.
    await admin.query(
      "ALTER TABLE parallel_life.world_album ADD CONSTRAINT album_test_failure CHECK (title <> 'ROLLBACK')",
    );
    try {
      await assert.rejects(
        repo.uploadToAlbum(owner, world, bytes, { commandId: randomUUID(), title: 'ROLLBACK' }),
        { code: '23514' },
      );
      assert.equal((await readdir(dir)).length, 2);
      assert.equal(
        (await admin.query('SELECT 1 FROM parallel_life.assets WHERE owner_id=$1', [owner]))
          .rowCount,
        2,
      );
    } finally {
      await admin.query('ALTER TABLE parallel_life.world_album DROP CONSTRAINT album_test_failure');
    }
    await db.close();
    db = new PostgresDatabase(url);
    repo = new AssetRepository(db, new PrivateDiskStore(dir));
    assert.deepEqual(await list(owner), [saved]);
    const metadata = await sharp(await repo.read(owner, saved.id)).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
    class LostAcknowledgement extends PostgresDatabase {
      calls = 0;
      override async transaction<T>(
        ownerId: string,
        run: (sql: SqlClient) => Promise<T>,
      ): Promise<T> {
        const result = await super.transaction(ownerId, run);
        if (++this.calls === 2) throw new Error('SIMULATED_LOST_COMMIT_ACK');
        return result;
      }
    }
    const ambiguousDb = new LostAcknowledgement(url);
    try {
      const ambiguousRepo = new AssetRepository(ambiguousDb, new PrivateDiskStore(dir));
      const ambiguousInput = { commandId: randomUUID(), title: 'Response lost' };
      await assert.rejects(
        ambiguousRepo.uploadToAlbum(owner, world, bytes, ambiguousInput),
        /SIMULATED_LOST_COMMIT_ACK/,
      );
      const recovered = await ambiguousRepo.uploadToAlbum(owner, world, bytes, ambiguousInput);
      assert.ok((await ambiguousRepo.read(owner, recovered.id)).length > 0);
      assert.equal((await list(owner)).filter((p) => p.id === recovered.id).length, 1);
      await repo.remove(owner, recovered.id);
    } finally {
      await ambiguousDb.close();
    }
    await repo.remove(owner, saved.id);
    assert.deepEqual(await list(owner), []);
    await assert.rejects(repo.read(owner, saved.id), { code: 'NOT_FOUND' });
    await repo.remove(owner, profileImage.id);
    assert.equal((await readdir(dir)).length, 0);
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await admin.end();
    await rm(dir, { recursive: true });
  }
});
