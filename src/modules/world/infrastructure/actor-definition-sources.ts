import { actorDefinitionRef } from './actor-definition-ref.ts';
import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { Actor, WorldState } from '../domain/types.ts';
import type { AgentSource } from '../domain/agent-runtime.ts';
import { revisedActor, validActorDefinitionRevision } from '../domain/actor-definition-revision.ts';
/** Immutable initial definition plus authenticated sequential corrections. Never rewrites old source IDs. */
export async function readActorDefinitionSources(
  sql: SqlClient,
  owner: string,
  worldId: string,
  actorId: string,
  throughVersion: number,
  initialState?: WorldState,
): Promise<AgentSource[]> {
  const initial =
    initialState ??
    ((
      await sql.query(
        'SELECT state FROM parallel_life.world_initial_snapshots WHERE world_id=$1 AND owner_id=$2',
        [worldId, owner],
      )
    ).rows[0]?.state as WorldState | undefined);
  let actor = initial?.actors.find((a) => a.id === actorId);
  if (!initial || !actor) return [];
  const make = (ref: string, version: number, at: string): AgentSource => ({
    id: `definition:${ref}`,
    kind: 'authored',
    recordId: ref,
    worldVersion: version,
    at,
  });
  const result = [make(actorDefinitionRef(initial, actorId), 0, initial.time)];
  const rows = (
    await sql.query(
      `SELECT e.payload FROM parallel_life.world_events e JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=e.version-1 WHERE e.world_id=$1 AND e.owner_id=$2 AND e.version<=$3 AND e.payload->>'type'='actor.definition_revised' AND e.payload#>>'{data,actorId}'=$4 ORDER BY e.version`,
      [worldId, owner, throughVersion, actorId],
    )
  ).rows;
  for (const row of rows) {
    const event = row.payload;
    if (!validActorDefinitionRevision(event)) throw Error('ACTOR_DEFINITION_LINEAGE_CONFLICT');
    if (
      actorDefinitionRef({ id: worldId, actors: [actor as Actor] }, actorId) !==
      event.data.previousDefinitionRef
    )
      throw Error('ACTOR_DEFINITION_LINEAGE_CONFLICT');
    actor = revisedActor(worldId, actor as Actor, event);
    if (actorDefinitionRef({ id: worldId, actors: [actor] }, actorId) !== event.data.definitionRef)
      throw Error('ACTOR_DEFINITION_LINEAGE_CONFLICT');
    result.push(make(event.data.definitionRef, event.version, event.storyAt));
  }
  return result;
}
