-- Dedicated cross-owner scheduler may claim only due world IDs. It never reads
-- private world content or receives the application role's table privileges.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pl_scheduler') THEN
    CREATE ROLE pl_scheduler LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $role$;

CREATE TABLE parallel_life.world_scheduler_claims (
  run_day date NOT NULL,
  world_id text NOT NULL,
  owner_id text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_day, world_id),
  FOREIGN KEY(world_id, owner_id) REFERENCES parallel_life.worlds(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX world_scheduler_claims_day ON parallel_life.world_scheduler_claims(run_day);
REVOKE ALL ON parallel_life.world_scheduler_claims FROM PUBLIC;

CREATE FUNCTION parallel_life.claim_due_worlds()
RETURNS TABLE(owner_id text, world_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = parallel_life, pg_temp
AS $fn$
DECLARE
  candidate record;
  remaining integer;
  today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  -- Serializes duplicate/best-effort cron deliveries, including across regions.
  PERFORM pg_advisory_xact_lock(82147230);
  SELECT GREATEST(0, 2 - count(*)) INTO remaining
    FROM parallel_life.world_scheduler_claims WHERE run_day = today;
  IF remaining = 0 THEN RETURN; END IF;

  FOR candidate IN
    SELECT c.owner_id, c.world_id
      FROM parallel_life.world_clock c
      JOIN parallel_life.worlds w ON w.id = c.world_id AND w.owner_id = c.owner_id
     WHERE NOT c.paused
       AND c.last_tick_at <= now() - interval '20 hours'
       AND NOT EXISTS (
         SELECT 1 FROM parallel_life.world_director_attempts a
          WHERE a.world_id = c.world_id AND a.owner_id = c.owner_id
            AND a.status IN ('started', 'unknown')
       )
       AND NOT EXISTS (
         SELECT 1 FROM parallel_life.world_scheduler_claims x
          WHERE x.run_day = today AND x.world_id = c.world_id
       )
     ORDER BY c.last_tick_at, c.world_id
     LIMIT remaining
  LOOP
    INSERT INTO parallel_life.world_scheduler_claims(run_day, world_id, owner_id)
    VALUES(today, candidate.world_id, candidate.owner_id);
    owner_id := candidate.owner_id;
    world_id := candidate.world_id;
    RETURN NEXT;
  END LOOP;
END $fn$;

REVOKE ALL ON FUNCTION parallel_life.claim_due_worlds() FROM PUBLIC;
GRANT USAGE ON SCHEMA parallel_life TO pl_scheduler;
GRANT EXECUTE ON FUNCTION parallel_life.claim_due_worlds() TO pl_scheduler;
