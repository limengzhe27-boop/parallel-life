import type { SqlClient } from '../../storage/infrastructure/postgres.ts';

/** Repair a materially incomplete opening assessment with real subsequent player speech.
 * First contact per actor is stable; time, refresh and repeated same-actor chatter add nothing.
 * Existing paid failures/unknowns are never reclassified or retried here.
 */
export async function readOpeningReviewEvidence(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  engineEpoch: number,
  worldVersion: number,
  openingActorIds: readonly string[],
): Promise<{ sourceId: string; worldVersion: number; actorId: string }[]> {
  if (!openingActorIds.length) return [];
  const prior = (
    await sql.query(
      `SELECT a.response,a.expected_world_version,a.snapshot
     FROM parallel_life.director_runtime_attempts a
     JOIN parallel_life.director_decisions d ON d.world_id=a.world_id AND d.owner_id=a.owner_id
       AND d.id=a.decision_id AND d.input_hash=a.input_hash AND d.attempt_id=a.id
       AND d.engine_epoch=a.engine_epoch AND d.world_version=a.expected_world_version
     WHERE a.world_id=$1 AND a.owner_id=$2 AND a.engine_epoch=$3 AND a.status='committed'
       AND a.snapshot#>>'{evaluationCause,kind}'='authored_eligibility'
       AND jsonb_typeof(a.snapshot->'observations')='array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a.snapshot->'observations') o WHERE o->>'kind'='speech')
     ORDER BY a.created_at,a.id`,
      [worldId, ownerId, engineEpoch],
    )
  ).rows;
  const incomplete = prior.find((a) => {
    let response;
    try {
      response = typeof a.response === 'string' ? JSON.parse(a.response) : a.response;
    } catch {
      return false;
    }
    return (
      response?.mode === 'quiet' &&
      a.snapshot?.evaluationCause?.kind === 'authored_eligibility' &&
      Array.isArray(a.snapshot.observations) &&
      !a.snapshot.observations.some((o: { kind: string }) => o.kind === 'speech')
    );
  });
  if (!incomplete) return [];
  const rows = (
    await sql.query(
      `SELECT DISTINCT ON (m.actor_id) m.id,m.actor_id,e.version
     FROM parallel_life.world_messages m
     JOIN parallel_life.world_events e ON e.world_id=m.world_id AND e.owner_id=m.owner_id
       AND e.id=m.document->>'sourceEventId'
     JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id
       AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
     WHERE m.world_id=$1 AND m.owner_id=$2 AND m.actor_id=ANY($3::text[])
       AND e.version>$4 AND e.version<=$5
       AND e.payload->>'type'='turn.resolved'
       AND e.payload->'data'->>'actorId'=m.actor_id
       AND e.payload->'data'->>'userText'=m.document->>'text'
       AND m.document->>'role'='user' AND m.document->>'id'=m.id
       AND m.document->>'actorId'=m.actor_id AND m.document->'history' IS NULL
       AND COALESCE(e.payload->'data'->>'origin','player')='player'
     ORDER BY m.actor_id,e.version,m.ordinal,m.id`,
      [worldId, ownerId, [...openingActorIds], incomplete.expected_world_version, worldVersion],
    )
  ).rows;
  return rows.map((r) => ({
    sourceId: `message:${r.id}`,
    worldVersion: Number(r.version),
    actorId: String(r.actor_id),
  }));
}
