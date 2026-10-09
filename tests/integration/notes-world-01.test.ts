import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresPlayerRecords } from '../../src/modules/world/infrastructure/player-records-repository.ts';
import type { WorldEffect } from '../../src/modules/world/domain/types.ts';

// Explicit synthetic turns through the actual reducer/transaction. No AI success is claimed.
test('player records: real committed sources, calendar replay, isolation and read-only behavior', async (t) => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
      `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    ),
    worker = new PostgresDatabase(
      `postgresql://pl_worker:${c.workerPassword}@127.0.0.1:${c.port}/parallel_life_test`,
    );
  const repo = new PostgresWorldRepository(db),
    records = new PostgresPlayerRecords(db),
    owner = randomUUID(),
    other = randomUUID(),
    worldId = randomUUID(),
    secondId = randomUUID(),
    actorId = randomUUID();
  const time = '2026-10-10T00:00:00.000Z',
    session = { userId: owner };
  const commit = async (text: string, effects: WorldEffect[], director = false) => {
    const state = await repo.get(session, worldId),
      commandId = randomUUID();
    return repo.commit(
      session,
      {
        id: commandId,
        worldId,
        actorId,
        expectedVersion: state.version,
        text,
        ...(director ? { origin: 'director' as const } : {}),
      },
      {
        schemaVersion: 1,
        id: randomUUID(),
        worldId,
        version: state.version + 1,
        commandId,
        occurredAt: time,
        storyAt: time,
        type: 'turn.resolved',
        data: {
          actorId,
          userText: text,
          effects,
          ...(director ? { origin: 'director' as const } : {}),
        },
      },
    );
  };
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1),($2)', [owner, other]);
    for (const id of [worldId, secondId])
      await repo.initialize(session, {
        schemaVersion: 1,
        id,
        ownerId: owner,
        version: 0,
        title: '合成记录验证',
        time,
        actors: [{ id: actorId, name: '同名朋友', persona: 'SECRET_PERSONA' }],
        messages: [],
        appointments: [],
        mediaRequests: [],
        facts: [],
      });
    await t.test('legacy genuinely empty, private note never becomes a task', async () => {
      assert.equal((await records.read(owner, worldId)).current.length, 0);
      await repo.saveNote(session, {
        commandId: randomUUID(),
        worldId,
        id: randomUUID(),
        title: 'SECRET_PRIVATE_NOTE',
        text: '已完成',
        expectedVersion: 0,
      });
      assert.equal(JSON.stringify(await records.read(owner, worldId)).includes('SECRET'), false);
    });
    const choiceId = randomUUID();
    const quote = '我决定练习摄影';
    await commit(quote, [
      { type: 'message.received', id: randomUUID(), actorId, text: '可以一起讨论练习的计划。' },
      { type: 'choice.recorded', id: choiceId, quote, intent: '练习摄影' },
    ]);
    const invitationId = randomUUID(),
      nextQuote = '明天一起去公园练习拍照吧';
    await commit(
      `[choice:${choiceId}]`,
      [
        { type: 'message.received', id: randomUUID(), actorId, text: nextQuote },
        { type: 'choice.next_step', id: randomUUID(), choiceId, quote: nextQuote },
        {
          type: 'appointment.proposed',
          id: invitationId,
          title: '摄影练习',
          at: '2026-10-11T00:00:00.000Z',
          participantIds: [actorId],
        },
        { type: 'belief.recorded', id: randomUUID(), actorId, text: 'SECRET_CHARACTER_BELIEF' },
      ],
      true,
    );
    await t.test(
      'committed plan/suggestion/calendar with actor ID, no private source leaks or writes',
      async () => {
        const before = await repo.get(session, worldId),
          result = await records.read(owner, worldId);
        assert.equal(result.current.length, 3);
        assert.equal(result.worldVersion, before.version);
        assert.deepEqual(result.current[0]!.navigation, { app: 'wechat', actorId });
        assert.equal(result.current[1]!.assertion, 'actor_statement');
        assert.equal(result.current[2]!.state, 'proposed');
        assert.equal(JSON.stringify(result).includes('SECRET'), false);
        assert.deepEqual(await records.read(owner, worldId), result);
        assert.deepEqual(await repo.get(session, worldId), before);
      },
    );
    await t.test(
      'explicit invitation response is replayed from events and agrees with calendar',
      async () => {
        let state = await repo.get(session, worldId);
        await repo.respondToInvitation(session, {
          commandId: randomUUID(),
          worldId,
          id: invitationId,
          expectedVersion: state.version,
          operation: 'accept',
        });
        assert.equal(
          (await records.read(owner, worldId)).current.find((r) => r.kind === 'invitation')!.state,
          'confirmed',
        );
        state = await repo.get(session, worldId);
        await repo.respondToInvitation(session, {
          commandId: randomUUID(),
          worldId,
          id: invitationId,
          expectedVersion: state.version,
          operation: 'cancel',
        });
        const result = await records.read(owner, worldId);
        assert.equal(
          result.current.some((r) => r.kind === 'invitation'),
          false,
        );
        assert.equal(result.history.find((r) => r.kind === 'invitation')!.state, 'cancelled');
      },
    );
    await t.test(
      'same-owner worlds/foreign owner/worker remain isolated and system IDs reject at final writer',
      async () => {
        assert.equal((await records.read(owner, secondId)).current.length, 0);
        await assert.rejects(records.read(other, worldId), { code: 'NOT_FOUND' });
        await assert.rejects(new PostgresPlayerRecords(worker).read(owner, worldId), {
          code: 'NOT_FOUND',
        });
        const before = await repo.get(session, worldId);
        const systemId = (await records.read(owner, worldId)).current[0]!.id;
        await assert.rejects(
          repo.saveNote(session, {
            commandId: randomUUID(),
            worldId,
            id: systemId,
            title: '已完成',
            text: '',
            expectedVersion: 0,
          }),
          { code: 'INVALID_COMMAND' },
        );
        assert.deepEqual(await repo.get(session, worldId), before);
      },
    );
    await t.test('forged source projection referencing another world fails closed', async () => {
      const before = await repo.get(session, worldId);
      await admin.query(
        "UPDATE parallel_life.worlds SET state=jsonb_set(state,'{choices,0,sourceEventId}',to_jsonb($2::text)) WHERE id=$1",
        [worldId, randomUUID()],
      );
      const result = await records.read(owner, worldId);
      assert.equal(
        result.current.some((r) => r.kind === 'player_choice' || r.kind === 'actor_suggestion'),
        false,
      );
      await admin.query('UPDATE parallel_life.worlds SET state=$2 WHERE id=$1', [
        worldId,
        { ...before, messages: [], appointments: [], notes: [], facts: [], mediaRequests: [] },
      ]);
    });
  } finally {
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=ANY($1::text[])', [
      [owner, other],
    ]);
    await db.close();
    await worker.close();
    await admin.end();
  }
});
