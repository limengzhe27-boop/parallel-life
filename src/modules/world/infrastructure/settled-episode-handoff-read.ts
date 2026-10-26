import type { SqlClient } from '../../storage/infrastructure/postgres.ts';

/** A consumed quiet consideration is not a presented/finished episode. It only
 * releases scheduling capacity for OTHER, still-unassessed catalogue entries. */
export async function readSettledUnpresentedHandoffs(
  sql: SqlClient,
  owner: string,
  frame: { worldId: string; engineEpoch: number; worldVersion: number },
) {
  const rows = (
    await sql.query(
      `
    SELECT ep.id, jsonb_agg(jsonb_build_object('id',er.id,'version',er.world_version) ORDER BY er.id) receipts
    FROM parallel_life.shared_episodes ep
    JOIN parallel_life.director_decisions d ON d.world_id=ep.world_id AND d.owner_id=ep.owner_id AND d.id=ep.origin_decision_id AND d.engine_epoch=$3
    JOIN parallel_life.agent_episode_requests q ON q.world_id=ep.world_id AND q.owner_id=ep.owner_id AND q.episode_id=ep.id AND q.origin_decision_id=d.id AND q.engine_epoch=$3
    LEFT JOIN parallel_life.agent_episode_receipts er ON er.world_id=q.world_id AND er.owner_id=q.owner_id AND er.id=q.receipt_id AND er.request_id=q.id AND er.actor_id=q.actor_id AND er.episode_id=q.episode_id AND er.input_receipt_id=q.input_receipt_id
    LEFT JOIN parallel_life.agent_attempts a ON a.world_id=er.world_id AND a.owner_id=er.owner_id AND a.id=er.attempt_id AND a.actor_id=er.actor_id AND a.engine_epoch=$3 AND a.input_receipt_id=er.input_receipt_id AND a.status='committed' AND a.event_id=er.source_event_id
    LEFT JOIN parallel_life.world_events e ON e.world_id=er.world_id AND e.owner_id=er.owner_id AND e.id=er.source_event_id AND e.version=er.world_version
    LEFT JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    WHERE ep.world_id=$1 AND ep.owner_id=$2 AND ep.document->>'status'='proposed'
      AND NOT EXISTS (SELECT 1 FROM parallel_life.agent_attempts pending WHERE pending.world_id=ep.world_id AND pending.owner_id=ep.owner_id AND pending.actor_id=q.actor_id AND pending.engine_epoch=$3 AND pending.status IN ('reserved','request_sent','response_received','unknown_after_send'))
      AND NOT EXISTS (SELECT 1 FROM parallel_life.actor_agent_states s WHERE s.world_id=q.world_id AND s.owner_id=q.owner_id AND s.actor_id=q.actor_id AND (
        EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.document->'goals','[]')) g WHERE g->>'status' NOT IN ('fulfilled','withdrawn','expired')) OR
        EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.document->'plans','[]')) p WHERE p->>'status' NOT IN ('finished','withdrawn')) OR
        EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.document->'responsibilities','[]')) r WHERE r->>'status' IN ('open','waiting','deferred')) OR
        EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.document->'actions','[]')) a WHERE a->>'status' IN ('proposed','ready','running','waiting')) OR
        EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.document->'questions','[]')) question WHERE question->>'status'='open' AND question->>'sourceId'='episode-intent:' || q.id)
      ))
    GROUP BY ep.id,ep.document
    HAVING count(DISTINCT q.actor_id)=jsonb_array_length(ep.document->'participantActorIds')
      AND bool_and(ep.document->'participantActorIds' ? q.actor_id)
      AND bool_and(COALESCE(q.status='consumed' AND er.choice='quiet' AND er.presented_message_ids='[]'::jsonb
        AND er.world_version<=$4 AND a.id IS NOT NULL AND e.id IS NOT NULL AND c.id IS NOT NULL
        AND e.payload#>>'{data,agentRuntime,episodeDecision,requestId}'=q.id
        AND e.payload#>>'{data,agentRuntime,episodeDecision,choice}'='quiet',false))
    ORDER BY ep.id`,
      [frame.worldId, owner, frame.engineEpoch, frame.worldVersion],
    )
  ).rows;
  return rows.map((r) => ({
    episodeId: String(r.id),
    receipts: r.receipts as { id: string; version: number }[],
  }));
}
