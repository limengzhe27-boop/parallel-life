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
import { InterviewRepository } from '../../src/modules/profile/infrastructure/interview-repository.ts';

test('interview photos require an owned profile asset and survive retries as explicit references', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const directory = await mkdtemp(path.join(tmpdir(), 'pl-interview-photo-'));
  const assets = new AssetRepository(db, new PrivateDiskStore(directory));
  const profiles = new ProfileRepository(db);
  const interview = new InterviewRepository(db);
  const owner = randomUUID();
  const other = randomUUID();
  try {
    const identity = new IdentityRepository(db);
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#6688aa' },
    })
      .png()
      .toBuffer();
    const photo = await assets.upload(owner, bytes);
    const command = {
      commandId: randomUUID(),
      expectedVersion: 0,
      text: '这张照片是在海边拍的。',
      photoAssetId: photo.id,
    };
    await assert.rejects(interview.send(owner, command), { code: 'INVALID_INPUT' });
    await assert.rejects(interview.send(other, { ...command, commandId: randomUUID() }), {
      code: 'INVALID_INPUT',
    });
    await profiles.edit(owner, {
      expectedVersion: 0,
      operation: { kind: 'add-reference-photo', assetId: photo.id },
    });
    const sent = await interview.send(owner, command);
    assert.equal(sent.interview.messages[0]?.text, command.text);
    assert.equal(sent.interview.messages[0]?.photoAssetId, photo.id);
    assert.equal((await interview.send(owner, command)).task.id, sent.task.id);
    await assert.rejects(interview.send(owner, { ...command, photoAssetId: randomUUID() }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await profiles.edit(owner, {
      expectedVersion: 1,
      operation: { kind: 'delete-reference-photo', assetId: photo.id },
    });
    await assert.rejects(assets.discardUnreferencedUpload(owner, photo.id), { code: 'CONFLICT' });
    await assert.rejects(
      db.transaction(owner, (sql) =>
        sql.query(
          "INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text,photo_asset_id) VALUES($1,$2,$3,'user','绕过应用层',$4)",
          [randomUUID(), owner, sent.interview.id, photo.id],
        ),
      ),
      { code: '23514' },
    );
    await assert.rejects(
      db.transaction(owner, (sql) =>
        sql.query(
          "INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text,photo_asset_id) VALUES($1,$2,$3,'assistant','伪造图片',$4)",
          [randomUUID(), owner, sent.interview.id, photo.id],
        ),
      ),
      { code: '23514' },
    );
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await admin.end();
    await rm(directory, { recursive: true });
  }
});
