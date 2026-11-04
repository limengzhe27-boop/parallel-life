import type { ActorAgentState } from '../domain/agent-runtime.ts';
import { hasHandoffFollowup } from './settled-episode-handoff-read.ts';
import { readInvalidAuthoredEpisodeIds } from './authored-episode-scope-read.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import {
  episodeDispatchAttempt,
  episodeRequestWorkState,
} from './agent-episode-dispatch-eligibility.ts';

/** Read-only transport classification; never consumes or retries an episode request. */
export async function hasPendingEpisodeWork(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  engineEpoch: number,
  actorId?: string,
): Promise<boolean> {
  const requests = await sql.query(
    `SELECT id,episode_id FROM parallel_life.agent_episode_requests
     WHERE world_id=$1 AND owner_id=$2 AND engine_epoch=$3 AND status='pending'
     AND ($4::text IS NULL OR actor_id=$4::text)`,
    [worldId, ownerId, engineEpoch, actorId ?? null],
  );
  if (!requests.rowCount) return false;
  const invalid = await readInvalidAuthoredEpisodeIds(
    sql,
    ownerId,
    { worldId, engineEpoch },
    requests.rows.map((r) => String(r.episode_id)),
  );
  const eligible = requests.rows.filter((r) => !invalid.has(String(r.episode_id)));
  if (!eligible.length) return false;
  const attempts = await readEpisodeAttempts(
    sql,
    ownerId,
    worldId,
    engineEpoch,
    actorId,
    eligible.map((r) => String(r.id)),
  );
  return eligible.some((r) => episodeRequestWorkState(r.id, attempts) !== 'paid_terminal');
}

async function readEpisodeAttempts(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  engineEpoch: number,
  actorId: string | undefined,
  requestIds: readonly string[],
) {
  // SQL only narrows candidates; legacy text must still pass the existing exact
  // coordination decoder below. Do not fetch unrelated world attempt history.
  const rows = await sql.query(
    `SELECT r.id AS input_receipt_id,a.actor_id,a.command_id,a.status,a.sent_at,a.response_hash,(a.lease_until<=clock_timestamp()) AS lease_expired,(a.response IS NOT NULL) AS has_response,(a.event_id IS NOT NULL) AS has_event,b.request_id AS bound_request_id,r.document
     FROM parallel_life.agent_attempts a JOIN parallel_life.agent_input_receipts r
     ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=a.input_receipt_id
     LEFT JOIN parallel_life.agent_episode_attempt_bindings b ON b.world_id=a.world_id AND b.owner_id=a.owner_id AND b.attempt_id=a.id
     WHERE a.world_id=$1 AND a.owner_id=$2 AND a.engine_epoch=$3
     AND ($4::text IS NULL OR a.actor_id=$4::text)
     AND (b.request_id=ANY($5::text[]) OR r.id IN (
       SELECT input_receipt_id FROM parallel_life.agent_episode_requests
       WHERE world_id=$1 AND owner_id=$2 AND id=ANY($5::text[]))
       OR (r.document->>'origin'='coordination' AND EXISTS (
         SELECT 1 FROM unnest($5::text[]) requested(id)
         WHERE strpos(r.document->>'text','"'||requested.id||'"')>0)))`,
    [worldId, ownerId, engineEpoch, actorId ?? null, [...requestIds]],
  );
  return rows.rows.map((row) => ({
    ...episodeDispatchAttempt(row),
    inputReceiptId: String(row.input_receipt_id),
  }));
}

/** Failed unperformed transport is history, not an active direction for the director.
 * The original response remains available to its recovery owner; this never settles it.
 */
export async function readTerminalUnperformedEpisodeIds(
  sql: SqlClient,
  owner: string,
  frame: { worldId: string; engineEpoch: number },
  states: readonly ActorAgentState[],
): Promise<Set<string>> {
  const rows = (
    await sql.query(
      `SELECT ep.id,ep.document,q.id AS request_id,q.actor_id,q.status,q.input_receipt_id
     FROM parallel_life.shared_episodes ep
     JOIN parallel_life.agent_episode_requests q ON q.world_id=ep.world_id AND q.owner_id=ep.owner_id AND q.episode_id=ep.id AND q.origin_decision_id=ep.origin_decision_id AND q.engine_epoch=$3
     WHERE ep.world_id=$1 AND ep.owner_id=$2 AND ep.document->>'status'='proposed'
       AND COALESCE(ep.document->'resultIds','[]'::jsonb)='[]'::jsonb
       AND COALESCE(ep.document->'sourceEventIds','[]'::jsonb)='[]'::jsonb
       AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_receipts r WHERE r.world_id=ep.world_id AND r.owner_id=ep.owner_id AND r.episode_id=ep.id)
       AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_evidence e WHERE e.world_id=ep.world_id AND e.owner_id=ep.owner_id AND e.episode_id=ep.id)
       AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_outcomes o WHERE o.world_id=ep.world_id AND o.owner_id=ep.owner_id AND o.episode_id=ep.id)`,
      [frame.worldId, owner, frame.engineEpoch],
    )
  ).rows;
  const terminal = new Set<string>();
  if (!rows.length) return terminal;
  const attempts = await readEpisodeAttempts(
    sql,
    owner,
    frame.worldId,
    frame.engineEpoch,
    undefined,
    rows.map((row) => String(row.request_id)),
  );
  const byActor = new Map(
    states.filter((s) => s.worldId === frame.worldId).map((s) => [s.actorId, s]),
  );
  for (const id of new Set(rows.map((r) => String(r.id)))) {
    const requests = rows.filter((r) => r.id === id);
    const cast = requests[0]!.document.participantActorIds as string[];
    if (
      !cast.length ||
      requests.length !== cast.length ||
      new Set(requests.map((r) => r.actor_id)).size !== cast.length
    )
      continue;
    if (
      requests.some((r) => {
        const state = byActor.get(r.actor_id);
        const prior = attempts.filter((a) => a.requestId === r.request_id);
        if (
          !cast.includes(r.actor_id) ||
          r.status !== 'pending' ||
          !state ||
          episodeRequestWorkState(r.request_id, attempts) !== 'paid_terminal' ||
          prior.some((a) => a.hasEvent || a.actorId !== r.actor_id)
        )
          return true;
        const receipts = new Set([
          r.input_receipt_id ?? null,
          ...prior.map((a) => a.inputReceiptId),
        ]);
        return [...receipts].some((inputReceiptId) =>
          hasHandoffFollowup(state, {
            episodeId: id,
            requestId: r.request_id,
            inputReceiptId,
          }),
        );
      })
    )
      continue;
    terminal.add(id);
  }
  return terminal;
}
