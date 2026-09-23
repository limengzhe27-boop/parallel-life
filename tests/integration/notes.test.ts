import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';

/** Real-database acceptance for the phone note command (D-12). */
test('real note transactions: persistence, idempotent replay, per-note versions and owner isolation', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const url = `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`;
  const db = new PostgresDatabase(url),
    repo = new PostgresWorldRepository(db);
  const owner = randomUUID(),
    other = randomUUID(),
    worldId = randomUUID();
  const session = { userId: owner },
    time = '2026-09-24T00:00:00.000Z';
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1),($2)', [owner, other]);
    await repo.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '便签测试',
      time,
      actors: [{ id: randomUUID(), name: '合成人物', persona: '合成' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });

    // 1) 新建并持久化
    const createCommand = randomUUID();
    const noteId = randomUUID();
    const created = await repo.saveNote(session, {
      commandId: createCommand,
      worldId,
      id: noteId,
      title: '本月清单',
      text: '房租、报销单',
      expectedVersion: 0,
    });
    assert.equal(created.note.id, noteId);
    assert.equal(created.note.version, 1);
    assert.equal(created.version, 1);

    // 2) 重新读取（模拟刷新）仍在
    const reloaded = await repo.get(session, worldId);
    assert.deepEqual(
      reloaded.notes?.map((note) => [note.id, note.title, note.version]),
      [[noteId, '本月清单', 1]],
    );

    // 3) 同一 commandId 重放返回原结果，不重复写入
    const replay = await repo.saveNote(session, {
      commandId: createCommand,
      worldId,
      id: noteId,
      title: '本月清单',
      text: '房租、报销单',
      expectedVersion: 0,
    });
    assert.equal(replay.note.version, 1);
    assert.equal((await repo.get(session, worldId)).version, 1);
    // 同一 commandId 换内容必须冲突
    await assert.rejects(
      repo.saveNote(session, {
        commandId: createCommand,
        worldId,
        id: noteId,
        title: '被改过的内容',
        text: '',
        expectedVersion: 1,
      }),
      { code: 'IDEMPOTENCY_CONFLICT' },
    );

    // 4) 修改要求便签自身版本匹配
    const updated = await repo.saveNote(session, {
      commandId: randomUUID(),
      worldId,
      id: noteId,
      title: '本月清单',
      text: '房租、报销单、水电',
      expectedVersion: 1,
    });
    assert.equal(updated.note.version, 2);
    await assert.rejects(
      repo.saveNote(session, {
        commandId: randomUUID(),
        worldId,
        id: noteId,
        title: '本月清单',
        text: '并发覆盖',
        expectedVersion: 1,
      }),
      { code: 'VERSION_CONFLICT' },
    );

    // 5) 开场便签的合成 id 也能被升级为持久便签
    const openingId = `${worldId}:opening-note:0`;
    const upgraded = await repo.saveNote(session, {
      commandId: randomUUID(),
      worldId,
      id: openingId,
      title: '备忘录：每个月',
      text: '房租一千八',
      expectedVersion: 0,
    });
    assert.equal(upgraded.note.id, openingId);
    assert.equal((await repo.get(session, worldId)).notes?.length, 2);

    // 6) 另一个用户既不能读也不能写
    await assert.rejects(repo.get({ userId: other }, worldId), { code: 'NOT_FOUND' });
    await assert.rejects(
      repo.saveNote({ userId: other }, {
        commandId: randomUUID(),
        worldId,
        id: randomUUID(),
        title: '越权',
        text: '',
        expectedVersion: 0,
      }),
      { code: 'NOT_FOUND' },
    );

    // 7) 便签不上世界快照（避免快照随便签增长）
    const snapshot = (
      await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [worldId])
    ).rows[0].state;
    assert.equal('notes' in snapshot ? snapshot.notes.length : 0, 0);
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id IN ($1,$2)', [owner, other]);
    await admin.end();
  }
});
