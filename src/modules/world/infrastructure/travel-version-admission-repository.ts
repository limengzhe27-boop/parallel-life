import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import { canAppendTravelAfter } from '../domain/travel-version-admission.ts';
/** Caller holds the world row lock. Proof rows must cover every committed version, with no gaps. */
export async function acceptsTravelVersion(
  sql: SqlClient,
  ownerId: string,
  worldId: string,
  expectedVersion: number,
  actualVersion: number,
) {
  if (expectedVersion === actualVersion) return true;
  if (expectedVersion > actualVersion || actualVersion - expectedVersion > 256) return false;
  const events = (
    await sql.query(
      `SELECT e.version,e.payload FROM parallel_life.world_events e
 JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=e.version-1
 WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version>$3 AND e.version<=$4 ORDER BY e.version`,
      [worldId, ownerId, expectedVersion, actualVersion],
    )
  ).rows;
  return canAppendTravelAfter({ worldId, expectedVersion, actualVersion, events });
}
