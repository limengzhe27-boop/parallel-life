import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
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
