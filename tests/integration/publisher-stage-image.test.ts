import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PublicationRepository } from '../../src/modules/settings/infrastructure/publication-repository.ts';
import { PublicationMediaRepository } from '../../src/modules/settings/infrastructure/publication-media-repository.ts';
import { PublisherPreparationRepository } from '../../src/modules/settings/infrastructure/publisher-preparation-repository.ts';
import { PublisherStageImageRepository } from '../../src/modules/settings/infrastructure/publisher-stage-image-repository.ts';
import { LocalFirstPublicationMediaStore } from '../../src/modules/media/infrastructure/local-first-publication-media-store.ts';
import {
  makePublisherStageImage,
  recoverPublisherStageImage,
  type StageImageExecution,
} from '../../src/modules/settings/application/publisher-stage-image.ts';
test('author image admission, real private storage, immutable results and replay do not rebuy or alter drafts', async (t) => {
  const cfg = await localConfig(),
    admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const role = 'pl_stage_gen_fixture';
  if (!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount)
    await admin.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${cfg.appPassword}' NOSUPERUSER NOBYPASSRLS`,
    );
  await admin.query(`GRANT pl_publisher TO ${role}`);
  const db = new PostgresDatabase(
    `postgresql://${role}:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  const dir = await mkdtemp(path.join(tmpdir(), 'stage-gen-'));
  t.after(async () => {
    await db.close();
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  });
  const staff = randomUUID(),
    other = randomUUID();
  for (const id of [staff, other])
    await admin.query(
      'INSERT INTO parallel_life.publisher_principals(id,display_name,can_edit,can_publish,active) VALUES($1,$2,true,true,true)',
      [id, '合成人物制作验收'],
    );
  const works = new PublicationRepository(db),
    disk = new LocalFirstPublicationMediaStore(dir),
    assets = new PublicationMediaRepository(db, disk),
    store = new PublisherStageImageRepository(db);
  const content = {
    actors: [{ key: 'person', publicCard: {}, privatePersona: { background: '不改人物' } }],
  };
  const work = await works.create(staff, {
    commandId: randomUUID(),
    title: '独立形象制作样例',
    content,
  });
  const bytes = await sharp({
    create: {
      width: 64,
      height: 96,
      channels: 4,
      background: { r: 80, g: 100, b: 120, alpha: 0.8 },
    },
  })
    .png()
    .toBuffer();
  async function upload(id = randomUUID()) {
    const row = await assets.beginGenerated(staff, work.id, id, bytes.length, 'image/png');
    await disk.put(row.storageKey, bytes);
    await assets.finalize(staff, work.id, id);
    return id;
  }
  const source = await upload();
  let calls = 0;
  const execution: StageImageExecution = {
    async recover(m) {
      const b = await disk.readStored(m.storageKey);
      if (!b) return null;
      await assets.beginGenerated(staff, work.id, m.outputAssetId, b.length);
      await assets.finalize(staff, work.id, m.outputAssetId);
      return {
        assetId: m.outputAssetId,
        kind: 'image',
        mimeType: 'image/png',
        byteLength: b.length,
      };
    },
    async produce(m) {
      calls++;
      await disk.put(m.storageKey, bytes);
      await assets.beginGenerated(staff, work.id, m.outputAssetId, bytes.length);
      await assets.finalize(staff, work.id, m.outputAssetId);
      return {
        assetId: m.outputAssetId,
        kind: 'image',
        mimeType: 'image/png',
        byteLength: bytes.length,
      };
    },
  };
  const input = {
    commandId: randomUUID(),
    expectedDraftVersion: 0,
    actorKey: 'person',
    sourceAssetId: source,
  };
  const first = await makePublisherStageImage(store, execution, staff, work.id, input);
  assert.equal(first.status, 'succeeded');
  assert.ok(first.image);
  assert.equal(calls, 1);
  assert.deepEqual(await makePublisherStageImage(store, execution, staff, work.id, input), first);
  assert.equal(calls, 1);
  assert.deepEqual((await works.get(staff, work.id)).draft.content, content);
  assert.equal(await new PublisherPreparationRepository(db).read(staff, work.id), null);
  await assert.rejects(store.begin(staff, work.id, { ...input, actorKey: 'other' }), {
    code: 'IDEMPOTENCY_CONFLICT',
  });
  await assert.rejects(
    store.read(other, work.id, input.commandId).then((r) => {
      if (!r) throw Object.assign(new Error(), { code: 'NOT_FOUND' });
    }),
    { code: 'NOT_FOUND' },
  );
  const pending = { ...input, commandId: randomUUID() };
  const admission = await store.begin(staff, work.id, pending);
  await store.finish(staff, work.id, pending.commandId, 'unknown', null, 'TIMEOUT');
  await disk.put(admission.material.storageKey, bytes);
  const recovered = await recoverPublisherStageImage(
    store,
    execution,
    staff,
    work.id,
    pending.commandId,
  );
  assert.equal(recovered.status, 'unknown');
  assert.ok(recovered.image);
  assert.equal(calls, 1);
  const again = await recoverPublisherStageImage(
    store,
    execution,
    staff,
    work.id,
    pending.commandId,
  );
  assert.deepEqual(again, recovered);
  assert.equal(calls, 1);
  const bad = { ...input, commandId: randomUUID() };
  const b = await store.begin(staff, work.id, bad);
  await assert.rejects(
    store.finish(
      staff,
      work.id,
      bad.commandId,
      'succeeded',
      { assetId: b.material.outputAssetId, kind: 'image', mimeType: 'image/png', byteLength: 123 },
      null,
    ),
    { code: 'INVALID_STATE' },
  );
  await store.finish(staff, work.id, bad.commandId, 'failed', null, 'INVALID_RESPONSE');
  assert.equal((await store.read(staff, work.id, bad.commandId))?.record.status, 'failed');
  const newInput = { ...input, commandId: randomUUID(), sourceAssetId: randomUUID() };
  await assert.rejects(store.begin(staff, work.id, newInput), { code: 'NOT_FOUND' });
});
