import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import { OFFICIAL_LIFE_PACKS } from '../../src/modules/settings/infrastructure/official-presets/index.ts';
import {
  PublicationMediaRepository,
  type PublicationMediaStore,
} from '../../src/modules/settings/infrastructure/publication-media-repository.ts';
import { readPublicationSceneImages } from '../../src/modules/settings/infrastructure/publication-scene-image-repository.ts';

const store: PublicationMediaStore = {
  async signUpload() {
    throw Error('unused');
  },
  async inspect() {
    throw Error('unused');
  },
  async signRead(key) {
    return `https://private.example/${key}`;
  },
};
const catalog = {
  list: () => OFFICIAL_LIFE_PACKS,
  get: (id: string) => OFFICIAL_LIFE_PACKS.find((pack) => pack.card.id === id),
};

test('scene images follow pinned publication, ready same-work image and actual visible map', async (t) => {
  const config = await localConfig();
  const expectedPort = process.env.PUBLICATION_SCENE_TEST_PORT ?? '55568';
  assert.equal(config.port, Number(expectedPort));
  const admin = await adminClient('parallel_life_test');
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  t.after(async () => {
    await app.close();
    await admin.end();
  });
  await migrate(admin);
  const staff = randomUUID();
  const owner = randomUUID();
  const stranger = randomUUID();
  const work = randomUUID();
  const otherWork = randomUUID();
  const scene = randomUUID();
  const unrelated = randomUUID();
  const pending = randomUUID();
  const foreign = randomUUID();
  const video = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, '场景图隔离夹具'],
  );
  await admin.query('BEGIN');
  try {
    for (const id of [work, otherWork]) {
      await admin.query(
        'INSERT INTO parallel_life.publication_works(id,title,created_by) VALUES($1,$2,$3)',
        [id, '场景图作品', staff],
      );
      await admin.query(
        'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,0,$2,$3,$4)',
        [id, { places: [], phone: {} }, '0'.repeat(64), staff],
      );
    }
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
  for (const [id, workId, kind, mime, status] of [
    [scene, work, 'image', 'image/png', 'ready'],
    [unrelated, work, 'image', 'image/png', 'ready'],
    [pending, work, 'image', 'image/png', 'pending'],
    [foreign, otherWork, 'image', 'image/png', 'ready'],
    [video, work, 'video', 'video/mp4', 'ready'],
  ]) {
    await admin.query(
      `INSERT INTO parallel_life.publication_media_assets
       (id,work_id,created_by,storage_key,kind,mime_type,declared_bytes,status,byte_length,confirmed_at)
       VALUES($1,$2,$3,$4,$5,$6,64,$7,$8,$9)`,
      [
        id,
        workId,
        staff,
        `works/${workId}/${id}.${kind === 'video' ? 'mp4' : 'png'}`,
        kind,
        mime,
        status,
        status === 'ready' ? 64 : null,
        status === 'ready' ? new Date() : null,
      ],
    );
  }
  const original = { places: [{ key: 'home', sceneImage: { assetId: scene } }], phone: {} };
  const contentHash = 'a'.repeat(64);
  await admin.query(
    'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,1,$2,$3,$4)',
    [work, original, contentHash, staff],
  );
  await new IdentityRepository(app).ensureGuest(owner);
  await new IdentityRepository(app).ensureGuest(stranger);
  const official = OFFICIAL_LIFE_PACKS[0]!;
  const life = new OfficialLifeRepository(app, catalog);
  const first = await life.start(owner, official.card.id, {
    commandId: randomUUID(),
    version: official.card.version,
  });
  await admin.query(
    `INSERT INTO parallel_life.publication_world_bindings
      (id,kind,requester,owner_id,principal_id,work_id,publication_version,draft_version,content_hash,seed_id,world_id)
      VALUES($1,'trial',$2,$3,$4,$5,NULL,1,$6,$7,$8)`,
    [randomUUID(), staff, owner, staff, work, contentHash, first.seedId, first.worldId],
  );
  const read = (who: string, asset: string) =>
    new PublicationMediaRepository(app, store).playerAsset(who, first.worldId, asset);
  await assert.rejects(read(owner, scene), { code: 'NOT_FOUND' });
  await admin.query(
    `UPDATE parallel_life.worlds SET state=jsonb_set(state,'{space}', $2::jsonb)
     WHERE id=$1`,
    [first.worldId, JSON.stringify({ places: [{ id: 'home' }] })],
  );
  assert.equal((await read(owner, scene)).mime_type, 'image/png');
  const visible = await app.transaction(owner, (sql) =>
    readPublicationSceneImages(sql, first.worldId, ['home']),
  );
  assert.equal(visible.get('home'), `/api/v1/worlds/${first.worldId}/media/${scene}`);
  assert.equal(
    (
      await app.transaction(owner, (sql) =>
        readPublicationSceneImages(sql, first.worldId, ['some_other_place']),
      )
    ).size,
    0,
  );
  await assert.rejects(read(stranger, scene), { code: 'NOT_FOUND' });
  await assert.rejects(read(owner, unrelated), { code: 'NOT_FOUND' });
  await assert.rejects(read(owner, foreign), { code: 'NOT_FOUND' });
  const bad = (assetId: string) => ({
    places: [{ key: 'home', sceneImage: { assetId } }],
    phone: {},
  });
  for (const id of [pending, foreign, video]) {
    await assert.rejects(
      admin.query('SELECT parallel_life.publication_scene_assert_content($1,$2)', [work, bad(id)]),
      (error: unknown) => (error as { code?: string }).code === '23514',
    );
  }
  await admin.query(
    'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,2,$2,$3,$4)',
    [work, bad(pending), 'b'.repeat(64), staff],
  );
  const next = await life.start(stranger, official.card.id, {
    commandId: randomUUID(),
    version: official.card.version,
  });
  await assert.rejects(
    admin.query(
      `INSERT INTO parallel_life.publication_world_bindings
       (id,kind,requester,owner_id,principal_id,work_id,publication_version,draft_version,content_hash,seed_id,world_id)
       VALUES($1,'trial',$2,$3,$4,$5,NULL,2,$6,$7,$8)`,
      [randomUUID(), staff, stranger, staff, work, 'b'.repeat(64), next.seedId, next.worldId],
    ),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
});
