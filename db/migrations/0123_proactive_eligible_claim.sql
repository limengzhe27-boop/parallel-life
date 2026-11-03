-- Background execution only claims continuous worlds; foreground entry remains independent.
-- Reuse per-world leases; paid-call isolation is enforced by actor/resource scheduling.
-- Lease rows are not an execution ledger and must not impose a global daily count.
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

-- Current actor suffix/anchor reads must not sort lifetime history or materialize raw responses.
CREATE INDEX agent_attempt_actor_commits_idx ON parallel_life.agent_attempts
 (world_id, owner_id, actor_id, engine_epoch, expected_actor_revision DESC, expected_world_version DESC)
 WHERE status='committed';
