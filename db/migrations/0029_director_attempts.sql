-- A model call must have a durable identity before it starts. A dropped request may
-- have consumed tokens, so automatic recovery only reconciles committed receipts.
CREATE TABLE parallel_life.world_director_attempts (
  world_id text NOT NULL,
  owner_id text NOT NULL,
  command_id uuid NOT NULL,
  planned_for timestamptz NOT NULL,
  actor_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('started','committed','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(world_id,command_id),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX world_director_attempts_recent ON parallel_life.world_director_attempts(world_id,planned_for DESC);
ALTER TABLE parallel_life.world_director_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_director_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_director_attempts TO pl_app
  USING(owner_id=current_setting('app.user_id',true))
  WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE POLICY leased_worker ON parallel_life.world_director_attempts TO pl_worker
  USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id));
REVOKE ALL ON parallel_life.world_director_attempts FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_director_attempts TO pl_app,pl_worker;
