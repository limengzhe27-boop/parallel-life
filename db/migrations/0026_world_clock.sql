-- 0026_world_clock.sql: the world had no clock, so time never moved and nobody ever
-- acted unless the user spoke first. This adds an authoritative story clock plus the
-- beats the director has produced (one row per beat, idempotent by command id).
CREATE TABLE parallel_life.world_clock (
  world_id text PRIMARY KEY,
  owner_id text NOT NULL,
  story_now timestamptz NOT NULL,
  /* 1.0 = real time; the product allows 1:1, faster, paused and jump-to-next-event. */
  speed numeric(4,2) NOT NULL DEFAULT 1.00 CHECK(speed >= 0 AND speed <= 60),
  paused boolean NOT NULL DEFAULT false,
  last_tick_at timestamptz NOT NULL DEFAULT now(),
  /* Beats that elapsed but were folded into the summary instead of being played. */
  missed_beats integer NOT NULL DEFAULT 0 CHECK(missed_beats >= 0),
  summary text CHECK(summary IS NULL OR char_length(summary) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE parallel_life.world_beats (
  id text PRIMARY KEY,
  world_id text NOT NULL,
  owner_id text NOT NULL,
  command_id uuid NOT NULL,
  planned_for timestamptz NOT NULL,
  actor_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('played','skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(world_id, command_id),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX world_beats_recent ON parallel_life.world_beats(world_id, created_at DESC);

ALTER TABLE parallel_life.world_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_clock FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_clock TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));
CREATE POLICY leased_worker ON parallel_life.world_clock TO pl_worker
  USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON parallel_life.world_clock TO pl_app;
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_clock TO pl_worker;

ALTER TABLE parallel_life.world_beats ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_beats FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_beats TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));
CREATE POLICY leased_worker ON parallel_life.world_beats TO pl_worker
  USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON parallel_life.world_beats TO pl_app;
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_beats TO pl_worker;
