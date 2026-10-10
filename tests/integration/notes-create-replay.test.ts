import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';

test('new note allocation replays under a real world lock, including historical IDs', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const repo = new PostgresWorldRepository(db),
    owner = randomUUID(),
    worldId = randomUUID();
  const session = { userId: owner };
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await repo.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '明确的便签回执测试',
      time: '2026-10-10T00:00:00.000Z',
      actors: [],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    const command = {
      worldId,
      commandId: randomUUID(),
      title: '新建便签',
      text: '原内容',
      expectedVersion: 0,
    };
    const [first, concurrent] = await Promise.all([
      repo.saveNote(session, command),
      repo.saveNote(session, command),
    ]);
    assert.deepEqual(concurrent, first);
    const updated = await repo.saveNote(session, {
      ...command,
      commandId: randomUUID(),
      id: first.note.id,
      expectedVersion: 1,
      text: '新内容',
    });
    assert.equal(updated.note.version, 2);
    assert.deepEqual(await new PostgresWorldRepository(db).saveNote(session, command), first);
    await assert.rejects(repo.saveNote(session, { ...command, text: '篡改旧请求' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    const historical = {
      ...command,
      commandId: randomUUID(),
      id: randomUUID(),
      title: '旧服务端随机ID',
    };
    const old = await repo.saveNote(session, historical);
    const { id: _id, ...withoutId } = historical;
    assert.deepEqual(await repo.saveNote(session, withoutId), old);
    const state = await repo.get(session, worldId);
    assert.equal(state.version, 3);
    assert.equal(state.notes?.length, 2);
    assert.equal(state.notes?.find((n) => n.id === first.note.id)?.text, '新内容');
    const counts = (
      await admin.query(
        'SELECT count(*)::int AS n FROM parallel_life.world_events WHERE world_id=$1',
        [worldId],
      )
    ).rows[0];
    assert.equal(counts.n, 3);
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
