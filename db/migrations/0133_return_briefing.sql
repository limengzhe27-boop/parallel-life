-- A return briefing is the only offline catch-up. The world must not advance in the
-- background: proactive claims require a live foreground presence lease. When the
-- player comes back, a bounded simulation runs once per (world, left_at) and commits
-- real NPC messages instead of projecting old unread cards as new feedback.
ALTER TABLE parallel_life.world_clock ADD COLUMN last_present_at timestamptz;

CREATE TABLE parallel_life.world_return_briefings (
  id text PRIMARY KEY,
  world_id text NOT NULL,
  owner_id text NOT NULL,
  left_at timestamptz NOT NULL,
  returned_at timestamptz NOT NULL,
  gap_seconds integer NOT NULL CHECK (gap_seconds >= 0),
  story_from timestamptz NOT NULL,
  story_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  lease_until timestamptz,
  beat_index integer NOT NULL DEFAULT 0 CHECK (beat_index >= 0),
  message_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(message_ids) = 'array' AND jsonb_array_length(message_ids) <= 8),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, left_at),
  FOREIGN KEY (world_id, owner_id) REFERENCES parallel_life.worlds(id, owner_id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.world_return_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_return_briefings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.world_return_briefings FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY return_briefing_owner ON parallel_life.world_return_briefings TO pl_app
 USING(owner_id=current_setting('app.user_id',true))
 WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_return_briefings TO pl_app;

-- Background execution never owns a world the player is not currently viewing.
-- The presence lease is the same one the phone renews while the page is visible.
CREATE OR REPLACE FUNCTION parallel_life.claim_proactive_worlds(
  p_max integer DEFAULT 2,
  p_cooldown interval DEFAULT interval '60 seconds',
  p_lease interval DEFAULT interval '60 seconds'
)
RETURNS TABLE(claimed_owner_id text, claimed_world_id text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = parallel_life, pg_temp
AS $fn$
DECLARE
  candidate record;
  wanted integer := GREATEST(1, LEAST(COALESCE(p_max, 2), 2));
BEGIN
  PERFORM pg_advisory_xact_lock(82147231);
  FOR candidate IN
    SELECT c.owner_id, c.world_id
      FROM parallel_life.world_clock c
      JOIN parallel_life.worlds w ON w.id = c.world_id AND w.owner_id = c.owner_id
      JOIN parallel_life.agent_runtime_worlds r ON r.world_id = c.world_id AND r.owner_id = c.owner_id
      LEFT JOIN parallel_life.world_proactive_leases l ON l.world_id = c.world_id
     WHERE NOT c.paused
       AND c.continuity_mode = 'continuous'
       AND r.engine_epoch >= 2
       AND COALESCE(w.state->>'deletedAt', '') = ''
       AND (l.last_started_at IS NULL OR l.last_started_at <= now() - p_cooldown)
       AND (l.lease_until IS NULL OR l.lease_until <= now())
       AND EXISTS (
         SELECT 1 FROM parallel_life.world_clock_activity a
          WHERE a.world_id = c.world_id AND a.owner_id = c.owner_id
            AND a.mode <> 'away' AND a.expires_at > now()
       )
       AND NOT EXISTS (
         SELECT 1 FROM parallel_life.world_return_briefings b
          WHERE b.world_id = c.world_id AND b.owner_id = c.owner_id
            AND b.status = 'running' AND b.lease_until > now()
       )
       AND NOT EXISTS (
         SELECT 1 FROM parallel_life.publication_world_bindings b
          WHERE b.world_id = c.world_id AND b.owner_id = c.owner_id AND b.kind = 'trial'
       )
       AND NOT EXISTS (
         SELECT 1 FROM parallel_life.world_builds b
          WHERE b.world_id = c.world_id AND b.owner_id = c.owner_id
            AND b.opening->>'originKind' = 'trial'
       )
     ORDER BY COALESCE(l.last_started_at, '-infinity'::timestamptz), c.world_id
     LIMIT wanted
  LOOP
    INSERT INTO parallel_life.world_proactive_leases(world_id, owner_id, lease_until, last_started_at, updated_at)
    VALUES(candidate.world_id, candidate.owner_id, now() + p_lease, now(), now())
    ON CONFLICT(world_id) DO UPDATE
      SET owner_id = EXCLUDED.owner_id,
          lease_until = EXCLUDED.lease_until,
          last_started_at = EXCLUDED.last_started_at,
          updated_at = now();
    claimed_owner_id := candidate.owner_id;
    claimed_world_id := candidate.world_id;
    RETURN NEXT;
  END LOOP;
END $fn$;

REVOKE ALL ON FUNCTION parallel_life.claim_proactive_worlds(integer, interval, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.claim_proactive_worlds(integer, interval, interval) TO pl_scheduler;
GRANT EXECUTE ON FUNCTION parallel_life.claim_proactive_worlds(integer, interval, interval) TO pl_app;
