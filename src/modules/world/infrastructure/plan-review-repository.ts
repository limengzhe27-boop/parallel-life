import type { PostgresDatabase } from '../../storage/infrastructure/postgres.ts';
import type { PlanReviewState } from '../domain/plan-review.ts';

const HOUR_MS = 60 * 60 * 1000;
export function nextPlanReviewAt(storyAt: string, hours = 1): string {
  const at = Date.parse(storyAt);
  if (!Number.isFinite(at)) throw Error('INVALID_PLAN_REVIEW_TIME');
  return new Date(at + hours * HOUR_MS).toISOString();
}

export class PostgresPlanReviewRepository {
  private readonly db: PostgresDatabase;
  constructor(db: PostgresDatabase) {
    this.db = db;
  }

  async read(
    ownerId: string,
    worldId: string,
    actorId: string,
    planIds: readonly string[],
  ): Promise<ReadonlyMap<string, PlanReviewState>> {
    if (!planIds.length) return new Map();
    return this.db.transaction(ownerId, async (sql) => {
      const rows = (
        await sql.query(
          `SELECT plan_id,next_review_at,last_reviewed_at,review_count
             FROM parallel_life.agent_plan_reviews
            WHERE owner_id=$1 AND world_id=$2 AND actor_id=$3 AND plan_id=ANY($4::text[])`,
          [ownerId, worldId, actorId, planIds],
        )
      ).rows;
      return new Map(
        rows.map((row) => [
          String(row.plan_id),
          {
            planId: String(row.plan_id),
            nextReviewAt: new Date(row.next_review_at).toISOString(),
            lastReviewedAt: new Date(row.last_reviewed_at).toISOString(),
            reviewCount: Number(row.review_count),
          },
        ]),
      );
    });
  }

  async schedule(
    ownerId: string,
    worldId: string,
    actorId: string,
    planId: string,
    storyAt: string,
    hours = 1,
  ): Promise<PlanReviewState> {
    const lastReviewedAt = new Date(storyAt).toISOString();
    const nextReviewAt = nextPlanReviewAt(storyAt, hours);
    return this.db.transaction(ownerId, async (sql) => {
      const row = (
        await sql.query(
          `INSERT INTO parallel_life.agent_plan_reviews
             (world_id,owner_id,actor_id,plan_id,next_review_at,last_reviewed_at,review_count)
           VALUES($1,$2,$3,$4,$5,$6,1)
           ON CONFLICT(world_id,owner_id,actor_id,plan_id) DO UPDATE SET
             next_review_at=EXCLUDED.next_review_at,
             last_reviewed_at=EXCLUDED.last_reviewed_at,
             review_count=parallel_life.agent_plan_reviews.review_count+1,
             updated_at=now()
           RETURNING plan_id,next_review_at,last_reviewed_at,review_count`,
          [worldId, ownerId, actorId, planId, nextReviewAt, lastReviewedAt],
        )
      ).rows[0];
      return {
        planId: String(row.plan_id),
        nextReviewAt: new Date(row.next_review_at).toISOString(),
        lastReviewedAt: new Date(row.last_reviewed_at).toISOString(),
        reviewCount: Number(row.review_count),
      };
    });
  }
}
