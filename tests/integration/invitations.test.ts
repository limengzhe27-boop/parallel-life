import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresClockStore } from '../../src/modules/world/infrastructure/clock-repository.ts';
import { buildAgenda } from '../../src/modules/world/domain/agenda.ts';
import type { InvitationCommand } from '../../src/modules/world/domain/invitations.ts';

test('real invitation transactions: concurrent edits, immutable receipts, isolation, restart and rollback', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const url = `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`;
  let db = new PostgresDatabase(url),
    repo = new PostgresWorldRepository(db);
  const userId = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID(),
    appointmentId = randomUUID();
  const session = { userId },
    time = '2026-09-22T00:00:00.000Z';
  const turn = { id: randomUUID(), worldId, actorId, text: '明天见？', expectedVersion: 0 };
  const command = (
    version: number,
    operation: InvitationCommand['operation'],
  ): InvitationCommand => ({
    commandId: randomUUID(),
    worldId,
    id: appointmentId,
    expectedVersion: version,
    operation,
  });
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [userId]);
    await repo.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: userId,
      version: 0,
      title: '邀约测试',
      time,
      actors: [{ id: actorId, name: '测试人物', persona: '合成' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    const original = await repo.commit(session, turn, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      commandId: turn.id,
      version: 1,
      occurredAt: time,
      type: 'turn.resolved',
      data: {
        actorId,
        userText: turn.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId, text: '一起见面吧' },
          {
            type: 'appointment.proposed',
            id: appointmentId,
            title: '见面',
            at: '2026-09-23T00:00:00.000Z',
            participantIds: [actorId],
          },
        ],
      },
    });
    const accept = command(1, 'accept');
    const duplicates = await Promise.all([
      repo.respondToInvitation(session, accept),
      repo.respondToInvitation(session, accept),
    ]);
    assert.deepEqual(duplicates[0], duplicates[1]);
    assert.equal(duplicates[0]!.appointments[0]?.status, 'confirmed');
    assert.equal(duplicates[0]!.version, 2);
    assert.deepEqual(await repo.receipt(session, turn), original);
    await assert.rejects(repo.respondToInvitation({ userId: randomUUID() }, accept), {
      code: 'NOT_FOUND',
    });
    await assert.rejects(repo.respondToInvitation(session, { ...accept, operation: 'cancel' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await assert.rejects(repo.respondToInvitation(session, command(1, 'cancel')), {
      code: 'VERSION_CONFLICT',
    });
    const changes = [
      { ...command(2, 'reschedule'), at: '2026-09-24T00:00:00.000Z' },
      { ...command(2, 'reschedule'), at: '2026-09-25T00:00:00.000Z' },
    ];
    const raced = await Promise.allSettled(
      changes.map((a) => repo.respondToInvitation(session, a)),
    );
    assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1);
    const next = await repo.get(session, worldId);
    assert.equal(next.version, 3);
    assert.equal(next.appointments[0]?.status, 'proposed');
    // Force a SQL failure at the final write; prior command/event writes must roll back.
    await admin.query(
      "ALTER TABLE parallel_life.worlds ADD CONSTRAINT invitation_test_rollback CHECK (id <> '" +
        worldId +
        "' OR version < 4)",
    );
    try {
      await assert.rejects(repo.respondToInvitation(session, command(3, 'cancel')), {
        code: '23514',
      });
      assert.equal((await repo.get(session, worldId)).version, 3);
      assert.equal(
        (await admin.query('SELECT 1 FROM parallel_life.commands WHERE world_id=$1', [worldId]))
          .rowCount,
        3,
      );
    } finally {
      await admin.query(
        'ALTER TABLE parallel_life.worlds DROP CONSTRAINT invitation_test_rollback',
      );
    }
    const cancelled = await repo.respondToInvitation(session, command(3, 'cancel'));
    assert.equal(cancelled.appointments[0]?.status, 'cancelled');
    await db.close();
    db = new PostgresDatabase(url);
    repo = new PostgresWorldRepository(db);
    assert.deepEqual(await repo.get(session, worldId), cancelled);
    assert.deepEqual(await repo.respondToInvitation(session, accept), duplicates[0]);
    assert.deepEqual(await repo.receipt(session, turn), original);
    assert.equal(
      (await admin.query('SELECT 1 FROM parallel_life.world_events WHERE world_id=$1', [worldId]))
        .rowCount,
      4,
    );
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [userId]);
    await admin.end();
  }
});

