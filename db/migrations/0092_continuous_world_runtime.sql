-- World run-state is independent of browser presence. No old save is force-resumed.
ALTER TABLE parallel_life.world_clock
 ADD COLUMN continuity_mode text NOT NULL DEFAULT 'presence' CHECK (continuity_mode IN ('presence','continuous')),
 ADD COLUMN pause_reason text CHECK (pause_reason IN ('legacy','manual'));
UPDATE parallel_life.world_clock SET pause_reason='legacy' WHERE paused;

-- Own-world policy adoption uses the immutable publication binding, not editable UI metadata.
CREATE FUNCTION parallel_life.world_continuity_admissible(w text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM parallel_life.worlds x
 JOIN parallel_life.agent_runtime_worlds r ON r.world_id=x.id AND r.owner_id=x.owner_id
 WHERE x.id=w AND x.owner_id=current_setting('app.user_id',true) AND r.engine_epoch>=2
 AND NOT EXISTS(SELECT 1 FROM parallel_life.publication_world_bindings b WHERE b.world_id=x.id AND b.owner_id=x.owner_id AND b.kind='trial')
 AND NOT EXISTS(SELECT 1 FROM parallel_life.world_builds b WHERE b.world_id=x.id AND b.owner_id=x.owner_id AND b.opening->>'originKind'='trial'))
$$;
REVOKE ALL ON FUNCTION parallel_life.world_continuity_admissible(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.world_continuity_admissible(text) TO pl_app;

-- Source eligibility, world reads and NPC execution use the same piecewise projection.
CREATE OR REPLACE FUNCTION parallel_life.publication_story_clock(w text) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT GREATEST((x.state->>'time')::timestamptz,c.story_now + CASE
  WHEN c.paused THEN interval '0'
  WHEN c.continuity_mode='continuous' THEN (
    GREATEST(EXTRACT(EPOCH FROM (LEAST(now(),COALESCE(c.active_until,c.last_tick_at))-c.last_tick_at)),0)*c.speed
    + GREATEST(EXTRACT(EPOCH FROM (now()-GREATEST(c.last_tick_at,COALESCE(c.active_until,c.last_tick_at)))),0)
   )*interval '1 second'
  WHEN c.managed AND c.active_until IS NULL THEN interval '0'
  ELSE GREATEST(EXTRACT(EPOCH FROM ((CASE WHEN c.managed THEN LEAST(now(),c.active_until) ELSE now() END)-c.last_tick_at)),0)*c.speed*interval '1 second' END)
 FROM parallel_life.worlds x JOIN parallel_life.world_clock c ON c.world_id=x.id AND c.owner_id=x.owner_id
 WHERE x.id=w AND x.owner_id=current_setting('app.user_id',true)
$$;

-- Keep the existing global paid-work ceiling and cron frequency. Do not turn this into a
-- per-minute model loop or resume trials/unknown calls. Original native scheduling owns causes.
CREATE OR REPLACE FUNCTION parallel_life.claim_due_worlds()
RETURNS TABLE(owner_id text,world_id text) LANGUAGE plpgsql SECURITY DEFINER
SET search_path=parallel_life,pg_temp AS $fn$
DECLARE candidate record; remaining integer; today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(82147230);
 SELECT GREATEST(0,2-count(*)) INTO remaining FROM parallel_life.world_scheduler_claims WHERE run_day=today;
 IF remaining=0 THEN RETURN; END IF;
 FOR candidate IN
  SELECT c.owner_id,c.world_id FROM parallel_life.world_clock c
  JOIN parallel_life.worlds w ON w.id=c.world_id AND w.owner_id=c.owner_id
  WHERE NOT c.paused AND c.last_tick_at<=now()-interval '20 hours'
   AND (c.continuity_mode='continuous' OR NOT c.managed OR c.active_until>now())
   AND NOT EXISTS(SELECT 1 FROM parallel_life.publication_world_bindings b WHERE b.world_id=c.world_id AND b.owner_id=c.owner_id AND b.kind='trial')
   AND NOT EXISTS(SELECT 1 FROM parallel_life.world_builds b WHERE b.world_id=c.world_id AND b.owner_id=c.owner_id AND b.opening->>'originKind'='trial')
   AND NOT EXISTS(SELECT 1 FROM parallel_life.world_director_attempts a WHERE a.world_id=c.world_id AND a.owner_id=c.owner_id AND a.status IN ('started','unknown'))
   AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_attempts a WHERE a.world_id=c.world_id AND a.owner_id=c.owner_id AND a.status IN ('reserved','request_sent','response_received','unknown_after_send'))
   AND NOT EXISTS(SELECT 1 FROM parallel_life.director_runtime_attempts a WHERE a.world_id=c.world_id AND a.owner_id=c.owner_id AND a.status IN ('reserved','request_sent','response_received','unknown_after_send'))
   AND NOT EXISTS(SELECT 1 FROM parallel_life.world_scheduler_claims x WHERE x.run_day=today AND x.world_id=c.world_id)
  ORDER BY (c.continuity_mode='continuous') DESC,c.last_tick_at,c.world_id LIMIT remaining
 LOOP
  INSERT INTO parallel_life.world_scheduler_claims(run_day,world_id,owner_id) VALUES(today,candidate.world_id,candidate.owner_id);
  owner_id:=candidate.owner_id;world_id:=candidate.world_id;RETURN NEXT;
 END LOOP;
END $fn$;
