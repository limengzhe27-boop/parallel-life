import { randomUUID } from 'node:crypto';
import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { DomainError } from '../domain/errors.ts';
/** Only the original automatic advance is serialized. Player commands retain their own kernel/CAS. */
export async function claimAgentAdvanceBatch(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
) {
  return db.transaction(ownerId, async (sql) => {
    const world = (
      await sql.query(
        `SELECT w.state->>'time' AS story_time,COALESCE(c.engine_epoch,1) epoch
      FROM parallel_life.worlds w LEFT JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
      WHERE w.id=$1 AND w.owner_id=$2 FOR UPDATE OF w`,
        [worldId, ownerId],
      )
    ).rows[0];
    if (!world) throw new DomainError('NOT_FOUND');
    if (Number(world.epoch) < 2) return { status: 'legacy' as const };
    const token = randomUUID();
    const claimed = (
      await sql.query(
        `INSERT INTO parallel_life.agent_advance_batch_leases(world_id,owner_id,engine_epoch,token,lease_until)
      VALUES($1,$2,$3,$4,clock_timestamp()+interval '270 seconds')
      ON CONFLICT(world_id) DO UPDATE SET token=EXCLUDED.token,engine_epoch=EXCLUDED.engine_epoch,lease_until=EXCLUDED.lease_until
      WHERE agent_advance_batch_leases.owner_id=$2 AND (agent_advance_batch_leases.lease_until<=clock_timestamp() OR agent_advance_batch_leases.engine_epoch<>EXCLUDED.engine_epoch)
      RETURNING token`,
        [worldId, ownerId, Number(world.epoch), token],
      )
    ).rows[0];
    if (!claimed) {
      const lease = (
        await sql.query(
          `SELECT lease_until,engine_epoch,lease_until<=clock_timestamp() AS expired,
                  clock_timestamp() AS now
             FROM parallel_life.agent_advance_batch_leases
            WHERE world_id=$1 AND owner_id=$2`,
          [worldId, ownerId],
        )
      ).rows[0];
      console.info(
        JSON.stringify({
          scope: 'advance-lease-busy',
          worldId,
          epoch: Number(world.epoch),
          leaseUntil: lease?.lease_until ?? null,
          leaseEpoch: lease?.engine_epoch ?? null,
          expired: lease?.expired ?? null,
          now: lease?.now ?? null,
        }),
      );
    }
    return claimed
      ? { status: 'claimed' as const, token }
      : { status: 'busy' as const, storyNow: String(world.story_time) };
  });
}
export async function releaseAgentAdvanceBatch(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
  token: string,
) {
  await db.transaction(ownerId, (sql) =>
    sql.query(
      'DELETE FROM parallel_life.agent_advance_batch_leases WHERE world_id=$1 AND owner_id=$2 AND token=$3',
      [worldId, ownerId, token],
    ),
  );
}
