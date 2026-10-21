import pg from 'pg';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS parallel_life.agent_plan_reviews (
  world_id text NOT NULL, owner_id text NOT NULL, actor_id text NOT NULL,
  plan_id text NOT NULL, next_review_at timestamptz NOT NULL,
  last_reviewed_at timestamptz NOT NULL,
  review_count integer NOT NULL DEFAULT 1 CHECK(review_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(world_id, owner_id, actor_id, plan_id),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_plan_reviews_due_idx
  ON parallel_life.agent_plan_reviews(owner_id,next_review_at);
ALTER TABLE parallel_life.agent_plan_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_plan_reviews FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='parallel_life' AND tablename='agent_plan_reviews' AND policyname='agent_plan_review_owner') THEN
    CREATE POLICY agent_plan_review_owner ON parallel_life.agent_plan_reviews
      TO pl_app USING(owner_id=current_setting('app.user_id',true))
      WITH CHECK(owner_id=current_setting('app.user_id',true));
  END IF;
END $$;
GRANT SELECT,INSERT,UPDATE ON parallel_life.agent_plan_reviews TO pl_app;
`;

/** One-shot admin migration using the application URL's database password with
 * the provider owner role. Never logs the URL or password. */
export async function ensure0104Admin(): Promise<{ created: boolean; via: string }> {
  const raw = process.env.APP_DATABASE_URL;
  if (!raw) throw Object.assign(Error('APP_DATABASE_URL_MISSING'), { code: 'NO_DB' });
  const base = new URL(raw);
  const prefix = decodeURIComponent(base.username).split('.')[0];
  const suffix = base.username.includes('.') ? base.username.slice(base.username.indexOf('.')) : '';
  const candidates = [
    ...new Set([`postgres${suffix}`, `neondb_owner${suffix}`, base.username]),
  ].filter((v) => v !== base.username || prefix === 'pl_app');
  const errors: string[] = [];
  for (const user of candidates) {
    const url = new URL(raw);
    url.username = user;
    url.searchParams.delete('sslmode');
    url.searchParams.delete('ssl');
    const client = new pg.Client({
      connectionString: url.toString(),
      ssl:
        base.hostname.includes('127.0.0.1') || base.hostname === 'localhost'
          ? false
          : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
    try {
      await client.connect();
      const exists = (
        await client.query("SELECT to_regclass('parallel_life.agent_plan_reviews') AS t")
      ).rows[0]?.t;
      if (!exists) await client.query(MIGRATION);
      return { created: !exists, via: user.split('.')[0] ?? user };
    } catch (error) {
      errors.push(String((error as Error).message).slice(0, 160));
    } finally {
      await client.end().catch(() => {});
    }
  }
  throw Object.assign(Error(`ADMIN_MIGRATION_FAILED:${errors.join('|')}`), {
    code: 'MIGRATION_FAILED',
  });
}
