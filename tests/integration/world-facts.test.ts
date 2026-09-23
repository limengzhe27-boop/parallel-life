import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { FACTS_BUDGET_CHARS } from '../../src/modules/world/domain/retention.ts';

/**
 * AUD-09 acceptance: a long life must keep committing. Facts used to accumulate in
 * `worlds.state` until the 256KB CHECK failed and every later turn rolled back.
 */
test('a world keeps committing after its facts exceed the snapshot limit, and every fact stays queryable', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    repo = new PostgresWorldRepository(db);
  const userId = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID();
  const session = { userId },
    time = '2026-09-24T00:00:00.000Z';
  const TEXT = 3000; // each fact ~3KB, so 8 per turn ≈ 24KB of facts
  const TURNS = 16; // ≈ 390KB total, well past the 256KB snapshot limit
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [userId]);
    await repo.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: userId,
      version: 0,
      title: '容量测试',
      time,
      actors: [{ id: actorId, name: '合成人物', persona: '合成' }],
      facts: [
        { id: randomUUID(), text: '身份锚点', visibility: { kind: 'world' }, sourceEventId: 'genesis' },
        { id: randomUUID(), text: '情境锚点', visibility: { kind: 'world' }, sourceEventId: 'genesis' },
      ],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });

    for (let turn = 1; turn <= TURNS; turn += 1) {
      const command = {
        id: randomUUID(),
        worldId,
        actorId,
        text: `第 ${turn} 轮`,
        expectedVersion: turn - 1,
      };
      await repo.commit(session, command, {
        schemaVersion: 1,
        id: randomUUID(),
        worldId,
        commandId: command.id,
        version: turn,
        occurredAt: time,
        type: 'turn.resolved',
        data: {
          actorId,
          userText: command.text,
          effects: [
            /* 角色回合必须包含回复，事实随之累积 */
            { type: 'message.received' as const, id: randomUUID(), actorId, text: `第 ${turn} 轮回复` },
            ...Array.from({ length: 8 }, (_, index) => ({
              type: 'belief.recorded' as const,
              id: randomUUID(),
              actorId,
              text: `t${turn}-${index}-` + '观'.repeat(TEXT),
            })),
          ],
        },
      });
    }

    const snapshot = (
      await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [worldId])
    ).rows[0].state;
    const snapshotSize = JSON.stringify(snapshot).length;
    assert.ok(snapshotSize < 262144, `snapshot stayed small (${snapshotSize})`);
    assert.deepEqual(snapshot.facts, [], 'facts are projected, not stored in the snapshot');

    const stored = (
      await admin.query('SELECT count(*)::int AS n FROM parallel_life.world_facts WHERE world_id=$1', [
        worldId,
      ])
    ).rows[0].n;
    assert.equal(stored, TURNS * 8, 'every fact is kept in the projection');

    const world = await repo.get(session, worldId);
    assert.equal(world.version, TURNS);
    assert.ok(world.facts.length < stored, `state window is bounded (${world.facts.length} < ${stored})`);
    assert.ok(JSON.stringify(world.facts).length <= FACTS_BUDGET_CHARS);
    /* the newest fact survives; the oldest window entry is gone from the state */
    assert.match(world.facts.at(-1)!.text, /^t16-7-/);
    assert.ok(!world.facts.some((fact) => fact.text.startsWith('t1-0-')));
    /* genesis facts anchor the life and are always kept */
    assert.ok(world.facts.some((fact) => fact.text === '身份锚点'));
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [userId]);
    await admin.end();
  }
});
