import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { profilePhotoRoles } from '../../src/modules/discovery/infrastructure/profile-photo-roles.ts';
test('real PG photo roles retain shared access while excluding current and sourced person images from protagonist references', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    owner = randomUUID(),
    other = randomUUID();
  try {
    const identity = new IdentityRepository(db);
    await identity.ensureGuest(owner);
    await identity.ensureGuest(other);
    const portrait = randomUUID(),
      friend = randomUUID(),
      oldFriend = randomUUID(),
      foreign = randomUUID();
    for (const [id, who] of [
      [portrait, owner],
      [friend, owner],
      [oldFriend, owner],
      [foreign, other],
    ])
      await admin.query(
        "INSERT INTO parallel_life.assets(id,owner_id,storage_key,mime_type,byte_length,width,height,origin,status) VALUES($1,$2,$3,'image/jpeg',10,10,10,'upload','ready')",
        [id, who, 'fixture-' + id],
      );
    const profiles = new ProfileRepository(db);
    let p = await profiles.get(owner);
    for (const assetId of [portrait, friend, oldFriend])
      p = await profiles.edit(owner, {
        expectedVersion: p.version,
        operation: { kind: 'add-reference-photo', assetId },
      });
    p = await profiles.edit(owner, {
      expectedVersion: p.version,
      operation: { kind: 'set-portrait', assetId: portrait },
    });
    const interview = (
        await admin.query('SELECT id FROM parallel_life.interviews WHERE owner_id=$1', [owner])
      ).rows[0].id,
      messageId = randomUUID();
    await admin.query(
      "INSERT INTO parallel_life.interview_messages(id,owner_id,interview_id,role,text,photo_asset_id) VALUES($1,$2,$3,'user','合成：这张是我朋友此前分享的照片',$4)",
      [messageId, owner, interview, oldFriend],
    );
    p = {
      ...p,
      people: [
        {
          id: randomUUID(),
          name: '合成朋友',
          relationship: '照片人物',
          assetId: friend,
          origin: 'interview',
          sourceMessageIds: [messageId],
          sourceQuotes: [
            { interviewId: interview, messageId, quote: '合成：这张是我朋友此前分享的照片' },
          ],
        },
      ],
    };
    await admin.query('UPDATE parallel_life.profiles SET document=$2 WHERE owner_id=$1', [
      owner,
      p,
    ]);
    const roles = await db.transaction(owner, (sql) => profilePhotoRoles(sql, owner, p));
    assert.equal(roles.portraitAssetId, portrait);
    assert.deepEqual(roles.referenceAssetIds, [portrait]);
    assert.deepEqual(new Set(roles.sharedAssetIds), new Set([portrait, friend, oldFriend]));
    assert.equal(roles.personAssets[0]?.assetId, friend);
    assert.ok(!roles.sharedAssetIds.includes(foreign));
    assert.deepEqual(
      (await profiles.get(owner)).referenceAssetIds,
      p.referenceAssetIds,
      'purpose classification never deletes shared access registration',
    );
    const automaticLegacy = { ...p, portraitAssetId: friend };
    const blocked = await db.transaction(owner, (sql) =>
      profilePhotoRoles(sql, owner, automaticLegacy),
    );
    assert.equal(
      blocked.portraitAssetId,
      null,
      'a person photo cannot be silently reused as the player portrait',
    );
    await admin.query("UPDATE parallel_life.assets SET status='deleted' WHERE id=$1", [oldFriend]);
    const removed = await db.transaction(owner, (sql) => profilePhotoRoles(sql, owner, p));
    assert.ok(!removed.sharedAssetIds.includes(oldFriend));
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await admin.end();
  }
});
