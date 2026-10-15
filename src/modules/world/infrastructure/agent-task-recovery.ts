import { randomUUID } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentInputReceipt } from '../domain/agent-runtime.ts';
import { nativeAgentCommandId } from './agent-native-ids.ts';
import { requireInputAuthority } from './agent-runtime-repository.ts';

function fail(code: string): never {
  throw Object.assign(Error(code), { code });
}

/** Called under the account lock, in the existing task retry transaction. No model or new task. */
export async function recoverAgentTaskInTransaction(
  sql: SqlClient,
  ownerId: string,
  taskId: string,
  commandId: string,
): Promise<Record<string, unknown> | null> {
  const task = (
    await sql.query('SELECT * FROM parallel_life.tasks WHERE id=$1 AND owner_id=$2 FOR UPDATE', [
      taskId,
      ownerId,
    ])
  ).rows[0];
  if (!task) fail('NOT_FOUND');
  if (task.scope_kind !== 'world') return null;
  const world = (
    await sql.query(
      'SELECT version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [task.scope_id, ownerId],
    )
  ).rows[0];
  if (!world) fail('NOT_FOUND');
  const control = (
    await sql.query(
      'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2 FOR SHARE',
      [task.scope_id, ownerId],
    )
  ).rows[0];
  if (Number(control?.engine_epoch ?? 1) < 2) return null;
  const replay = (
    await sql.query(
      'SELECT task_id FROM parallel_life.agent_task_recoveries WHERE owner_id=$1 AND command_id=$2',
      [ownerId, commandId],
    )
  ).rows[0];
  if (replay) {
    if (replay.task_id !== taskId) fail('IDEMPOTENCY_CONFLICT');
    return task;
  }
  if (
    (
      await sql.query('SELECT 1 FROM parallel_life.tasks WHERE owner_id=$1 AND command_id=$2', [
        ownerId,
        commandId,
      ])
    ).rowCount
  )
    fail('IDEMPOTENCY_CONFLICT');
  if (!['failed', 'unknown', 'cancelled', 'conflict'].includes(task.status))
    fail('VERSION_CONFLICT');
  const actors = Array.isArray(world.state.actors) ? world.state.actors : [];
  const attempts = (
    await sql.query(
      'SELECT * FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND command_id=ANY($3::text[]) FOR UPDATE',
      [
        task.scope_id,
        ownerId,
        actors.map((a: { id: string }) => nativeAgentCommandId(taskId, a.id)),
      ],
    )
  ).rows;
  // No completion is not permission to launch a replacement request. Environment tasks
  // and failures before claim need their own deterministic re-preparation, not an NPC retry.
  if (attempts.length !== 1) fail('INVALID_COMMAND');
  const attempt = attempts[0];
  if (['reserved', 'request_sent', 'unknown_after_send'].includes(attempt.status)) fail('UNKNOWN');
  if (attempt.status !== 'response_received' || !attempt.response_hash || !attempt.response)
    fail('INVALID_COMMAND');
  const receipt = (
    await sql.query(
      'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=$3',
      [task.scope_id, ownerId, attempt.input_receipt_id],
    )
  ).rows[0]?.document as AgentInputReceipt | undefined;
  const envelope = attempt.response;
  if (
    !receipt ||
    receipt.inputHash !== attempt.input_hash ||
    envelope.kind !== 'npc_agent_completion' ||
    envelope.schemaVersion !== 1 ||
    envelope.snapshot?.worldVersion !== attempt.expected_world_version ||
    envelope.snapshot?.state?.worldId !== task.scope_id ||
    envelope.snapshot?.state?.actorId !== attempt.actor_id ||
    envelope.snapshot?.state?.revision !== attempt.expected_actor_revision ||
    envelope.snapshot?.input?.sourceId !== receipt.id
  )
    fail('INVALID_COMMAND');
  const source = (
    await sql.query(
      `SELECT e.id FROM parallel_life.world_events e JOIN parallel_life.commands c
      ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
      WHERE e.world_id=$1 AND e.owner_id=$2 AND e.command_id=$3 AND e.version=$4
      AND ((e.id=$5 AND e.payload->>'type'='group.message_sent' AND $6='group') OR
        ($6='scene' AND EXISTS(SELECT 1 FROM parallel_life.scene_items i WHERE i.world_id=e.world_id AND i.owner_id=e.owner_id AND i.id=$7 AND i.source_event_id=e.id)))`,
      [
        task.scope_id,
        ownerId,
        receipt.commandId,
        receipt.expectedWorldVersion,
        task.input.inputEventId ?? null,
        receipt.channel,
        task.input.actionId ?? null,
      ],
    )
  ).rows[0];
  const nativeMatches =
    receipt.expectedWorldVersion === task.input.expectedVersion &&
    ((receipt.channel === 'group' &&
      task.input.channel === 'group' &&
      receipt.threadId === task.input.groupId) ||
      (receipt.channel === 'scene' &&
        task.input.type === 'scene' &&
        receipt.threadId === task.input.sceneId));
  if (!source || !nativeMatches) fail('INVALID_COMMAND');
  const actor = (
    await sql.query(
      'SELECT revision FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 FOR UPDATE',
      [task.scope_id, ownerId, attempt.actor_id],
    )
  ).rows[0];
  let staleReason =
    world.version !== attempt.expected_world_version
      ? 'world_changed'
      : Number(control.engine_epoch) !== attempt.engine_epoch
        ? 'engine_changed'
        : actor?.revision !== attempt.expected_actor_revision
          ? 'actor_changed'
          : null;
  if (!staleReason) {
    try {
      await requireInputAuthority(sql, ownerId, receipt, attempt.actor_id, world.version);
    } catch (error) {
      if ((error as { code?: string }).code !== 'INPUT_SCOPE_FORBIDDEN') throw error;
      staleReason = 'source_no_longer_authorized';
    }
  }
  if (staleReason) {
    await sql.query(
      `INSERT INTO parallel_life.agent_task_recoveries(owner_id,command_id,world_id,task_id,attempt_id,input_hash,prior_token,prior_lease_until,outcome,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'stale',$9)`,
      [
        ownerId,
        commandId,
        task.scope_id,
        taskId,
        attempt.id,
        attempt.input_hash,
        attempt.token,
        attempt.lease_until,
        staleReason,
      ],
    );
    await sql.query(
      "UPDATE parallel_life.agent_attempts SET status='stale_discarded',updated_at=now() WHERE id=$1",
      [attempt.id],
    );
    return (
      await sql.query(
        "UPDATE parallel_life.tasks SET status='conflict',error_code='VERSION_CONFLICT',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 RETURNING *",
        [taskId],
      )
    ).rows[0];
  }
  if (
    (
      await sql.query(
        "SELECT 1 FROM parallel_life.tasks WHERE owner_id=$1 AND scope_kind='world' AND scope_id=$2 AND status IN ('queued','running') AND id<>$3",
        [ownerId, task.scope_id, taskId],
      )
    ).rowCount
  )
    fail('BUSY');
  const nextToken = randomUUID();
  const renewed = (
    await sql.query(
      "SELECT GREATEST(clock_timestamp()+interval '4 minutes',$1::timestamptz+interval '1 millisecond') AS until",
      [attempt.lease_until],
    )
  ).rows[0].until;
  await sql.query(
    `INSERT INTO parallel_life.agent_task_recoveries(owner_id,command_id,world_id,task_id,attempt_id,input_hash,prior_token,next_token,prior_lease_until,next_lease_until,outcome,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'requeued','protected_completion')`,
    [
      ownerId,
      commandId,
      task.scope_id,
      taskId,
      attempt.id,
      attempt.input_hash,
      attempt.token,
      nextToken,
      attempt.lease_until,
      renewed,
    ],
  );
  await sql.query(
    'UPDATE parallel_life.agent_attempts SET token=$2,lease_until=$3,updated_at=now() WHERE id=$1',
    [attempt.id, nextToken, renewed],
  );
  return (
    await sql.query(
      "UPDATE parallel_life.tasks SET status='queued',error_code=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 RETURNING *",
      [taskId],
    )
  ).rows[0];
}
