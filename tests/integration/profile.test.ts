import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { ProfileRepository } from '../../src/modules/profile/infrastructure/profile-repository.ts';
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
