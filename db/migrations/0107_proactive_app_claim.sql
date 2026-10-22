-- The app server already has the only cross-owner scheduler connection it needs.
-- Re-expose the same claim function with unambiguous output names and allow the
-- application role to execute it; no second database URL is required.
DROP FUNCTION IF EXISTS parallel_life.claim_proactive_worlds(integer, interval, interval);

CREATE OR REPLACE FUNCTION parallel_life.claim_proactive_worlds(
  p_max integer DEFAULT 2,
  p_cooldown interval DEFAULT interval '30 minutes',
  p_lease interval DEFAULT interval '10 minutes'
)
RETURNS TABLE(claimed_owner_id text, claimed_world_id text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = parallel_life, pg_temp
AS $fn$
DECLARE
  candidate record;
  wanted integer := GREATEST(1, LEAST(COALESCE(p_max, 2), 6));
BEGIN
  PERFORM pg_advisory_xact_lock(82147231);
  FOR candidate IN
    SELECT c.owner_id, c.world_id
      FROM parallel_life.world_clock c
      JOIN parallel_life.worlds w ON w.id = c.world_id AND w.owner_id = c.owner_id
      JOIN parallel_life.agent_runtime_worlds r ON r.world_id = c.world_id AND r.owner_id = c.owner_id
      LEFT JOIN parallel_life.world_proactive_leases l ON l.world_id = c.world_id
     WHERE NOT c.paused
       AND r.engine_epoch >= 2
       AND COALESCE(w.state->>'deletedAt', '') = ''
       AND (l.last_started_at IS NULL OR l.last_started_at <= now() - p_cooldown)
       AND (l.lease_until IS NULL OR l.lease_until <= now())
       AND NOT EXISTS (
         SELECT 1 FROM parallel_life.publication_world_bindings b
          WHERE b.world_id = c.world_id AND b.owner_id = c.owner_id AND b.kind = 'trial'
       )
       AND NOT EXISTS (
         SELECT 1 FROM parallel_life.world_builds b
          WHERE b.world_id = c.world_id AND b.owner_id = c.owner_id
            AND b.opening->>'originKind' = 'trial'
       )
       AND NOT EXISTS (
         SELECT 1 FROM parallel_life.agent_attempts a
          WHERE a.world_id = c.world_id AND a.owner_id = c.owner_id
            AND a.status IN ('reserved','request_sent','response_received','unknown_after_send')
       )
       AND NOT EXISTS (
         SELECT 1 FROM parallel_life.director_runtime_attempts a
          WHERE a.world_id = c.world_id AND a.owner_id = c.owner_id
            AND a.status IN ('reserved','request_sent','response_received','unknown_after_send')
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
