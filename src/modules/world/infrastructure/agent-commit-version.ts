import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { AgentAttempt } from '../domain/agent-runtime.ts';

/** Shared by text, media and final commit. A version increment is not itself ownership. */
export async function acceptsAgentCommitVersion(
  sql: SqlClient,
  ownerId: string,
  attempt: AgentAttempt,
  actualVersion: number,
  hasCommittedPrefix = false,
): Promise<boolean> {
  if (actualVersion === attempt.expectedWorldVersion) return !hasCommittedPrefix;
  if (actualVersion !== attempt.expectedWorldVersion + 1) return false;
  return (
    (
      await sql.query(
        `SELECT 1 FROM parallel_life.agent_attempt_stream_segments s
         JOIN parallel_life.world_events e
           ON e.world_id=s.world_id AND e.owner_id=s.owner_id AND e.id=s.source_event_id
         WHERE s.world_id=$1 AND s.owner_id=$2 AND s.attempt_id=$3 AND s.status='committed'
           AND e.command_id=$4 AND e.version=$5 LIMIT 1`,
        [attempt.worldId, ownerId, attempt.id, attempt.commandId, actualVersion],
      )
    ).rowCount === 1
  );
}
