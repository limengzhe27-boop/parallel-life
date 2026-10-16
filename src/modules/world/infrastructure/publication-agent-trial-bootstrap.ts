import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { WorldState } from '../domain/types.ts';
import { DomainError } from '../domain/errors.ts';
import { emptyActorAgentState } from '../domain/agent-runtime.ts';
import { agentDefinitionRef } from './agent-snapshot-repository.ts';
import {
  initializeActorAgentStateInTransaction,
  switchAgentEngineEpochInTransaction,
} from './agent-runtime-repository.ts';
import { admitNewAgentNarrativeInTransaction } from './agent-narrative-repository.ts';

/** Only SQL-attested, newly admitted private trials can enter this path. */
export async function bootstrapPublicationAgentTrial(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
): Promise<{ worldId: string; engineEpoch: 2; resumed: boolean }> {
  return db.transaction(ownerId, async (sql) => {
    const proof = (
      await sql.query('SELECT parallel_life.publication_agent_trial_source($1) AS source', [
        worldId,
      ])
    ).rows[0]?.source;
    if (!proof || proof.ownerId !== ownerId || proof.worldId !== worldId || proof.engineEpoch !== 2)
      throw new DomainError('NOT_FOUND');
    const row = (
      await sql.query(
        'SELECT version,state FROM parallel_life.worlds WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [worldId, ownerId],
      )
    ).rows[0];
    if (
      !row ||
      !(
        await sql.query(
          'SELECT 1 FROM parallel_life.world_builds WHERE world_id=$1 AND owner_id=$2 AND seed_id=$3',
          [worldId, ownerId, proof.seedId],
        )
      ).rowCount
    )
      throw new DomainError('NOT_FOUND');
    const epoch =
      (
        await sql.query(
          'SELECT engine_epoch FROM parallel_life.agent_runtime_worlds WHERE world_id=$1 AND owner_id=$2',
          [worldId, ownerId],
        )
      ).rows[0]?.engine_epoch ?? 1;
    if (epoch === 2) {
      // Admission verifies the immutable genesis hash, including after the trial advances.
      const prior = await sql.query(
        'SELECT 1 FROM parallel_life.agent_narrative_admissions WHERE world_id=$1 AND owner_id=$2',
        [worldId, ownerId],
      );
      if (!prior.rowCount) throw new DomainError('INVALID_COMMAND');
      await admitNewAgentNarrativeInTransaction(sql, ownerId, { worldId, engineEpoch: 2 });
      return { worldId, engineEpoch: 2, resumed: true };
    }
    const clock = (
      await sql.query(
        'SELECT paused FROM parallel_life.world_clock WHERE world_id=$1 AND owner_id=$2 FOR UPDATE',
        [worldId, ownerId],
      )
    ).rows[0];
    if (epoch !== 1 || row.version !== 0 || clock?.paused !== true)
      throw new DomainError('INVALID_COMMAND');
    const world = row.state as WorldState;
    for (const actor of world.actors) {
      await initializeActorAgentStateInTransaction(
        sql,
        ownerId,
        emptyActorAgentState(
          { worldId, actorId: actor.id },
          agentDefinitionRef(world, actor.id),
          0,
        ),
      );
    }
    await switchAgentEngineEpochInTransaction(sql, ownerId, {
      worldId,
      expectedEpoch: 1,
      nextEpoch: 2,
      expectedWorldVersion: 0,
    });
    await admitNewAgentNarrativeInTransaction(sql, ownerId, { worldId, engineEpoch: 2 });
    return { worldId, engineEpoch: 2, resumed: false };
  });
}
