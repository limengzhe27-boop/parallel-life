import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { DirectorReviewState } from '../domain/director-review.ts';

const REVIEW_INTERVAL_MS = 60 * 60 * 1000;
export function nextDirectorReviewAt(storyAt: string, intervalMs = REVIEW_INTERVAL_MS): string {
  const at = Date.parse(storyAt);
  if (!Number.isFinite(at)) throw Error('INVALID_DIRECTOR_REVIEW_TIME');
  return new Date(at + intervalMs).toISOString();
}

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
          `SELECT created_at,updated_at
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
      return {
        nextReviewAt: nextDirectorReviewAt(lastReviewedAt),
        lastReviewedAt,
        reviewCount: Number(count.n),
      };
    });
  }
}
