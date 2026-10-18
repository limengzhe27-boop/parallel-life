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
    const ports = new PostgresOutbox(db).ports(owner);
    await dispatchOutbox({ outbox: ports.outbox, tasks: ports.tasks });
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
    await runCommittedChatMedia(db, owner, worldId, eventId, run);
    assert.equal(executed.length, 1);
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
