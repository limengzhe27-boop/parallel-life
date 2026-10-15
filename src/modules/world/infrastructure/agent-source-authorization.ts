import type { SqlClient } from '../../storage/infrastructure/postgres.ts';

/** Private NPC source lineage. Recall ranking must never limit forgetting authorization. */
export async function forgottenAgentSourceIds(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  actorId: string,
): Promise<Set<string>> {
  const rows = (
    await sql.query(
      `SELECT id,source_ids FROM parallel_life.memory_records WHERE owner_id=$1 AND status='forgotten'
    AND ((scope_type='character' AND character_id=$2 AND (branch_id=$3 OR branch_id IS NULL))
      OR (scope_type='branch' AND scope_id=$3 AND kind<>'episode'))`,
      [ownerId, actorId, worldId],
    )
  ).rows;
  const blocked = new Set<string>(
    rows.flatMap((row) => [
      `memory:${row.id}`,
      ...(Array.isArray(row.source_ids) ? row.source_ids : []),
    ]),
  );
  if (!blocked.size) return blocked;
  const aliases = (
    await sql.query(
      `SELECT e.id,e.payload->'data'->'agentRuntime'->>'inputReceiptId' AS input_id FROM parallel_life.world_events e
    WHERE e.world_id=$1 AND e.owner_id=$2 AND e.payload->'data'->>'actorId'=$3
      AND (e.id=ANY($4::text[]) OR e.payload->'data'->'agentRuntime'->>'inputReceiptId'=ANY($4::text[])
        OR EXISTS(SELECT 1 FROM parallel_life.world_messages m WHERE m.world_id=e.world_id AND m.owner_id=e.owner_id AND m.actor_id=$3 AND m.document->>'sourceEventId'=e.id AND m.id=ANY($4::text[])))`,
      [worldId, ownerId, actorId, [...blocked]],
    )
  ).rows;
  for (const row of aliases) {
    blocked.add(String(row.id));
    if (row.input_id) blocked.add(String(row.input_id));
  }
  return blocked;
}
