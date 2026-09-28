import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import { applyBasicInfoInTransaction } from '../../src/modules/profile/infrastructure/profile-repository.ts';
import {
  collectBasicInfo,
  projectProfileView,
  usableProfileFact,
} from '../../src/modules/profile/domain/profile-view.ts';
test('profile manual changes require current version, preserve self-ratings and reject foreign assets', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    repo = new ProfileRepository(db),
    id = randomUUID();
  try {
    await new IdentityRepository(db).ensureGuest(id);
    const profile = await repo.edit(id, {
      expectedVersion: 0,
      operation: { kind: 'set-fact', category: 'wish', value: '开店' },
    });
    assert.equal(profile.facts[0]?.status, 'confirmed');
    const command = {
      expectedVersion: 1,
      operation: {
        kind: 'set-fact' as const,
        id: profile.facts[0]!.id,
        category: 'wish' as const,
        value: '先从工作室开始',
      },
    };
    const raced = await Promise.allSettled([repo.edit(id, command), repo.edit(id, command)]);
    assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1);
    const event = { id: randomUUID(), title: '毕业', date: '2022', feeling: 0 };
    const saved = await repo.edit(id, {
      expectedVersion: 2,
      operation: { kind: 'set-event', event },
    });
    assert.equal(saved.events[0]?.feeling, 0);
    await assert.rejects(
      repo.edit(id, {
        expectedVersion: 3,
        operation: { kind: 'set-portrait', assetId: randomUUID() },
      }),
      { code: 'NOT_FOUND' },
    );
    assert.equal((await repo.get(id)).version, 3);
    const removed = await repo.edit(id, {
      expectedVersion: 3,
      operation: { kind: 'delete-fact', id: profile.facts[0]!.id },
    });
    assert.equal(removed.facts[0]?.status, 'rejected');
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [id]);
    await admin.end();
  }
});

test('legacy birthday conflict stays pending until explicit correction; precision is preserved', async () => {
  const admin = await adminClient('parallel_life_test');
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const repo = new ProfileRepository(db);
  const owner = randomUUID();
  try {
    await new IdentityRepository(db).ensureGuest(owner);
    const year = await db.transaction(owner, (sql) =>
      applyBasicInfoInTransaction(sql, owner, { birthdate: '2005' }),
    );
    assert.equal(collectBasicInfo(year.profile).values['生日'], '2005');
    const full = await db.transaction(owner, (sql) =>
      applyBasicInfoInTransaction(sql, owner, { birthdate: '2005-04-12' }),
    );
    assert.equal(collectBasicInfo(full.profile).values['生日'], '2005-04-12');
    const ignoredYear = await db.transaction(owner, (sql) =>
      applyBasicInfoInTransaction(sql, owner, { birthdate: '2005' }),
    );
    assert.equal(collectBasicInfo(ignoredYear.profile).values['生日'], '2005-04-12');
    const legacy = {
      id: randomUUID(),
      category: 'identity',
      value: '生日：2000-01-01',
      status: 'confirmed',
      sourceMessageIds: [],
      updatedAt: new Date().toISOString(),
    };
    const document = structuredClone(await repo.get(owner));
    document.facts.push(legacy as (typeof document.facts)[number]);
    await admin.query('UPDATE parallel_life.profiles SET document=$2 WHERE owner_id=$1', [
      owner,
      document,
    ]);
    const conflicted = await repo.get(owner);
    assert.equal(collectBasicInfo(conflicted).birthdayConflict, true);
    assert.equal(
      projectProfileView(conflicted).current.some((item) => item.ref.basicField === '生日'),
      false,
    );
    assert.equal(usableProfileFact(conflicted, conflicted.facts[0]!), null);
    const modelClaim = await db.transaction(owner, (sql) =>
      applyBasicInfoInTransaction(sql, owner, { birthdate: '2002-01-01' }),
    );
    assert.equal(modelClaim.disputedBirthdate, '2002-01-01');
    assert.equal(modelClaim.profile.version, conflicted.version);
    const corrected = await repo.edit(owner, {
      expectedVersion: conflicted.version,
      operation: {
        kind: 'set-fact',
        id: conflicted.facts[0]!.id,
        category: 'identity',
        value: '个人资料\n生日：2005-04-12',
      },
    });
    assert.equal(corrected.facts.find((fact) => fact.id === legacy.id)?.status, 'rejected');
    assert.equal(collectBasicInfo(corrected).birthdayConflict, false);
    assert.equal(projectProfileView(corrected).current[0]?.text, '2005-04-12');
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
