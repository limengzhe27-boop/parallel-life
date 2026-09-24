import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { advanceWorld } from '../../src/modules/world/application/advance-world.ts';
import { MAX_BEATS_PER_ADVANCE } from '../../src/modules/world/domain/clock.ts';

/** Phase 2 acceptance: the world moves on its own, but never without a bound. */
test('advancing a world plays bounded beats, moves story time, and stops when paused', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const clock = new PostgresClockStore(db);
  const owner = randomUUID(),
    worldId = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  const session = { userId: owner },
    start = '2026-09-24T00:00:00.000Z';
  let spoken: string[] = [];
  const deps = (realNow: string) => ({
    clock,
    worlds,
    planner: {
      propose: async ({ context }: { context: { actor: { id: string } } }) => {
        spoken.push(context.actor.id);
        return {
          schemaVersion: 1 as const,
          effects: [
            {
              type: 'message.received' as const,
              id: randomUUID(),
              actorId: context.actor.id,
              text: `（${context.actor.id} 自己开口）`,
            },
          ],
        };
      },
    },
    now: () => realNow,
    newId: () => randomUUID(),
  });
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await worlds.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '导演节拍测试',
      time: start,
      actors: [
        { id: first, name: '甲', persona: '合成' },
        { id: second, name: '乙', persona: '合成' },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });

    /* An open appointment pulls its participant into the very first beat. */
    const appointmentCommand = {
      id: randomUUID(),
      worldId,
      actorId: second,
      text: '（约定）',
      expectedVersion: 0,
    };
    await worlds.commit(session, appointmentCommand, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      commandId: appointmentCommand.id,
      version: 1,
      occurredAt: start,
      type: 'turn.resolved',
      data: {
        actorId: second,
        userText: appointmentCommand.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId: second, text: '周三有空吗' },
          {
            type: 'appointment.proposed',
            id: randomUUID(),
            title: '周三一起看展',
            at: '2026-09-25T10:00:00.000Z',
            participantIds: [second],
          },
        ],
      },
    });

    /* Six real hours at 1:1 = twelve beats, but only the cap is played. */
    const advanced = await advanceWorld(deps('2026-09-24T06:00:00.000Z'), session, worldId);
    assert.equal(advanced.played, MAX_BEATS_PER_ADVANCE);
    assert.equal(advanced.folded, 9);
    assert.match(advanced.summary ?? '', /世界照常运转/);
    assert.equal(spoken[0], second, 'the open appointment decides the first beat');
    assert.equal(advanced.storyNow, '2026-09-24T06:00:00.000Z');
    assert.equal(spoken.length, MAX_BEATS_PER_ADVANCE);
    for (let index = 1; index < spoken.length; index += 1)
      assert.notEqual(spoken[index], spoken[index - 1], 'nobody speaks twice in a row');

    const world = await worlds.get(session, worldId);
    assert.equal(world.time, '2026-09-24T06:00:00.000Z', 'story time moved');
    /* One set-up turn plus one real committed turn per beat. */
    assert.equal(world.version, 1 + MAX_BEATS_PER_ADVANCE, 'each beat is a real committed turn');
    /* A beat commits a real turn; the user-facing cue may also be persisted, so only
       the lower bound is contractual. */
    assert.ok(
      world.messages.length >= MAX_BEATS_PER_ADVANCE,
      `each beat produced a message (got ${world.messages.length})`,
    );

    const beats = (
      await admin.query(
        'SELECT count(*)::int AS n FROM parallel_life.world_beats WHERE world_id=$1',
        [worldId],
      )
    ).rows[0].n;
    assert.equal(beats, MAX_BEATS_PER_ADVANCE);

    /* Paused: nothing happens, no model call, no version change. */
    await clock.write(owner, worldId, {
      storyNow: advanced.storyNow,
      speed: 1,
      paused: true,
      lastTickAt: '2026-09-24T06:00:00.000Z',
      missedBeats: 0,
      summary: null,
    });
    const before = spoken.length;
    const paused = await advanceWorld(deps('2026-09-24T09:00:00.000Z'), session, worldId);
    assert.equal(paused.played, 0);
    assert.equal(spoken.length, before, 'a paused world costs nothing');
    assert.equal((await worlds.get(session, worldId)).version, 1 + MAX_BEATS_PER_ADVANCE);

    /* No time passed: nothing happens either. */
    const idle = await advanceWorld(deps('2026-09-24T09:00:00.000Z'), session, worldId);
    assert.equal(idle.played, 0);
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
