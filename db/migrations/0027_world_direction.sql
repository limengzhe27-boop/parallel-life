-- 0027_world_direction.sql: the user could not steer the director at all — there was no
-- per-life brief. This stores the guidance a user gives (themes, pacing, who to focus
-- on) plus a guard: history is never rewritten here, only the future is directed.
CREATE TABLE parallel_life.world_direction (
  world_id text PRIMARY KEY,
  owner_id text NOT NULL,
  guidance text NOT NULL DEFAULT '' CHECK(char_length(guidance) <= 500),
  themes text[] NOT NULL DEFAULT '{}' CHECK(array_length(themes, 1) IS NULL OR array_length(themes, 1) <= 5),
  pacing text NOT NULL DEFAULT 'normal' CHECK(pacing IN ('slow', 'normal', 'fast')),
  focus_actor_ids text[] NOT NULL DEFAULT '{}' CHECK(array_length(focus_actor_ids, 1) IS NULL OR array_length(focus_actor_ids, 1) <= 3),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.world_direction ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_direction FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_direction TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));
CREATE POLICY leased_worker ON parallel_life.world_direction TO pl_worker
  USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON parallel_life.world_direction TO pl_app;
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_direction TO pl_worker;
