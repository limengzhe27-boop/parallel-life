import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { questionProgressReason } from '../domain/question-progress-proof.ts';
import type { AuthoredReconsiderationReason } from '../domain/authored-reconsideration.ts';

/** Proof stays bound to original committed attempt, command, input and immutable event. */
export async function readQuestionProgressReasons(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  worldVersion: number,
  missingOnly = false,
): Promise<AuthoredReconsiderationReason[]> {
  const rows = (
    await sql.query(
      `SELECT e.id,e.version,e.payload, a.response->'snapshot'->'state' previous_state, i.document input
    FROM parallel_life.world_events e
    JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    JOIN parallel_life.agent_attempts a ON a.world_id=e.world_id AND a.owner_id=e.owner_id AND a.event_id=e.id AND a.status='committed'
    JOIN parallel_life.agent_input_receipts i ON i.world_id=a.world_id AND i.owner_id=a.owner_id AND i.id=a.input_receipt_id
    LEFT JOIN parallel_life.director_pending_reasons r ON r.world_id=e.world_id AND r.owner_id=e.owner_id AND r.id=e.id||':cross_impact:'||e.id AND r.source_event_id=e.id AND r.source_version=e.version
    LEFT JOIN parallel_life.director_observed_states d ON d.world_id=e.world_id AND d.owner_id=e.owner_id
    WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$3
      AND jsonb_typeof(e.payload#>'{data,agentRuntime,questionChanges}')='array'
      AND jsonb_array_length(e.payload#>'{data,agentRuntime,questionChanges}')>0
      AND (($4 AND r.id IS NULL AND e.version>COALESCE(d.evaluated_through_version,0)) OR (NOT $4 AND r.id IS NOT NULL))
    ORDER BY e.version DESC LIMIT 64`,
      [worldId, ownerId, worldVersion, missingOnly],
    )
  ).rows;
  return rows.flatMap((row) => {
    const event = row.payload;
    if (
      event.worldId !== worldId ||
      event.version > worldVersion ||
      event.id !== row.id ||
      event.version !== row.version
    )
      return [];
    const reason = questionProgressReason(event, row.previous_state, row.input);
    return reason ? [reason] : [];
  });
}

/** Explicit mutation before advance; context reads never repair projections as a side effect. */
export async function repairQuestionProgressReasonsInTransaction(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  worldVersion: number,
): Promise<number> {
  await sql.query(
    'SELECT version FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
    [worldId, ownerId],
  );
  await sql.query(
    'SELECT evaluated_through_version FROM parallel_life.director_observed_states WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
    [worldId, ownerId],
  );
  const reasons = await readQuestionProgressReasons(sql, ownerId, worldId, worldVersion, true);
  let count = 0;
  for (const reason of reasons) {
    const { actorId: _actorId, ...document } = reason;
    const result = await sql.query(
      `INSERT INTO parallel_life.director_pending_reasons(world_id,owner_id,id,source_event_id,source_version,document)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [worldId, ownerId, reason.id, reason.eventId, reason.worldVersion, document],
    );
    count += result.rowCount ?? 0;
  }
  return count;
}
