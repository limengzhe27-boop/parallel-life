import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import {
  PublicationMediaRepository,
  type PublicationMediaStore,
} from '../../src/modules/settings/infrastructure/publication-media-repository.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { OfficialLifeRepository } from '../../src/modules/settings/infrastructure/official-life-repository.ts';
import { OFFICIAL_LIFE_PACKS } from '../../src/modules/settings/infrastructure/official-presets/index.ts';

const bytes = Buffer.alloc(24);
bytes.writeUInt32BE(24, 0);
bytes.write('ftypisom', 4, 'ascii');
const store: PublicationMediaStore = {
  async signUpload() {
    return { uploadUrl: 'https://storage.example/upload?token=fixture', uploadToken: 'fixture' };
  },
  async inspect() {
    return { byteLength: bytes.length, mimeType: 'video/mp4', header: bytes };
  },
  async signRead() {
    return 'https://storage.example/read?token=fixture';
  },
};

test('real PostgreSQL author media: finalize and world-bound exact reference authorization', async (t) => {
  const config = await localConfig();
  const portText = process.env.PUBLICATION_MEDIA_TEST_PORT ?? '55561';
  assert.match(portText, /^[1-9][0-9]{0,4}$/);
  assert.equal(config.port, Number(portText));
  const admin = await adminClient('parallel_life_test');
  const resources: PostgresDatabase[] = [];
  t.after(async () => {
    for (const db of resources) await db.close();
    await admin.end();
  });
  await migrate(admin);
  const role = 'pl_publication_media_fixture';
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
  }
  await admin.query(`GRANT pl_publisher TO ${role}`);
  const pub = new PostgresDatabase(
    `postgresql://${role}:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const app = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  resources.push(pub, app);
  const staff = randomUUID();
  const owner = randomUUID();
  const outsider = randomUUID();
  await admin.query(
    'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
    [staff, '独立媒体夹具'],
  );
  const source = await readFile(
    new URL('../../docs/task-reports/WORLD-PUBLISH-01A-CONTENT.md', import.meta.url),
    'utf8',
  );
  const content = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(source)![1]!);
  const work = await new PublicationRepository(pub).create(staff, {
    commandId: randomUUID(),
    title: '本地历史视频夹具',
    content,
  });
  const repository = new PublicationMediaRepository(pub, store);
  const playerMedia = new PublicationMediaRepository(app, store);
  const pending = await repository.begin(staff, work.id, {
    mimeType: 'video/mp4',
    byteLength: bytes.length,
  });
  assert.equal(pending.kind, 'video');
  await assert.rejects(repository.publisherAsset(staff, work.id, pending.assetId), {
    code: 'NOT_FOUND',
  });
  const ready = await repository.finalize(staff, work.id, pending.assetId);
  assert.equal(ready.byteLength, bytes.length);
  assert.deepEqual(await repository.finalize(staff, work.id, pending.assetId), ready);
  assert.equal(
    (await repository.publisherAsset(staff, work.id, pending.assetId)).mime_type,
    'video/mp4',
  );
  const unreferenced = await repository.begin(staff, work.id, {
    mimeType: 'video/mp4',
    byteLength: bytes.length,
  });
  await repository.finalize(staff, work.id, unreferenced.assetId);
  const invalid = await repository.begin(staff, work.id, {
    mimeType: 'video/mp4',
    byteLength: bytes.length,
  });
  const attached = structuredClone(content);
  attached.phone.messages = [
    {
      key: 'authored_video',
      actorKey: attached.actors[0].key,
      origin: 'history',
      speaker: 'actor',
      text: '',
      at: '2026-10-11T09:00:00Z',
      attachment: { kind: 'video', assetId: pending.assetId },
    },
  ];
  const hash = 'a'.repeat(64);
  await pub.transaction(staff, async (sql) => {
    await sql.query("SELECT set_config('publisher.principal_id',$1,true)", [staff]);
    await sql.query(
      'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,1,$2,$3,$4)',
      [work.id, attached, hash, staff],
    );
    await sql.query('UPDATE parallel_life.publication_works SET draft_version=1 WHERE id=$1', [
      work.id,
    ]);
  });
  await new IdentityRepository(app).ensureGuest(owner);
  await new IdentityRepository(app).ensureGuest(outsider);
  const official = OFFICIAL_LIFE_PACKS[0]!;
  const existing = await new OfficialLifeRepository(app, {
    list: () => OFFICIAL_LIFE_PACKS,
    get: (id: string) => OFFICIAL_LIFE_PACKS.find((pack) => pack.card.id === id),
  }).start(owner, official.card.id, {
    commandId: randomUUID(),
    version: official.card.version,
  });
  const bindingId = randomUUID();
  await admin.query(
    "INSERT INTO parallel_life.publication_world_bindings(id,kind,requester,owner_id,principal_id,work_id,publication_version,draft_version,content_hash,seed_id,world_id) VALUES($1,'trial',$2,$3,$4,$5,NULL,1,$6,$7,$8)",
    [bindingId, staff, owner, staff, work.id, hash, existing.seedId, existing.worldId],
  );
  assert.equal(
    (await playerMedia.playerAsset(owner, existing.worldId, pending.assetId)).mime_type,
    'video/mp4',
  );
  await assert.rejects(playerMedia.playerAsset(outsider, existing.worldId, pending.assetId), {
    code: 'NOT_FOUND',
  });
  await assert.rejects(playerMedia.playerAsset(owner, existing.worldId, unreferenced.assetId), {
    code: 'NOT_FOUND',
  });
  await assert.rejects(playerMedia.playerAsset(owner, existing.worldId, invalid.assetId), {
    code: 'NOT_FOUND',
  });
  await assert.rejects(
    app.transaction(owner, (sql) =>
      sql.query('SELECT * FROM parallel_life.publication_media_assets'),
    ),
    (error: unknown) => (error as { code?: string }).code === '42501',
  );
  const bad = structuredClone(attached);
  bad.phone.messages[0].attachment.assetId = invalid.assetId;
  await assert.rejects(
    admin.query('SELECT parallel_life.publication_media_assert_content($1,$2::jsonb)', [
      work.id,
      JSON.stringify(bad),
    ]),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  bad.phone.messages[0].attachment = { kind: 'image', assetId: pending.assetId };
  await assert.rejects(
    admin.query('SELECT parallel_life.publication_media_assert_content($1,$2::jsonb)', [
      work.id,
      JSON.stringify(bad),
    ]),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
  const pendingContent = structuredClone(attached);
  pendingContent.phone.messages[0].attachment.assetId = invalid.assetId;
  await admin.query(
    'INSERT INTO parallel_life.publication_draft_revisions(work_id,version,content,content_hash,created_by) VALUES($1,2,$2,$3,$4)',
    [work.id, pendingContent, 'b'.repeat(64), staff],
  );
  const otherWorld = await new OfficialLifeRepository(app, {
    list: () => OFFICIAL_LIFE_PACKS,
    get: (id: string) => OFFICIAL_LIFE_PACKS.find((pack) => pack.card.id === id),
  }).start(outsider, official.card.id, {
    commandId: randomUUID(),
    version: official.card.version,
  });
  await assert.rejects(
    admin.query(
      "INSERT INTO parallel_life.publication_world_bindings(id,kind,requester,owner_id,principal_id,work_id,publication_version,draft_version,content_hash,seed_id,world_id) VALUES($1,'trial',$2,$3,$4,$5,NULL,2,$6,$7,$8)",
      [
        randomUUID(),
        staff,
        outsider,
        staff,
        work.id,
        'b'.repeat(64),
        otherWorld.seedId,
        otherWorld.worldId,
      ],
    ),
    (error: unknown) => (error as { code?: string }).code === '23514',
  );
});
