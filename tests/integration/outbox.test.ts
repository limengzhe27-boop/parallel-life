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
test('a committed image request is dispatched from the outbox into exactly one media task', async () => {
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

    const jobs = (
      await admin.query(
        'SELECT id, status, payload->>$$type$$ AS type FROM parallel_life.outbox_jobs WHERE world_id=$1',
        [worldId],
      )
    ).rows;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].type, 'image.generate');
    assert.equal(jobs[0].status, 'queued');

    const ports = new PostgresOutbox(db).ports(owner);
    const first = await dispatchOutbox({ outbox: ports.outbox, tasks: ports.tasks });
    assert.deepEqual(first, { claimed: 1, submitted: 1, rejected: 0, requeued: 0 });

    const tasks = (
      await admin.query(
        'SELECT id, scope_kind, scope_id, status FROM parallel_life.tasks WHERE owner_id=$1',
        [owner],
      )
    ).rows;
    assert.equal(tasks.length, 1, 'exactly one media task');
    assert.equal(tasks[0].scope_kind, 'media');
    assert.equal(tasks[0].status, 'queued');
    const job = (
      await admin.query(
        'SELECT status, provider_task_id FROM parallel_life.outbox_jobs WHERE id=$1',
        [jobs[0].id],
      )
    ).rows[0];
    assert.equal(job.status, 'submitted');
    assert.equal(job.provider_task_id, tasks[0].id);

    /* A second drain must not queue the same work again. */
    const second = await dispatchOutbox({ outbox: ports.outbox, tasks: ports.tasks });
    assert.deepEqual(second, { claimed: 0, submitted: 0, rejected: 0, requeued: 0 });
    assert.equal(
      (
        await admin.query('SELECT count(*)::int AS n FROM parallel_life.tasks WHERE owner_id=$1', [
          owner,
        ])
      ).rows[0].n,
      1,
    );

    /* A job whose type has no executor fails loudly instead of being retried forever. */
    await admin.query(
      'INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload) VALUES($1,$2,$3,$4,$5)',
      [
        'unknown-1',
        worldId,
        owner,
        (
          await admin.query('SELECT id FROM parallel_life.world_events WHERE world_id=$1 LIMIT 1', [
            worldId,
          ])
        ).rows[0].id,
        { id: 'unknown-1', eventId: 'e', worldId, type: 'video.generate' },
      ],
    );
    const third = await dispatchOutbox({ outbox: ports.outbox, tasks: ports.tasks });
    assert.equal(third.rejected, 1);
    const rejected = (
      await admin.query('SELECT status, last_error FROM parallel_life.outbox_jobs WHERE id=$1', [
        'unknown-1',
      ])
    ).rows[0];
    assert.equal(rejected.status, 'failed');
    assert.match(rejected.last_error, /NO_EXECUTOR/);
    /* Owner isolation: another session cannot claim it. */
    const other = new PostgresOutbox(db).ports(randomUUID());
    assert.deepEqual(await dispatchOutbox({ outbox: other.outbox, tasks: other.tasks }), {
      claimed: 0,
      submitted: 0,
      rejected: 0,
      requeued: 0,
    });
  } finally {
    await db.close();
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [owner]);
    await admin.end();
  }
});
