import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMediaPipelineHandler } from '../../src/modules/media/infrastructure/media-pipeline-handler.ts';
import { PostgresTaskQueue } from '../../src/modules/tasks/infrastructure/postgres-task-queue.ts';
import { adminClient } from '../../scripts/db-admin.mjs';
import { localConfig } from '../../scripts/local-config.mjs';
import type { MediaPipelineService } from '../../src/modules/media/infrastructure/media-pipeline-service.ts';

test('accepted media result stays unknown in request, outbox and task, and replay sends no new request', async () => {
  const config = await localConfig();
  const queue = new PostgresTaskQueue(
    `postgresql://pl_worker:${config.workerPassword}@127.0.0.1:${config.port}/parallel_life_dev`,
  );
  const admin = await adminClient('parallel_life_dev');
  const ownerId = `media_unknown_${randomUUID()}`;
  const worldId = `world_${randomUUID()}`;
  const commandId = randomUUID();
  const eventId = `event_${randomUUID()}`;
  const requestId = `media_${randomUUID()}`;
  const outboxId = `outbox_${randomUUID()}`;
  const taskId = randomUUID();
  let providerCalls = 0;
  const service: Pick<MediaPipelineService, 'executeImagePipeline'> = {
    async executeImagePipeline(params) {
      providerCalls++;
      assert.ok(params.signal);
      throw Object.assign(new Error('submitted response lost'), {
        code: 'STATUS_UNKNOWN',
        providerTaskId: 'provider-known-1',
      });
    },
  };
  const handler = createMediaPipelineHandler(queue, service as MediaPipelineService);
  try {
    await admin.query("INSERT INTO parallel_life.accounts(id,kind) VALUES($1,'guest')", [ownerId]);
    await admin.query(
      'INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES($1,$2,$3,$4)',
      [worldId, ownerId, 'test', { id: worldId, ownerId, status: 'active' }],
    );
    await admin.query(
      "INSERT INTO parallel_life.commands(id,world_id,owner_id,expected_version,request_hash,request_payload,status) VALUES($1,$2,$3,0,$4,'{}','queued')",
      [commandId, worldId, ownerId, `hash_${commandId}`],
    );
    await admin.query(
      "INSERT INTO parallel_life.world_events(id,world_id,owner_id,version,command_id,payload,occurred_at) VALUES($1,$2,$3,1,$4,'{}',now())",
      [eventId, worldId, ownerId, commandId],
    );
    await admin.query(
      "INSERT INTO parallel_life.outbox_jobs(id,world_id,owner_id,event_id,payload,status) VALUES($1,$2,$3,$4,$5,'submitted')",
      [outboxId, worldId, ownerId, eventId, { requestId }],
    );
    await admin.query(
      'INSERT INTO parallel_life.world_media_requests(id,world_id,owner_id,document) VALUES($1,$2,$3,$4)',
      [
        requestId,
        worldId,
        ownerId,
        {
          id: requestId,
          worldId,
          status: 'submitting',
          prompt: '雨后街道',
          sourceEventId: eventId,
        },
      ],
    );
    await admin.query(
      "INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input,status) VALUES($1,$2,'media',$3,$4,$5,$6,'queued')",
      [taskId, ownerId, requestId, randomUUID(), 'media-unknown', { requestId }],
    );
    const lease = await queue.claimForOwner(taskId, ownerId, ['media']);
    assert.ok(lease);
    await assert.rejects(handler(lease, new AbortController().signal), { code: 'UPSTREAM_FAILED' });
    await queue.finish(lease, { status: 'unknown', errorCode: 'UNKNOWN' });

    const request = (
      await admin.query('SELECT document FROM parallel_life.world_media_requests WHERE id=$1', [
        requestId,
      ])
    ).rows[0].document;
    const outbox = (
      await admin.query('SELECT status FROM parallel_life.outbox_jobs WHERE id=$1', [outboxId])
    ).rows[0];
    const task = (await admin.query('SELECT status FROM parallel_life.tasks WHERE id=$1', [taskId]))
      .rows[0];
    assert.equal(request.status, 'unknown');
    assert.equal(request.errorCode, 'STATUS_UNKNOWN');
    assert.equal(request.providerTaskId, 'provider-known-1');
    assert.equal(outbox.status, 'unknown');
    assert.equal(task.status, 'unknown');
    assert.equal(providerCalls, 1);

    const replayTask = randomUUID();
    await admin.query(
      "INSERT INTO parallel_life.tasks(id,owner_id,scope_kind,scope_id,command_id,request_hash,input,status) VALUES($1,$2,'media',$3,$4,$5,$6,'queued')",
      [replayTask, ownerId, requestId, randomUUID(), 'media-replay', { requestId }],
    );
    const replay = await queue.claimForOwner(replayTask, ownerId, ['media']);
    assert.ok(replay);
    await assert.rejects(handler(replay, new AbortController().signal), {
      code: 'UPSTREAM_FAILED',
    });
    await queue.finish(replay, { status: 'unknown', errorCode: 'UNKNOWN' });
    assert.equal(providerCalls, 1);
  } finally {
    await admin.query('DELETE FROM parallel_life.accounts WHERE id=$1', [ownerId]);
    await admin.end();
    await queue.close();
  }
});
