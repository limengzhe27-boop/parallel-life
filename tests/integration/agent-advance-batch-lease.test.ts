import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { IdentityRepository } from '../../src/modules/identity/infrastructure/identity-repository.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { switchAgentEngineEpochInTransaction } from '../../src/modules/world/infrastructure/agent-runtime-repository.ts';
import {
  claimAgentAdvanceBatch,
  releaseAgentAdvanceBatch,
} from '../../src/modules/world/infrastructure/agent-advance-batch-lease.ts';
test('original runtime batch lease serializes callers without holding a model transaction; stale release and owner isolation', async (t) => {
  const cfg = await localConfig();
  assert.equal(cfg.port, Number(process.env.AGENT_BATCH_LEASE_TEST_PORT ?? 55587));
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const db = new PostgresDatabase(
    `postgresql://pl_app:${cfg.appPassword}@127.0.0.1:${cfg.port}/parallel_life_test`,
  );
  t.after(async () => {
    await db.close();
    await admin.end();
  });
  const owner = randomUUID(),
    other = randomUUID(),
    id = randomUUID();
  const identity = new IdentityRepository(db);
  await identity.ensureGuest(owner);
  await identity.ensureGuest(other);
  const worlds = new PostgresWorldRepository(db);
  await worlds.initialize(
    { userId: owner },
    {
      schemaVersion: 1,
      id,
      ownerId: owner,
      version: 0,
      title: '合成调度租约',
      time: '2026-10-19T00:00:00Z',
      actors: [],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    },
  );
  assert.equal((await claimAgentAdvanceBatch(db, owner, id)).status, 'legacy');
  await db.transaction(owner, (sql) =>
    switchAgentEngineEpochInTransaction(sql, owner, {
      worldId: id,
      expectedWorldVersion: 0,
      expectedEpoch: 1,
      nextEpoch: 2,
    }),
  );
  const [a, b] = await Promise.all([
    claimAgentAdvanceBatch(db, owner, id),
    claimAgentAdvanceBatch(db, owner, id),
  ]);
  assert.deepEqual([a.status, b.status].sort(), ['busy', 'claimed']);
  const won = a.status === 'claimed' ? a : b;
  assert.equal(won.status, 'claimed');
  if (won.status !== 'claimed') throw Error('NO_LEASE');
  assert.equal(
    db.pool.totalCount,
    db.pool.idleCount,
    'no app connection held over model computation',
  );
  await assert.rejects(claimAgentAdvanceBatch(db, other, id), { code: 'NOT_FOUND' });
  assert.equal(
    (
      await db.transaction(other, (sql) =>
        sql.query('SELECT * FROM parallel_life.agent_advance_batch_leases WHERE world_id=$1', [id]),
      )
    ).rowCount,
    0,
  );
  await releaseAgentAdvanceBatch(db, owner, id, randomUUID());
  assert.equal((await claimAgentAdvanceBatch(db, owner, id)).status, 'busy');
  await admin.query(
    "UPDATE parallel_life.agent_advance_batch_leases SET lease_until=clock_timestamp()-interval '1 second' WHERE world_id=$1",
    [id],
  );
  const next = await claimAgentAdvanceBatch(db, owner, id);
  assert.equal(next.status, 'claimed');
  if (next.status !== 'claimed') throw Error('NO_RECLAIM');
  assert.notEqual(next.token, won.token);
  await releaseAgentAdvanceBatch(db, owner, id, won.token);
  assert.equal(
    (await claimAgentAdvanceBatch(db, owner, id)).status,
    'busy',
    'late old release cannot unlock successor',
  );
  await releaseAgentAdvanceBatch(db, owner, id, next.token);
  assert.equal(
    (
      await admin.query(
        'SELECT * FROM parallel_life.agent_advance_batch_leases WHERE world_id=$1',
        [id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await worlds.get({ userId: owner }, id)).version,
    0,
    'runtime leasing creates no story/message/progress',
  );
});
