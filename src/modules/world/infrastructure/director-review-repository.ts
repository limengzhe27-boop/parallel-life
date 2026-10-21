import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import { nextDirectorReviewAt, type DirectorReviewState } from '../domain/director-review.ts';

/**
 * The existing durable director attempt ledger is the cadence source. No
 * separate table or migration is required: the last attempt's real timestamp
 * is enough to suppress duplicate global reviews.
 */
export class PostgresDirectorReviewRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async read(ownerId: string, worldId: string): Promise<DirectorReviewState | null> {
    return this.db.transaction(ownerId, async (sql) => {
      const last = (
        await sql.query(
          `SELECT created_at,updated_at,status
             FROM parallel_life.director_runtime_attempts
            WHERE owner_id=$1 AND world_id=$2
            ORDER BY created_at DESC LIMIT 1`,
          [ownerId, worldId],
        )
      ).rows[0];
      if (!last) return null;
      const count = (
        await sql.query(
          `SELECT count(*)::int AS n FROM parallel_life.director_runtime_attempts
            WHERE owner_id=$1 AND world_id=$2`,
          [ownerId, worldId],
        )
      ).rows[0];
      const lastReviewedAt = new Date(last.updated_at ?? last.created_at).toISOString();
      const lastStatus = String(last.status);
      return {
        nextReviewAt: nextDirectorReviewAt(lastReviewedAt, lastStatus),
        lastReviewedAt,
        reviewCount: Number(count.n),
        lastStatus,
      };
    });
  }
}
