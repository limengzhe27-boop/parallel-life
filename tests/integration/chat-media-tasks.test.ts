import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig } from '../../scripts/local-config.mjs';
import { adminClient } from '../../scripts/db-admin.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { PostgresDatabase } from '../../src/modules/storage/infrastructure/postgres.ts';
import { PostgresWorldRepository } from '../../src/modules/world/infrastructure/postgres-world-repository.ts';
import { PostgresOutbox } from '../../src/modules/tasks/infrastructure/postgres-outbox.ts';
import { dispatchOutbox } from '../../src/modules/tasks/application/dispatch-outbox.ts';

/**
 * AUD-03 acceptance for the media side: a committed turn that asks for a picture
 * must produce an outbox job, that job must be dispatched into a media task exactly
 * once, and a repeated drain must not queue it twice.
 */
test('committed chat automatically executes only its own queued media task without paid retries', async () => {
  const admin = await adminClient('parallel_life_test');
  await migrate(admin);
  const c = await localConfig();
  const db = new PostgresDatabase(
    `postgresql://pl_app:${c.appPassword}@127.0.0.1:${c.port}/parallel_life_test`,
  );
  const worlds = new PostgresWorldRepository(db);
  const owner = randomUUID(),
    worldId = randomUUID(),
    actorId = randomUUID();
  const session = { userId: owner },
    time = '2026-09-24T00:00:00.000Z';
  try {
    await admin.query('INSERT INTO parallel_life.accounts(id) VALUES($1)', [owner]);
    await worlds.initialize(session, {
      schemaVersion: 1,
      id: worldId,
      ownerId: owner,
      version: 0,
      title: 'outbox 测试',
      time,
      actors: [{ id: actorId, name: '合成人物', persona: '合成' }],
      facts: [],
      messages: [],
      appointments: [],
      mediaRequests: [],
    });
    const command = {
      id: randomUUID(),
      worldId,
      actorId,
      text: '给我发张窗外的照片',
      expectedVersion: 0,
    };
    await worlds.commit(session, command, {
      schemaVersion: 1,
      id: randomUUID(),
      worldId,
      commandId: command.id,
      version: 1,
      occurredAt: time,
      type: 'turn.resolved',
      data: {
        actorId,
        userText: command.text,
        effects: [
          { type: 'message.received', id: randomUUID(), actorId, text: '好，我看看。' },
          /* 真实形态是效果作用域文本 id，历史上被误当 uuid 校验 */
          { type: 'media.requested', id: `${randomUUID()}_effect_1`, prompt: '窗外的雨' },
        ],
      },
    });

    const eventId = (
      await admin.query(
        'SELECT id FROM parallel_life.world_events WHERE world_id=$1 AND version=1',
        [worldId],
      )
    ).rows[0].id;
    // The after callback must dispatch its own original outbox; no preceding global drain.
    const foreignEvent = randomUUID();
    const unrelated = {
      ...command,
      id: randomUUID(),
      expectedVersion: 1,
      text: 'unrelated later turn',
    };
    await worlds.commit(session, unrelated, {
      schemaVersion: 1,
      id: foreignEvent,
      worldId,
      commandId: unrelated.id,
      version: 2,
      occurredAt: time,
      type: 'turn.resolved',
      data: {
        actorId,
        userText: unrelated.text,
        effects: [{ type: 'message.received', id: randomUUID(), actorId, text: 'unrelated reply' }],
      },
    });
    for (let i = 0; i < 24; i++)
      await admin.query(
        `INSERT INTO parallel_life.outbox_jobs(id,owner_id,world_id,event_id,payload,created_at) VALUES($1,$2,$3,$4,$5,now()-interval '1 day')`,
        [
          randomUUID(),
          owner,
          worldId,
          foreignEvent,
          {
            id: randomUUID(),
            eventId: foreignEvent,
            worldId,
            type: 'image.generate',
            requestId: randomUUID(),
            prompt: 'unrelated backlog',
          },
        ],
      );
    const { runCommittedChatMedia } = await import('../../src/server/chat-media-tasks.ts');
    const executed: string[] = [];
    const run = async (actualOwner: string, taskId: string) => {
      assert.equal(actualOwner, owner);
      executed.push(taskId);
      await admin.query("UPDATE parallel_life.tasks SET status='succeeded' WHERE id=$1", [taskId]);
    };
    await runCommittedChatMedia(db, owner, randomUUID(), eventId, run);
    await runCommittedChatMedia(db, owner, worldId, randomUUID(), run);
    assert.equal(executed.length, 0, 'other world or event never executes');
    const denied = await db.transaction(
      randomUUID(),
      async (sql) =>
        (
          await sql.query('SELECT * FROM parallel_life.claim_outbox_event_jobs($1,$2,$3,2,60)', [
            owner,
            worldId,
            eventId,
          ])
        ).rows,
    );
    assert.equal(denied.length, 0, 'caller cannot claim another owner event by supplying its id');
    await runCommittedChatMedia(db, owner, worldId, eventId, run);
    assert.equal(executed.length, 1);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*)::int n FROM parallel_life.outbox_jobs WHERE event_id=$1 AND status='queued'",
          [foreignEvent],
        )
      ).rows[0].n,
      24,
      'unrelated owner backlog untouched',
    );
    await runCommittedChatMedia(db, owner, worldId, eventId, run);
    assert.equal(executed.length, 1, 'terminal task is not retried');
    await admin.query("UPDATE parallel_life.tasks SET status='unknown' WHERE id=$1", [executed[0]]);
    await runCommittedChatMedia(db, owner, worldId, eventId, run);
    assert.equal(executed.length, 1, 'unknown paid task is never retried');
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
