import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { DirectorReviewState } from '../domain/director-review.ts';

const REVIEW_INTERVAL_MS = 60 * 60 * 1000;
export function nextDirectorReviewAt(storyAt: string, intervalMs = REVIEW_INTERVAL_MS): string {
  const at = Date.parse(storyAt);
  if (!Number.isFinite(at)) throw Error('INVALID_DIRECTOR_REVIEW_TIME');
  return new Date(at + intervalMs).toISOString();
}

export class PostgresDirectorReviewRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }
  async read(ownerId: string, worldId: string): Promise<DirectorReviewState | null> {
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          `SELECT next_review_at,last_reviewed_at,review_count
             FROM parallel_life.agent_director_reviews
            WHERE owner_id=$1 AND world_id=$2`,
          [ownerId, worldId],
        )
      ).rows[0];
      if (!row) return null;
      return {
        nextReviewAt: new Date(row.next_review_at).toISOString(),
        lastReviewedAt: new Date(row.last_reviewed_at).toISOString(),
        reviewCount: Number(row.review_count),
      };
    });
  }
  async schedule(ownerId: string, worldId: string, storyAt: string): Promise<DirectorReviewState> {
    const lastReviewedAt = new Date(storyAt).toISOString();
    const nextReviewAt = nextDirectorReviewAt(storyAt);
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          `INSERT INTO parallel_life.agent_director_reviews
             (world_id,owner_id,next_review_at,last_reviewed_at,review_count)
           VALUES($1,$2,$3,$4,1)
           ON CONFLICT(world_id,owner_id) DO UPDATE SET
             next_review_at=EXCLUDED.next_review_at,
             last_reviewed_at=EXCLUDED.last_reviewed_at,
             review_count=parallel_life.agent_director_reviews.review_count+1,
             updated_at=now()
           RETURNING next_review_at,last_reviewed_at,review_count`,
          [worldId, ownerId, nextReviewAt, lastReviewedAt],
        )
      ).rows[0];
      return {
        nextReviewAt: new Date(row.next_review_at).toISOString(),
        lastReviewedAt: new Date(row.last_reviewed_at).toISOString(),
        reviewCount: Number(row.review_count),
      };
    });
  }
}
