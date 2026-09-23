-- 0017_world_notes.sql: private phone notes live in their own projection table so
-- worlds.state does not grow with every note, and so notes survive a reload.
CREATE TABLE parallel_life.world_notes (
  id text PRIMARY KEY,
  world_id text NOT NULL,
  owner_id text NOT NULL,
  command_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(char_length(request_hash)=64),
  document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(world_id, command_id),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX world_notes_by_world ON parallel_life.world_notes(world_id, updated_at DESC);

ALTER TABLE parallel_life.world_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_notes TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));
CREATE POLICY leased_worker ON parallel_life.world_notes TO pl_worker
  USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON parallel_life.world_notes TO pl_app;
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_notes TO pl_worker;
REVOKE ALL ON parallel_life.world_notes FROM PUBLIC;
