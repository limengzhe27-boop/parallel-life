-- Durable cadence for global director review even when no actor candidate exists.
-- This is scheduling metadata, never an execution or event-completion grant.
CREATE TABLE parallel_life.agent_director_reviews (
  world_id text NOT NULL,
  owner_id text NOT NULL,
  next_review_at timestamptz NOT NULL,
  last_reviewed_at timestamptz NOT NULL,
  review_count integer NOT NULL DEFAULT 1 CHECK(review_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(world_id, owner_id),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.agent_director_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_director_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_director_reviews FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY agent_director_review_owner ON parallel_life.agent_director_reviews
 TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE ON parallel_life.agent_director_reviews TO pl_app;