test('a protagonist decision survives reload and competing attendance outcomes cannot both win', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const url = `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`;
  let db = new PostgresDatabase(url);
  let repo = new PostgresWorldRepository(db);
  const ownerId = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID();
  const session = { userId: ownerId };
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [ownerId]);
    await repo.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId,
      version: 0,
      title: '赴约测试',
      time: '2026-09-22T00:00:00.000Z',
      actors: [{ id: actorId, name: '朋友', persona: '合成' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    const commandId = randomUUID();
    const proposal = await repo.commit(
      session,
      { id: commandId, worldId, actorId, text: '明天见', expectedVersion: 0 },
      {
        schemaVersion: 1,
        id: randomUUID(),
        worldId,
        commandId,
        version: 1,
        occurredAt: '2026-09-22T00:00:00.000Z',
        type: 'turn.resolved',
        data: {
          actorId,
          userText: '明天见',
          effects: [
            { type: 'message.received', id: randomUUID(), actorId, text: '好，明天见' },
            {
              type: 'appointment.proposed',
              id: randomUUID(),
              title: '一起看展',
              at: '2026-09-23T00:00:00.000Z',
              participantIds: [actorId],
            },
          ],
        },
      },
    );
    const invitationId = proposal.state.appointments[0]!.id;
    const accepted = await repo.respondToInvitation(session, {
      commandId: randomUUID(),
      worldId,
      id: invitationId,
      expectedVersion: 1,
      operation: 'accept',
    });
    assert.equal(accepted.appointments[0]?.status, 'confirmed');
    const beforeDue = {
      commandId: randomUUID(),
      worldId,
      id: invitationId,
      expectedVersion: 2,
      operation: 'attend' as const,
    };
    await assert.rejects(repo.respondToInvitation(session, beforeDue), { code: 'INVALID_COMMAND' });
    await new PostgresClockStore(db).write(ownerId, worldId, {
      storyNow: '2026-09-24T00:00:00.000Z',
      speed: 1,
      paused: true,
      lastTickAt: new Date().toISOString(),
      missedBeats: 0,
      summary: null,
    });
    const attend = { ...beforeDue, commandId: randomUUID() };
    const miss = { ...attend, commandId: randomUUID(), operation: 'miss' as const };
    const raced = await Promise.allSettled([
      repo.respondToInvitation(session, attend),
      repo.respondToInvitation(session, miss),
    ]);
    assert.equal(raced.filter((item) => item.status === 'fulfilled').length, 1);
    const winner = raced.find((item) => item.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof repo.respondToInvitation>>
    >;
    const expectedStatus = winner.value.appointments[0]?.status;
    assert.ok(expectedStatus === 'attended' || expectedStatus === 'missed');
    await db.close();
    db = new PostgresDatabase(url);
    repo = new PostgresWorldRepository(db);
    const recovered = await repo.get(session, worldId);
    assert.equal(recovered.appointments[0]?.status, expectedStatus);
    assert.equal(buildAgenda(recovered)[0]?.kind, 'appointment_result');
    await assert.rejects(repo.get({ userId: randomUUID() }, worldId), { code: 'NOT_FOUND' });
    assert.deepEqual(
      await repo.respondToInvitation(session, expectedStatus === 'attended' ? attend : miss),
      winner.value,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM parallel_life.world_events WHERE world_id=$1 AND payload->>'type'='invitation.responded'",
          [worldId],
        )
      ).rows[0].n,
      2,
    );
    const replyCommandId = randomUUID(),
      replyEventId = randomUUID();
    const afterReply = await repo.commit(
      session,
      {
        id: replyCommandId,
        worldId,
        actorId,
        origin: 'director',
        text: '承接已记录的赴约结果',
        expectedVersion: recovered.version,
      },
      {
        schemaVersion: 1,
        id: replyEventId,
        worldId,
        commandId: replyCommandId,
        version: recovered.version + 1,
        occurredAt: new Date().toISOString(),
        storyAt: recovered.time,
        type: 'turn.resolved',
        data: {
          actorId,
          userText: '承接已记录的赴约结果',
          origin: 'director',
          effects: [
            { type: 'message.received', id: randomUUID(), actorId, text: '那次约定后来怎么样？' },
          ],
        },
      },
    );
    assert.deepEqual(buildAgenda(afterReply.state), []);
    assert.deepEqual(buildAgenda(await repo.get(session, worldId)), []);
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [ownerId]);
    await admin.end();
  }
});
