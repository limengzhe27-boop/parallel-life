import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';

/**
 * Explicit operator recovery for a pre-existing unknown director attempt.
 *
 * This never resends the old request and never fabricates a decision. It only
 * retires an attempt that is durable-unknown, has no response at all, and whose
 * lease has expired. The next advance may then make a fresh bounded decision.
 */
export async function retireUnknownDirectorAttempts(
  db: PostgresDatabase,
  ownerId: string,
  worldId: string,
): Promise<number> {
  return db.transaction(ownerId, async (sql) => {
    const retired = await sql.query(
      `UPDATE parallel_life.director_runtime_attempts
          SET status='stale_discarded',updated_at=now()
        WHERE owner_id=$1 AND world_id=$2
          AND status='unknown_after_send'
          AND response IS NULL AND response_hash IS NULL
          AND lease_until <= clock_timestamp()
        RETURNING id`,
      [ownerId, worldId],
    );
    return retired.rowCount ?? 0;
  });
}
