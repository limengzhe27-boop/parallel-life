import { streamUnitCommandId, streamUnitEventId } from '../domain/npc-stream-segment.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentAttempt } from '../domain/agent-runtime.ts';
import type { AgentSnapshot } from '../application/agent-runtime-ports.ts';
import { isDeepStrictEqual } from 'node:util';

export type AgentCommitVersion = { appendBaseVersion: number; commitVersion: number };
/**
 * A quiet state-only commit from another actor changes the world version but
 * shares nothing with this player's private reply: no message, effect, action
 * or result. A player's paid reply may append after it instead of being
 * discarded merely because proactive actors kept running.
 */
function isQuietOtherActorStateCommit(event: unknown, actorId: string): boolean {
  const e = event as {
    type?: unknown;
    data?: {
      actorId?: unknown;
      effects?: unknown;
      worldResults?: unknown;
      agentRuntime?: {
        proposal?: Record<string, unknown>;
        results?: unknown;
        departures?: unknown;
        positionKnowledge?: unknown;
        sceneDepartures?: unknown;
        episodeDecision?: unknown;
      };
    };
  } | null;
  if (e?.type !== 'agent.state_committed') return false;
  const d = e.data;
  if (!d || typeof d.actorId !== 'string' || d.actorId === actorId) return false;
  if (Array.isArray(d.effects) && d.effects.length > 0) return false;
  if (d.worldResults) return false;
  const rt = d.agentRuntime;
  if (!rt || !rt.proposal || typeof rt.proposal !== 'object') return false;
  if (rt.episodeDecision) return false;
  for (const value of [rt.results, rt.departures, rt.positionKnowledge, rt.sceneDepartures])
    if (Array.isArray(value) && value.length > 0) return false;
  for (const key of [
    // Private agenda deltas belong to the other actor and do not change the
    // player's reply basis. Spoken output and shared actions still conflict.
    'statements',
    'actions',
    'locationReports',
    'replyAssessments',
    'questionWithdrawals',
  ])
    if (Array.isArray(rt.proposal[key]) && (rt.proposal[key] as unknown[]).length > 0) return false;
  return true;
}

