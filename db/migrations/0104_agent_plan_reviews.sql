-- Durable cadence for actionless plan reviews. A row is scheduling metadata,
-- never an execution grant or a goal-completion record.
CREATE TABLE parallel_life.agent_plan_reviews (
  world_id text NOT NULL,
  owner_id text NOT NULL,
  actor_id text NOT NULL,
  plan_id text NOT NULL,
  next_review_at timestamptz NOT NULL,
  last_reviewed_at timestamptz NOT NULL,
  review_count integer NOT NULL DEFAULT 1 CHECK(review_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(world_id, owner_id, actor_id, plan_id),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX agent_plan_reviews_due_idx
 ON parallel_life.agent_plan_reviews(owner_id,next_review_at);
ALTER TABLE parallel_life.agent_plan_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_plan_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_plan_reviews FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY agent_plan_review_owner ON parallel_life.agent_plan_reviews
 TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE ON parallel_life.agent_plan_reviews TO pl_app;
