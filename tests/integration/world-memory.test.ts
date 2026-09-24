import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';

/**
 * Phase 1 acceptance for the world side: what a turn taught the world must be stored
 * with provenance — the character's own impression under that character, and the turn
 * itself as a branch episode — and repeating the same impression must not duplicate it.
 */
test('a world turn stores a character belief and a branch episode with real sources', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const owner = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID();
  const session = { userId: owner },
    time = '2026-09-24T00:00:00.000Z';
  const turn = (version: number, text: string, belief: string) => ({
    command: { id: randomUUID(), worldId, actorId, text, expectedVersion: version },
    event: (commandId: string, eventId: string) => ({
      schemaVersion: 1 as const,
      id: eventId,
      worldId,
      commandId,
      version: version + 1,
      occurredAt: time,
      type: 'turn.resolved' as const,
      data: {
        actorId,
        userText: text,
        effects: [
          { type: 'message.received' as const, id: randomUUID(), actorId, text: `回复：${text}` },
          { type: 'belief.recorded' as const, id: randomUUID(), actorId, text: belief },
        ],
      },
    }),
  });
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await worlds.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '记忆测试',
      time,
      actors: [{ id: actorId, name: '合成人物', persona: '合成' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    const first = turn(0, '最近怎么样', '他看起来有点累');
    await worlds.commit(session, first.command, first.event(first.command.id, randomUUID()));

    const beliefs = (
      await admin.query(
        "SELECT id, scope_type, scope_id, character_id, kind, text, source_ids FROM parallel_life.memory_records WHERE owner_id=$1 AND kind='belief'",
        [owner],
      )
    ).rows;
    assert.equal(beliefs.length, 1, 'one character belief');
    assert.equal(beliefs[0].scope_type, 'character');
    assert.equal(beliefs[0].scope_id, actorId);
    assert.equal(beliefs[0].character_id, actorId);
    const episode = (
      await admin.query(
        "SELECT scope_type, scope_id, source_ids FROM parallel_life.memory_records WHERE owner_id=$1 AND kind='episode'",
        [owner],
      )
    ).rows;
    assert.equal(episode.length, 1, 'one branch episode for the turn');
    assert.equal(episode[0].scope_type, 'branch');
    assert.equal(episode[0].scope_id, worldId);
    /* Provenance points at rows that really exist. */
    const refs = (
      await admin.query(
        'SELECT r.source_type, r.source_id FROM parallel_life.memory_source_refs r WHERE r.owner_id=$1',
        [owner],
      )
    ).rows;
    assert.ok(refs.some((ref) => ref.source_type === 'world_message'));
    assert.ok(refs.some((ref) => ref.source_type === 'world_event'));

    /* The same impression again merges its sources instead of duplicating the record. */
    const second = turn(1, '还好吗', '他看起来有点累');
    await worlds.commit(session, second.command, second.event(second.command.id, randomUUID()));
    const afterSecond = (
      await admin.query(
        "SELECT count(*)::int AS n FROM parallel_life.memory_records WHERE owner_id=$1 AND kind='belief'",
        [owner],
      )
    ).rows[0].n;
    assert.equal(afterSecond, 1, 'the repeated impression stays one record');
    const refCount = (
      await admin.query(
        "SELECT count(*)::int AS n FROM parallel_life.memory_source_refs WHERE owner_id=$1 AND source_type='world_message'",
        [owner],
      )
    ).rows[0].n;
    assert.equal(refCount, 2, 'both replies are kept as sources');
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