/** Input/model versions stay immutable. This is the position of the actual append. */
export async function resolveAgentCommitVersion(
  sql: SqlClient,
  ownerId: string,
  attempt: AgentAttempt,
  actualVersion: number,
  hasCommittedPrefix = false,
  suppliedSnapshot?: AgentSnapshot,
): Promise<AgentCommitVersion | null> {
  if (actualVersion === attempt.expectedWorldVersion && !hasCommittedPrefix)
    return { appendBaseVersion: actualVersion, commitVersion: actualVersion + 1 };
  const own = (
    await sql.query(
      `SELECT e.version FROM parallel_life.agent_attempt_stream_segments s
     JOIN parallel_life.world_events e
       ON e.world_id=s.world_id AND e.owner_id=s.owner_id AND e.id=s.source_event_id
     WHERE s.world_id=$1 AND s.owner_id=$2 AND s.attempt_id=$3 AND s.status='committed'
       AND e.command_id=$4 LIMIT 1`,
      [attempt.worldId, ownerId, attempt.id, attempt.commandId],
    )
  ).rows[0];
  if (own)
    return Number(own.version) === actualVersion
      ? { appendBaseVersion: actualVersion - 1, commitVersion: actualVersion }
      : null;
  if (actualVersion < attempt.expectedWorldVersion) return null;
  if (actualVersion === attempt.expectedWorldVersion)
    return { appendBaseVersion: actualVersion, commitVersion: actualVersion + 1 };
  // Bounded proof, not a generic stale-snapshot bypass. Shared changes still conflict.
  if (actualVersion - attempt.expectedWorldVersion > 256) return null;
  const r = (
    await sql.query(
      `SELECT document FROM parallel_life.agent_input_receipts
     WHERE id=$1 AND world_id=$2 AND owner_id=$3`,
      [attempt.inputReceiptId, attempt.worldId, ownerId],
    )
  ).rows[0];
  if (
    !['private', 'group', 'scene'].includes(r?.document?.channel) ||
    r.document.origin !== 'player' ||
    (r.document.channel === 'private'
      ? r.document.recipientActorId !== attempt.actorId
      : r.document.recipientActorId !== null && r.document.recipientActorId !== attempt.actorId)
  )
    return null;
  const events = (
    await sql.query(
      `SELECT e.version,e.payload,c.id AS execution_command FROM parallel_life.world_events e
       JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
        AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=e.version-1
     WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version>$3 AND e.version<=$4 ORDER BY e.version`,
      [attempt.worldId, ownerId, attempt.expectedWorldVersion, actualVersion],
    )
  ).rows;
  if (events.length !== actualVersion - attempt.expectedWorldVersion) return null;
  for (const { payload: e, execution_command } of events) {
    const d = e?.data;
    const unit = d?.stream;
    if (
      unit?.attemptId === attempt.id &&
      unit.parentCommandId === attempt.commandId &&
      unit.unit !== 'final' &&
      d.actorId === attempt.actorId &&
      d.agentRuntime?.inputReceiptId === attempt.inputReceiptId &&
      e.id === streamUnitEventId(attempt.id, unit.unit) &&
      execution_command === streamUnitCommandId(attempt.id, unit.unit)
    )
      continue;
    if (isQuietOtherActorStateCommit(e, attempt.actorId)) continue;
    if (
      e?.type !== 'turn.resolved' ||
      !d?.actorId ||
      d.actorId === attempt.actorId ||
      !d.agentRuntime?.proposal ||
      ['positionKnowledge', 'sceneDepartures'].some(
        (key) => (d.agentRuntime[key]?.length ?? 0) > 0,
      ) ||
      ['actions'].some((key) => (d.agentRuntime.proposal[key]?.length ?? 0) > 0) ||
      !Array.isArray(d.effects) ||
      d.effects.some(
        (x: { type?: string; actorId?: string }) =>
          x.type !== 'message.received' || x.actorId !== d.actorId,
      ) ||
      d.worldResults ||
      (d.agentRuntime.results?.length ?? 0) > 0 ||
      (d.agentRuntime.departures?.length ?? 0) > 0
    )
      return null;
    const decision = d.agentRuntime.episodeDecision ?? d.agentRuntime.proposal.episodeDecision;
    const privateDelta =
      decision ||
      ['goals', 'plans', 'responsibilities', 'decisions'].some(
        (key) => (d.agentRuntime.proposal[key]?.length ?? 0) > 0,
      );
    const intervening_input = privateDelta
      ? (
          await sql.query(
            `SELECT document FROM parallel_life.agent_input_receipts
       WHERE id=$1 AND world_id=$2 AND owner_id=$3`,
            [d.agentRuntime.inputReceiptId, attempt.worldId, ownerId],
          )
        ).rows[0]?.document
      : null;
    if (
      privateDelta &&
      (r.document.channel !== 'private' ||
        intervening_input?.channel !== 'private' ||
        intervening_input.recipientActorId !== d.actorId)
    )
      return null;
    if (decision) {
      if (
        !isDeepStrictEqual(d.agentRuntime.episodeDecision, d.agentRuntime.proposal.episodeDecision)
      )
        return null;
      const snapshot =
        suppliedSnapshot ??
        (
          await sql.query(
            `SELECT response->'snapshot' AS snapshot FROM parallel_life.agent_attempts
         WHERE id=$1 AND world_id=$2 AND owner_id=$3`,
            [attempt.id, attempt.worldId, ownerId],
          )
        ).rows[0]?.snapshot;
      if (
        !(await independentEpisodeDecision(
          sql,
          ownerId,
          attempt,
          snapshot,
          decision.requestId,
          d.actorId,
          d.agentRuntime.inputReceiptId,
        ))
      )
        return null;
    }
  }
  return { appendBaseVersion: actualVersion, commitVersion: actualVersion + 1 };
}

