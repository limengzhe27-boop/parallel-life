import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { checkMessageReceipt } from '../../src/modules/world/application/check-message-receipt.ts';
import type { WorldState, TurnCommand, WorldEvent } from '../../src/modules/world/domain/types.ts';

test('read-only message lookup restores original receipts and preserves PostgreSQL authorization/fingerprints', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    repo = new PostgresWorldRepository(db);
  const owner = randomUUID(),
    other = randomUUID(),
    worldId = randomUUID(),
    world2 = randomUUID(),
    actorId = randomUUID(),
    at = new Date().toISOString();
  const session = { userId: owner };
  const state = (id: string): WorldState => ({
    schemaVersion: 1,
    id,
    ownerId: owner,
    version: 0,
    title: 'Receipt synthetic test',
    time: at,
    actors: [{ id: actorId, name: 'Synthetic friend', persona: 'Independent' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  });
  const command: TurnCommand = {
    id: randomUUID(),
    worldId,
    actorId,
    text: 'Original request',
    expectedVersion: 0,
  };
  const event = (cmd: TurnCommand): WorldEvent => ({
    schemaVersion: 1,
    id: randomUUID(),
    worldId: cmd.worldId,
    version: cmd.expectedVersion + 1,
    commandId: cmd.id,
    type: 'turn.resolved',
    occurredAt: at,
    data: {
      actorId,
      userText: cmd.text,
      effects: [
        {
          type: 'message.received',
          id: randomUUID(),
          actorId,
          text: 'Explicit test reply, no model',
        },
      ],
    },
  });
  const lookup = (cmd: TurnCommand, s = session) => checkMessageReceipt({ worlds: repo }, s, cmd);
  async function snapshot() {
    const values: Record<string, unknown> = {};
    for (const table of [
      'worlds',
      'commands',
      'world_events',
      'world_messages',
      'outbox_jobs',
      'tasks',
    ]) {
      values[table] = (
        await admin.query(
          `SELECT to_jsonb(t) AS row FROM parallel_life.${table} t WHERE owner_id=$1 ORDER BY id`,
          [owner],
        )
      ).rows;
    }
    return values;
  }
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1),($2)', [owner, other]);
    await repo.initialize(session, state(worldId));
    await repo.initialize(session, state(world2));
    await t.test('absent receipt does not insert command, task, event or message', async () => {
      const before = await snapshot();
      assert.equal(await lookup(command), null);
      assert.equal(await lookup(command), null);
      assert.deepEqual(await snapshot(), before);
    });
    const first = await repo.commit(session, command, event(command));
    const next = { ...command, id: randomUUID(), text: 'Later message', expectedVersion: 1 };
    await repo.commit(session, next, event(next));
    await t.test(
      'response-lost committed command returns original version after later turns',
      async () => {
        const before = await snapshot();
        const found = await lookup(command);
        assert.deepEqual(found, first);
        assert.equal(found!.state.version, 1);
        assert.equal((await repo.get(session, worldId)).version, 2);
        assert.deepEqual(await snapshot(), before);
      },
    );
    await t.test('actor/text/version fingerprint mismatch rejects without a write', async () => {
      const before = await snapshot();
      for (const change of [
        { text: 'changed' },
        { actorId: randomUUID() },
        { expectedVersion: 2 },
        { origin: 'director' as const },
      ])
        await assert.rejects(lookup({ ...command, ...change }), { code: 'IDEMPOTENCY_CONFLICT' });
      assert.deepEqual(await snapshot(), before);
    });
    await t.test(
      'foreign owner and unknown world reject; other own branch does not leak original receipt',
      async () => {
        const before = await snapshot();
        await assert.rejects(lookup(command, { userId: other }), { code: 'NOT_FOUND' });
        await assert.rejects(lookup({ ...command, worldId: randomUUID() }), { code: 'NOT_FOUND' });
        assert.equal(await lookup({ ...command, worldId: world2 }), null);
        assert.deepEqual(await snapshot(), before);
      },
    );
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1 OR id=$2', [owner, other]);
    await admin.end();
  }
});
