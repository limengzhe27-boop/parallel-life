import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { projectStoryTime } from '../../src/modules/world/domain/clock.ts';
import { resolveTurn } from '../../src/modules/world/application/resolve-turn.ts';

test('a resumed world persists distinct message times and moves its clock with the committed reply', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const clocks = new PostgresClockStore(db);
  const owner = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID();
  const session = { userId: owner };
  const start = '2026-09-28T07:00:00.000Z';
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await assert.rejects(clocks.read(owner, randomUUID()), { code: 'NOT_FOUND' });
    await worlds.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '时间验收',
      time: start,
      actors: [{ id: actorId, name: '朋友', persona: '会回复消息' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    const anchor = await clocks.read(owner, worldId);
    assert.equal(projectStoryTime(anchor, '2026-09-28T08:00:00.000Z'), '2026-09-28T08:00:00.000Z');
    const realTimes = ['2026-09-28T08:00:00.000Z', '2026-09-28T08:02:00.000Z'];
    const command = {
      id: randomUUID(),
      worldId,
      expectedVersion: 0,
      actorId,
      text: '我们见面吗？',
    };
    const receipt = await resolveTurn(
      {
        worlds,
        planner: {
          propose: async () => ({
            schemaVersion: 1,
            effects: [{ type: 'message.received', id: 'reply', actorId, text: '好，八点半见。' }],
          }),
        },
        now: () => realTimes.shift()!,
        storyNow: (realNow) => projectStoryTime(anchor, realNow),
        newId: randomUUID,
      },
      session,
      command,
    );
    assert.equal(receipt.state.time, '2026-09-28T08:02:00.000Z');
    assert.deepEqual(
      (await worlds.get(session, worldId)).messages.map((message) => message.at),
      ['2026-09-28T08:00:00.000Z', '2026-09-28T08:02:00.000Z'],
    );
    const savedClock = await clocks.read(owner, worldId);
    assert.equal(savedClock.storyNow, '2026-09-28T08:02:00.000Z');
    assert.equal(
      projectStoryTime(savedClock, '2026-09-28T08:17:00.000Z'),
      '2026-09-28T08:17:00.000Z',
    );
    await clocks.setClock(owner, worldId, { paused: true }, '2026-09-28T08:17:00.000Z');
    const paused = await clocks.read(owner, worldId);
    assert.equal(projectStoryTime(paused, '2026-09-28T09:00:00.000Z'), '2026-09-28T08:17:00.000Z');
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
