import type { SqlClient } from '../../storage/infrastructure/postgres.ts';
import type { WorldState } from '../domain/types.ts';
import { emptyActorAgentState } from '../domain/agent-runtime.ts';
import { agentDefinitionRef } from './agent-snapshot-repository.ts';
/** Creation boundary only. SQL verifies v0, immutable genesis and owner/live build lease. */
export async function initializeNewAgentWorld(sql: SqlClient, world: WorldState) {
  const states = world.actors.map((a) =>
    emptyActorAgentState({ worldId: world.id, actorId: a.id }, agentDefinitionRef(world, a.id), 0),
  );
  await sql.query('SELECT parallel_life.initialize_built_agent_world($1,$2)', [
    world.id,
    JSON.stringify(states),
  ]);
}
