import { randomUUID } from 'node:crypto';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentInputReceipt } from '../domain/agent-runtime.ts';
import { requireActiveAgentDeliveryInTransaction } from './agent-delivery-activity.ts';

const fail = (code: string): never => {
  throw Object.assign(Error(code), { code });
};
/** Called only under the original world and attempt locks. No new command/input or paid retry. */
export async function resumeCancelledAgentAttemptInTransaction(
  sql: SqlClient,
  ownerId: string,
  row: any,
  requireAuthority: (
    sql: SqlClient,
    owner: string,
    receipt: AgentInputReceipt,
    actorId: string,
    worldVersion: number,
  ) => Promise<void>,
) {
  if (
    row.status !== 'cancelled_before_send' ||
    row.sent_at !== null ||
    row.response_hash !== null ||
    row.response !== null ||
    row.event_id !== null
  )
    fail('ATTEMPT_STALE');
  const actual = (
    await sql.query(
      `SELECT w.version,c.engine_epoch,s.revision FROM parallel_life.worlds w
     JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
     JOIN parallel_life.actor_agent_states s ON s.world_id=w.id AND s.owner_id=w.owner_id AND s.actor_id=$3
     WHERE w.id=$1 AND w.owner_id=$2`,
      [row.world_id, ownerId, row.actor_id],
    )
  ).rows[0];
  if (!actual || actual.engine_epoch !== row.engine_epoch || actual.engine_epoch < 2)
    fail('ENGINE_EPOCH_CONFLICT');
  if (actual.version !== row.expected_world_version) fail('VERSION_CONFLICT');
  if (actual.revision !== row.expected_actor_revision) fail('AGENT_REVISION_CONFLICT');
  const input = (
    await sql.query(
      'SELECT document FROM parallel_life.agent_input_receipts WHERE world_id=$1 AND owner_id=$2 AND id=$3',
      [row.world_id, ownerId, row.input_receipt_id],
    )
  ).rows[0]?.document as AgentInputReceipt | undefined;
  if (!input || input.inputHash !== row.input_hash) fail('INPUT_SCOPE_FORBIDDEN');
  await requireAuthority(sql, ownerId, input!, row.actor_id, row.expected_world_version);
  await requireActiveAgentDeliveryInTransaction(
    sql,
    ownerId,
    row.world_id,
    'NPC_DELIVERY_DEFERRED',
  );
  const busy = await sql.query(
    "SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=$1 AND owner_id=$2 AND actor_id=$3 AND id<>$4 AND status IN ('reserved','request_sent','response_received','unknown_after_send')",
    [row.world_id, ownerId, row.actor_id, row.id],
  );
  if (busy.rowCount) fail('ATTEMPT_PENDING');
  const token = randomUUID();
  const until = (
    await sql.query(
      "SELECT GREATEST(clock_timestamp()+interval '4 minutes',$1::timestamptz+interval '1 millisecond') AS until",
      [row.lease_until],
    )
  ).rows[0].until;
  await sql.query(
    `INSERT INTO parallel_life.agent_zero_send_recoveries(id,owner_id,world_id,attempt_id,input_hash,prior_token,next_token,prior_lease_until,next_lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      ownerId,
      row.world_id,
      row.id,
      row.input_hash,
      row.token,
      token,
      row.lease_until,
      until,
    ],
  );
  const resumed = (
    await sql.query(
      "UPDATE parallel_life.agent_attempts SET status='reserved',token=$2,lease_until=$3,updated_at=now() WHERE id=$1 RETURNING *",
      [row.id, token, until],
    )
  ).rows[0];
  await requireActiveAgentDeliveryInTransaction(
    sql,
    ownerId,
    row.world_id,
    'NPC_DELIVERY_DEFERRED',
  );
  return resumed;
}