/** Use the already authenticated model basis; missing evidence never means disjoint. */
async function independentEpisodeDecision(
  sql: SqlClient,
  ownerId: string,
  attempt: AgentAttempt,
  snapshot: AgentSnapshot | undefined,
  otherRequestId: unknown,
  otherActorId: string,
  otherInputId: string,
): Promise<boolean> {
  if (
    !snapshot ||
    snapshot.state?.worldId !== attempt.worldId ||
    snapshot.state.actorId !== attempt.actorId ||
    snapshot.worldVersion !== attempt.expectedWorldVersion ||
    snapshot.state.revision !== attempt.expectedActorRevision ||
    snapshot.input?.sourceId !== attempt.inputReceiptId ||
    snapshot.channel?.kind !== 'private' ||
    typeof otherRequestId !== 'string' ||
    !otherRequestId
  )
    return false;
  const episodes = new Set<string>();
  const requests = new Set<string>();
  if (snapshot.episodeManifest) {
    episodes.add(snapshot.episodeManifest.episodeId);
    requests.add(snapshot.episodeManifest.requestId);
  }
  for (const item of snapshot.episodeFollowUps ?? []) {
    episodes.add(item.episodeId);
    requests.add(item.requestId);
  }
  for (const item of snapshot.episodeResults ?? []) episodes.add(item.episodeId);
  for (const state of [snapshot.state, snapshot.viewState]) {
    if (!state || !Array.isArray(state.responsibilities)) return false;
    for (const item of state.episodeParticipations ?? []) requests.add(item.id);
    for (const item of state.responsibilities)
      if (item.subject.kind === 'episode') episodes.add(item.subject.id);
  }
  if (!Array.isArray(snapshot.sources)) return false;
  for (const source of snapshot.sources) {
    if (source.id.startsWith('episode-intent:'))
      requests.add(source.id.slice('episode-intent:'.length));
    // Older sources can directly name an episode rather than a consideration request.
    if (source.id.startsWith('episode:')) episodes.add(source.id.slice('episode:'.length));
  }
  if (requests.has(otherRequestId)) return false;
  const rows = (
    await sql.query(
      `SELECT id,actor_id,episode_id,engine_epoch,input_receipt_id,status
     FROM parallel_life.agent_episode_requests
     WHERE world_id=$1 AND owner_id=$2 AND id=ANY($3::text[])`,
      [attempt.worldId, ownerId, [...requests, otherRequestId]],
    )
  ).rows;
  if (rows.length !== requests.size + 1) return false;
  const other = rows.find((row) => row.id === otherRequestId);
  if (
    !other ||
    other.actor_id !== otherActorId ||
    other.engine_epoch !== attempt.engineEpoch ||
    other.input_receipt_id !== otherInputId ||
    other.status !== 'consumed'
  )
    return false;
  for (const row of rows) {
    if (row.id === otherRequestId) continue;
    if (row.actor_id !== attempt.actorId || row.engine_epoch !== attempt.engineEpoch) return false;
    episodes.add(row.episode_id);
  }
  return !episodes.has(other.episode_id);
}

/** Compatibility for callers that need only admission; all commits resolve one position. */
export async function acceptsAgentCommitVersion(
  sql: SqlClient,
  ownerId: string,
  attempt: AgentAttempt,
  actualVersion: number,
  hasCommittedPrefix = false,
): Promise<boolean> {
  return (
    (await resolveAgentCommitVersion(sql, ownerId, attempt, actualVersion, hasCommittedPrefix)) !==
    null
  );
}

/** Source readers keep the model's visibility bound, while checking the admitted commit head. */
export async function isAdmittedAgentCommitHead(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  actorId: string,
  modelVersion: number,
  actualVersion: number,
): Promise<boolean> {
  return (
    (
      await sql.query(
        `SELECT 1 FROM parallel_life.agent_attempts a
     WHERE a.id=current_setting('app.agent_commit_attempt_id',true)
       AND a.world_id=$1 AND a.owner_id=$2 AND a.actor_id=$3 AND a.expected_world_version=$4
       AND a.status IN ('request_sent','response_received')
       AND a.lease_until>clock_timestamp()
       AND ((current_setting('app.agent_world_id',true)=$1
         AND current_setting('app.agent_engine_epoch',true)=a.engine_epoch::text
         AND current_setting('app.agent_commit_version',true) IN ($5::text,($5::integer+1)::text))
         OR EXISTS(SELECT 1 FROM parallel_life.agent_attempt_stream_segments s
           JOIN parallel_life.world_events e ON e.world_id=s.world_id AND e.owner_id=s.owner_id AND e.id=s.source_event_id
           WHERE s.world_id=a.world_id AND s.owner_id=a.owner_id AND s.attempt_id=a.id
             AND s.status='committed' AND e.command_id=a.command_id AND e.version=$5::integer)
         OR EXISTS(SELECT 1 FROM parallel_life.world_events e JOIN parallel_life.commands c
           ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
           WHERE e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.version=$5::integer
             AND e.payload#>>'{data,stream,attemptId}'=a.id AND e.payload#>>'{data,stream,parentCommandId}'=a.command_id
             AND e.payload#>>'{data,stream,unit}'<>'final' AND e.payload#>>'{data,agentRuntime,inputReceiptId}'=a.input_receipt_id))`,
        [worldId, ownerId, actorId, modelVersion, actualVersion],
      )
    ).rowCount === 1
  );
}
