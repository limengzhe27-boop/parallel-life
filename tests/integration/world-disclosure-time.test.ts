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
import { actorContext } from '../../src/modules/world/application/actor-context.ts';

test('five day return spreads sourced NPC turns and preserves selective knowledge on restart', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const clock = new PostgresClockStore(db);
  const owner = randomUUID(),
    worldId = randomUUID(),
    sister = randomUUID(),
    mother = randomUUID(),
    friend = randomUUID();
  const session = { userId: owner };
  const start = '2026-09-24T08:00:00.000Z';
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await worlds.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '导演人生',
      time: start,
      actors: [
        { id: sister, name: '姐姐', persona: '会斟酌告诉家人', relationship: '姐姐' },
        { id: mother, name: '妈妈', persona: '关心孩子', relationship: '妈妈' },
        { id: friend, name: '朋友', persona: '不认识主角家人', relationship: '朋友' },
      ],
      actorTies: [
        { fromActorId: sister, toActorId: mother, relationship: '同住家人', mayShare: true },
        { fromActorId: sister, toActorId: friend, relationship: '互不熟悉', mayShare: false },
      ],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    const setupCommand = {
      id: randomUUID(),
      worldId,
      actorId: sister,
      text: '我想明年转去拍纪录片',
      expectedVersion: 0,
    };
    await worlds.commit(session, setupCommand, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      version: 1,
      commandId: setupCommand.id,
      occurredAt: start,
      storyAt: start,
      type: 'turn.resolved',
      data: {
        actorId: sister,
        userText: setupCommand.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId: sister, text: '我先听你说说。' },
        ],
      },
    });
    const forgedCommand = {
      id: randomUUID(),
      worldId,
      actorId: sister,
      origin: 'director' as const,
      text: '（测试导演节拍）',
      expectedVersion: 1,
    };
    const sourced = (await worlds.get(session, worldId)).messages.find(
      (message) => message.role === 'user',
    )!;
    await assert.rejects(
      worlds.commit(session, forgedCommand, {
        schemaVersion: 1,
        id: randomUUID(),
        worldId,
        version: 2,
        commandId: forgedCommand.id,
        occurredAt: start,
        type: 'turn.resolved',
        data: {
          actorId: sister,
          origin: 'director',
          userText: forgedCommand.text,
          effects: [
            { type: 'message.received', id: randomUUID(), actorId: sister, text: '我想想。' },
            {
              type: 'information.shared',
              id: randomUUID(),
              recipientActorId: mother,
              sourceMessageId: sourced.id,
              quote: '明年转去拍纪录片',
            },
          ],
        },
      }),
      /policy version required/,
    );
    assert.equal((await worlds.get(session, worldId)).version, 1);
    let calls = 0;
    const result = await advanceWorld(
      {
        clock,
        worlds,
        now: () => '2026-09-29T08:00:00.000Z',
        newId: randomUUID,
        planner: {
          propose: async ({ context }) => {
            calls++;
            if (context.actor.id === sister) {
              assert.deepEqual(
                context.possibleRecipients?.map((actor) => actor.id),
                [mother],
              );
              const source = context.messages.find((message) => message.role === 'user')!;
              return {
                schemaVersion: 1,
                effects: [
                  {
                    type: 'message.received',
                    id: 'reply',
                    actorId: sister,
                    text: '那件事我想过了，先跟妈妈说一声。',
                  },
                  {
                    type: 'information.shared',
                    id: 'share',
                    recipientActorId: mother,
                    sourceMessageId: source.id,
                    quote: '明年转去拍纪录片',
                  },
                ],
              };
            }
            assert.equal(context.actor.id, mother);
            assert.equal(
              context.facts.some((fact) => fact.disclosure?.fromActorId === sister),
              true,
            );
            assert.equal(
              context.messages.some((message) => message.actorId === sister),
              false,
            );
            return {
              schemaVersion: 1,
              effects: [
                {
                  type: 'message.received',
                  id: 'reply',
                  actorId: mother,
                  text: '姐姐提到你想拍纪录片。你自己想怎么开始？',
                },
              ],
            };
          },
        },
      },
      session,
      worldId,
    );
    assert.equal(result.played, 2);
    assert.equal(calls, 2);
    assert.equal(result.storyNow, '2026-09-29T08:00:00.000Z');
    const reopened = await worlds.get(session, worldId);
    const later = reopened.messages.filter(
      (message) => message.role === 'assistant' && message.at > start,
    );
    assert.equal(later.length, 2);
    assert.notEqual(later[0]!.at.slice(0, 10), later[1]!.at.slice(0, 10));
    assert.equal(actorContext(reopened, mother).facts.filter((fact) => fact.disclosure).length, 1);
    assert.equal(actorContext(reopened, friend).facts.filter((fact) => fact.disclosure).length, 0);
    assert.equal(actorContext(reopened, sister).facts.filter((fact) => fact.disclosure).length, 0);
    const repeated = await advanceWorld(
      {
        clock,
        worlds,
        now: () => '2026-09-29T08:00:00.000Z',
        newId: randomUUID,
        planner: {
          propose: async () => {
            throw new Error('must not regenerate');
          },
        },
      },
      session,
      worldId,
    );
    assert.equal(repeated.played, 0);
    assert.equal((await worlds.get(session, worldId)).version, reopened.version);
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});

test('a director attempt from the older clock policy keeps its original command on manual recovery', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const config = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${config.appPassword}@127.0.0.1:${config.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const clock = new PostgresClockStore(db);
  const owner = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID();
  const session = { userId: owner };
  const oldSlot = '2026-09-24T08:30:00.000Z';
  const oldCommand = clock.beatCommandId(worldId, oldSlot);
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await worlds.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: '恢复测试',
      time: '2026-09-24T08:00:00.000Z',
      actors: [{ id: actorId, name: '姐姐', persona: '简短关心' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    await admin.query(
      `INSERT INTO parallel_life.world_director_attempts(world_id,owner_id,command_id,planned_for,actor_id,status)
       VALUES($1,$2,$3,$4,$5,'unknown')`,
      [worldId, owner, oldCommand, oldSlot, actorId],
    );
    const deps = (automatic: boolean) => ({
      clock,
      worlds,
      automatic,
      now: () => '2026-09-29T08:00:00.000Z',
      newId: randomUUID,
      planner: {
        propose: async () => ({
          schemaVersion: 1,
          effects: [
            {
              type: 'message.received',
              id: 'reply',
              actorId,
              text: '想到上次说的事，给你发条消息。',
            },
          ],
        }),
      },
    });
    await assert.rejects(advanceWorld(deps(true), session, worldId), /手动继续/);
    const recovered = await advanceWorld(deps(false), session, worldId);
    assert.equal(recovered.played, 1);
    const row = (
      await admin.query(
        'SELECT status FROM parallel_life.world_director_attempts WHERE world_id=$1 AND command_id=$2',
        [worldId, oldCommand],
      )
    ).rows[0];
    assert.equal(row.status, 'committed');
    assert.equal((await worlds.get(session, worldId)).messages[0]?.at, oldSlot);
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
