import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import type { WorldState, WorldEvent, TurnCommand } from '../../src/modules/world/domain/types.ts';
test('real world commit: concurrency, original receipt, compact projections, restart and transaction rollback', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig(),
    url = `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`;
  let db = new PostgresDatabase(url);
  let repo = new PostgresWorldRepository(db);
  const userId = randomUUID(),
    id = randomUUID(),
    session = { userId },
    at = new Date().toISOString();
  const state: WorldState = {
    schemaVersion: 1,
    id,
    ownerId: userId,
    version: 0,
    title: '数据库测试',
    time: at,
    actors: [{ id: 'friend', name: '朋友', persona: '朋友' }],
    facts: [],
    messages: [],
    appointments: [],
    mediaRequests: [],
  };
  const command = (version: number): TurnCommand => ({
    id: randomUUID(),
    worldId: id,
    expectedVersion: version,
    actorId: 'friend',
    text: '你好',
  });
  const event = (cmd: TurnCommand): WorldEvent => ({
    schemaVersion: 1,
    id: randomUUID(),
    worldId: id,
    version: cmd.expectedVersion + 1,
    commandId: cmd.id,
    type: 'turn.resolved',
    occurredAt: at,
    data: {
      actorId: 'friend',
      userText: cmd.text,
      effects: [
        { type: 'message.received', id: randomUUID(), actorId: 'friend', text: '你好呀' },
        { type: 'media.requested', id: randomUUID(), prompt: '测试照片' },
        { type: 'belief.recorded', id: randomUUID(), actorId: 'friend', text: '我觉得会成功' },
        {
          type: 'appointment.proposed',
          id: randomUUID(),
          title: '聊聊',
          at,
          participantIds: ['friend'],
        },
      ],
    },
  });
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [userId]);
    await repo.initialize(session, state);
    const c1 = command(0),
      c2 = command(0),
      e1 = event(c1),
      e2 = event(c2);
    const results = await Promise.allSettled([
      repo.commit(session, c1, e1),
      repo.commit(session, c2, e2),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const winner = results[0]!.status === 'fulfilled' ? c1 : c2;
    const first = await repo.receipt(session, winner);
    assert(first);
    const next = command(1);
    await repo.commit(session, next, event(next));
    assert.deepEqual(await repo.receipt(session, winner), first);
    await assert.rejects(repo.receipt({ userId: randomUUID() }, winner), { code: 'NOT_FOUND' });
    await assert.rejects(repo.receipt(session, { ...winner, text: 'changed' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await db.close();
    db = new PostgresDatabase(url);
    repo = new PostgresWorldRepository(db);
    const restored = await repo.get(session, id);
    assert.equal(restored.messages.length, 4);
    assert.equal(restored.appointments.length, 2);
    assert.ok(restored.appointments.every((a) => a.status === 'proposed'));
    assert.ok(restored.facts.every((f) => f.kind === 'belief' && f.believedByActorId === 'friend'));
    const legacy = command(2),
      legacyEvent = event(legacy);
    legacyEvent.data.effects[3] = {
      type: 'appointment.created',
      id: randomUUID(),
      title: '偷偷确认',
      at,
      participantIds: ['friend'],
    };
    await assert.rejects(repo.commit(session, legacy, legacyEvent), { code: 'INVALID_PROPOSAL' });
    assert.equal((await repo.get(session, id)).version, 2);
    const stored = (await admin.query('SELECT state FROM parallel_life.worlds WHERE id=$1', [id]))
      .rows[0].state;
    assert.deepEqual(stored.messages, []);
    // SQL failure after reducer success must roll back prior event/projection writes.
    const bad = command(2),
      badEvent = event(bad),
      collision = `${badEvent.id}_${badEvent.data.effects[1]!.id}`;
    await admin.query(
      'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
      [collision, id, userId, first.event.id, {}],
    );
    await assert.rejects(repo.commit(session, bad, badEvent), { code: '23505' });
    assert.equal((await repo.get(session, id)).version, 2);
    await admin.query('DELETE FROM parallel_life.outbox_jobs WHERE id=$1', [collision]);
    assert.equal(
      (await admin.query('SELECT 1 FROM parallel_life.outbox_jobs WHERE world_id=$1', [id]))
        .rowCount,
      2,
    );
    assert.equal(
      (await admin.query('SELECT 1 FROM parallel_life.commands WHERE world_id=$1', [id])).rowCount,
      2,
    );
    const choiceCommand = { ...command(2), text: '我决定先把短片剪到十五分钟。' };
    const choiceEvent = event(choiceCommand);
    choiceEvent.data.effects = [
      { type: 'message.received', id: randomUUID(), actorId: 'friend', text: '好，剪完发我。' },
      {
        type: 'choice.recorded',
        id: randomUUID(),
        quote: '我决定先把短片剪到十五分钟',
        intent: '完成十五分钟版本',
      },
    ];
    const chosen = await repo.commit(session, choiceCommand, choiceEvent);
    assert.equal(chosen.state.choices?.[0]?.sourceEventId, choiceEvent.id);
    assert.equal(chosen.state.choices?.[0]?.status, 'pending');
    assert.deepEqual(
      (await repo.receipt(session, choiceCommand))?.state.choices,
      chosen.state.choices,
    );
    await db.close();
    db = new PostgresDatabase(url);
    repo = new PostgresWorldRepository(db);
    assert.deepEqual((await repo.get(session, id)).choices, chosen.state.choices);
    await assert.rejects(repo.get({ userId: randomUUID() }, id), { code: 'NOT_FOUND' });
    const followCommand = {
      ...command(3),
      origin: 'director' as const,
      text: '承接用户的剪片决定',
    };
    const followEvent = event(followCommand);
    followEvent.data.origin = 'director';
    followEvent.data.effects = [
      {
        type: 'message.received',
        id: randomUUID(),
        actorId: 'friend',
        text: '我留了时间，发来就看。',
      },
    ];
    const followed = await repo.commit(session, followCommand, followEvent);
    assert.equal(followed.state.choices?.[0]?.status, 'followed_up');
    assert.equal((await repo.get(session, id)).choices?.[0]?.followUpEventId, followEvent.id);
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [userId]);
    await admin.end();
  }
});
