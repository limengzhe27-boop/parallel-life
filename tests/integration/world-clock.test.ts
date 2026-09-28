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
    assert.equal(advanced.played, 1, 'one unresolved invitation merits one follow-up');
    assert.equal(advanced.folded, 11, 'empty slots do not become filler messages');
    assert.match(advanced.summary ?? '', /世界照常运转/);
    assert.equal((await clock.read(owner, worldId)).summary, advanced.summary);
    const unsourced = await admin.query(
      'SELECT count(*)::int AS n FROM parallel_life.memory_records WHERE owner_id=$1 AND text=$2',
      [owner, advanced.summary],
    );
    assert.equal(unsourced.rows[0].n, 0, 'elapsed time is metadata, not a fabricated event memory');
    assert.equal(spoken[0], second, 'the open appointment decides the first beat');
    assert.equal(advanced.storyNow, '2026-09-24T06:00:00.000Z');
    assert.equal(spoken.length, 1);
    for (let index = 1; index < spoken.length; index += 1)
      assert.notEqual(spoken[index], spoken[index - 1], 'nobody speaks twice in a row');

    const world = await worlds.get(session, worldId);
    assert.equal(world.time, '2026-09-24T06:00:00.000Z', 'story time moved');
    /* One set-up turn plus one real committed turn per beat. */
    assert.equal(world.version, 2, 'only the meaningful beat is a real committed turn');
    assert.equal(
      world.messages.filter((m) => m.role === 'user').length,
      1,
      'only the setup user message exists; director cues never impersonate the user',
    );
    assert.equal(world.messages.filter((m) => m.role === 'assistant').length, 2);

    const beats = (
      await admin.query(
        'SELECT count(*)::int AS n FROM parallel_life.world_beats WHERE world_id=$1',
        [worldId],
      )
    ).rows[0].n;
    assert.equal(beats, 1);

    /* The user's own time controls persist (pause / speed), without inventing time. */
    await clock.setClock(owner, worldId, { speed: 1.5 }, advanced.storyNow);
    const controlled = await clock.read(owner, worldId);
    assert.equal(controlled.speed, 1.5);
    assert.equal(controlled.paused, false);
    assert.equal(
      controlled.storyNow,
      '2026-09-24T06:00:00.000Z',
      'a control change does not move time',
    );

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
    assert.equal((await worlds.get(session, worldId)).version, 2);

    /* No time passed: nothing happens either. */
    const idle = await advanceWorld(deps('2026-09-24T09:00:00.000Z'), session, worldId);
    assert.equal(idle.played, 0);
    await clock.write(owner, worldId, { ...(await clock.read(owner, worldId)), paused: false });
    const quiet = await advanceWorld(deps('2026-09-24T09:05:00.000Z'), session, worldId);
    assert.equal(quiet.played, 0);
    assert.equal(
      (await worlds.get(session, worldId)).time,
      quiet.storyNow,
      'phone time follows the clock even when no character is due to speak',
    );
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});

test('director retry reconciles an unknown call without automatic re-spend or duplicate messages', async () => {
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
    actorId = randomUUID();
  const session = { userId: owner };
  const start = '2026-09-24T00:00:00.000Z';
  const later = '2026-09-24T00:35:00.000Z';
  let calls = 0,
    fail = true;
  const deps = (automatic: boolean) => ({
    clock,
    worlds,
    automatic,
    maxBeats: 1,
    now: () => later,
    newId: () => randomUUID(),
    planner: {
      propose: async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 60));
        if (fail) throw new Error('model outcome unknown');
        return {
          schemaVersion: 1 as const,
          effects: [
            {
              type: 'message.received' as const,
              id: randomUUID(),
              actorId,
              text: '刚收到展馆回复，周三可以。你想几点见？',
            },
          ],
        };
      },
    },
  });
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await worlds.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '导演恢复测试',
      time: start,
      actors: [{ id: actorId, name: '朋友', persona: '简短说话' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    const setup = { id: randomUUID(), worldId, actorId, text: '周三看展？', expectedVersion: 0 };
    await worlds.commit(session, setup, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      commandId: setup.id,
      version: 1,
      occurredAt: start,
      type: 'turn.resolved',
      data: {
        actorId,
        userText: setup.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId, text: '我去问问展馆。' },
          {
            type: 'appointment.proposed',
            id: randomUUID(),
            title: '周三看展',
            at: '2026-09-25T10:00:00.000Z',
            participantIds: [actorId],
          },
        ],
      },
    });

    const concurrent = await Promise.allSettled([
      advanceWorld(deps(true), session, worldId),
      advanceWorld(deps(true), session, worldId),
    ]);
    assert.deepEqual(
      concurrent.map((result) => result.status),
      ['rejected', 'rejected'],
    );
    assert.equal(
      calls,
      1,
      `the world lock permits one model call: ${concurrent.map((r) => (r.status === 'rejected' ? String(r.reason) : 'fulfilled')).join(' / ')}`,
    );
    assert.equal((await worlds.get(session, worldId)).version, 1);
    assert.equal(
      (await clock.read(owner, worldId)).storyNow,
      start,
      'failure does not consume story time',
    );
    await assert.rejects(advanceWorld(deps(true), session, worldId), /上次导演来信结果不确定/);
    assert.equal(calls, 1, 'automatic revisit never pays again for an unknown outcome');

    fail = false;
    const interruptedClock = new PostgresClockStore(db);
    const originalRecord = interruptedClock.recordBeat.bind(interruptedClock);
    let interruptAfterCommit = true;
    interruptedClock.recordBeat = async (...args) => {
      if (interruptAfterCommit) {
        interruptAfterCommit = false;
        throw new Error('response lost after world commit');
      }
      return originalRecord(...args);
    };
    await assert.rejects(
      advanceWorld({ ...deps(false), clock: interruptedClock }, session, worldId),
      /response lost after world commit/,
    );
    assert.equal(calls, 2, 'only an explicit manual retry makes the second model call');
    assert.equal((await worlds.get(session, worldId)).version, 2);
    assert.equal((await clock.read(owner, worldId)).storyNow, start);
    const recovered = await advanceWorld(deps(true), session, worldId);
    assert.equal(recovered.played, 1, 'recovery counts the prior committed turn');
    assert.equal((await clock.read(owner, worldId)).storyNow, later);
    const replay = await advanceWorld(deps(true), session, worldId);
    assert.equal(replay.played, 0);
    assert.equal(calls, 2);
    const counts = await admin.query(
      `SELECT (SELECT count(*)::int FROM parallel_life.world_director_attempts WHERE world_id=$1) attempts,
              (SELECT count(*)::int FROM parallel_life.world_beats WHERE world_id=$1) beats,
              (SELECT count(*)::int FROM parallel_life.world_events WHERE world_id=$1 AND payload->'data'->>'origin'='director') turns`,
      [worldId],
    );
    assert.deepEqual(counts.rows[0], { attempts: 1, beats: 1, turns: 1 });

    const silentId = randomUUID();
    await worlds.initialize(session, {
      schemaVersion: 1,
      id: silentId,
      ownerId: owner,
      version: 0,
      title: '安静的日常',
      time: start,
      actors: [{ id: actorId, name: '朋友', persona: '有自己的生活' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    const silent = await advanceWorld(deps(true), session, silentId);
    assert.equal(silent.played, 0);
    assert.equal((await worlds.get(session, silentId)).time, later);
    assert.equal(calls, 2, 'elapsed time alone never pays for a filler message');
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
