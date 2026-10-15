-- Real-time pacing is independent of story clock speed. Preserve source, owner and uncertain-attempt guards.
CREATE OR REPLACE FUNCTION parallel_life.publication_story_selection_begin(w text,o text,v bigint,a uuid,keys jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE world_version bigint; plan jsonb; BEGIN
 IF o IS DISTINCT FROM current_setting('app.user_id',true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT version INTO world_version FROM parallel_life.worlds WHERE id=w AND owner_id=o FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF world_version<>v THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='P0001'; END IF;
 SELECT document INTO plan FROM parallel_life.publication_story_plans WHERE world_id=w AND owner_id=o;
 IF plan IS NULL OR jsonb_typeof(keys) IS DISTINCT FROM 'array' OR jsonb_array_length(keys) NOT BETWEEN 1 AND 24
 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(keys))<>jsonb_array_length(keys)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(keys) key WHERE jsonb_typeof(key)<>'string' OR NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(plan->'nodes') n WHERE n->>'key'=key#>>'{}' AND n->'intent'->>'kind'<>'editorial_only'))
 THEN RAISE EXCEPTION 'INVALID_SELECTION_POOL' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM parallel_life.publication_story_nodes WHERE world_id=w AND owner_id=o AND status IN ('claimed','unknown'))
 OR EXISTS(SELECT 1 FROM parallel_life.publication_story_selections WHERE world_id=w AND owner_id=o AND
 (created_at>clock_timestamp()-interval '90 seconds' OR (expected_version=v AND status IN ('claimed','unknown')))) THEN RETURN false; END IF;
 INSERT INTO parallel_life.publication_story_selections(id,world_id,owner_id,expected_version,candidate_keys,status) VALUES(a,w,o,v,keys,'claimed');
 RETURN true;
END $$;

-- Source eligibility and runtime projection must share the foreground deadline.
CREATE OR REPLACE FUNCTION parallel_life.publication_story_clock(w text) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT GREATEST((x.state->>'time')::timestamptz,c.story_now+CASE WHEN c.paused OR (c.managed AND c.active_until IS NULL) THEN interval '0' ELSE GREATEST(EXTRACT(EPOCH FROM (CASE WHEN c.managed THEN LEAST(now(),c.active_until) ELSE now() END)-c.last_tick_at),0)*c.speed*interval '1 second' END)
 FROM parallel_life.worlds x JOIN parallel_life.world_clock c ON c.world_id=x.id AND c.owner_id=x.owner_id
 WHERE x.id=w AND x.owner_id=current_setting('app.user_id',true)
$$;
