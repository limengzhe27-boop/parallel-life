import { streamUnitCommandId, streamUnitEventId } from '../domain/npc-stream-segment.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentAttempt } from '../domain/agent-runtime.ts';

export type AgentCommitVersion = { appendBaseVersion: number; commitVersion: number };

/** Input/model versions stay immutable. This is the position of the actual append. */
export async function resolveAgentCommitVersion(
  sql: SqlClient,
  ownerId: string,
  attempt: AgentAttempt,
  actualVersion: number,
  hasCommittedPrefix = false,
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
    r?.document?.channel !== 'private' ||
    r.document.origin !== 'player' ||
    r.document.recipientActorId !== attempt.actorId
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
    if (
      e?.type !== 'turn.resolved' ||
      !d?.actorId ||
      d.actorId === attempt.actorId ||
      !d.agentRuntime?.proposal ||
      d.agentRuntime.episodeDecision ||
      d.agentRuntime.proposal.episodeDecision ||
      ['positionKnowledge', 'sceneDepartures'].some(
        (key) => (d.agentRuntime[key]?.length ?? 0) > 0,
      ) ||
      ['goals', 'plans', 'actions', 'responsibilities', 'decisions'].some(
        (key) => (d.agentRuntime.proposal[key]?.length ?? 0) > 0,
      ) ||
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
  }
  return { appendBaseVersion: actualVersion, commitVersion: actualVersion + 1 };
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
