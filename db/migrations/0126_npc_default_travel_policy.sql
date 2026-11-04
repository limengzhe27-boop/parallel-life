-- NPCs and players use the existing default_travel_v1 convention. Derived edges
-- are verified, not inserted into the map. No actor position or journey is seeded.
CREATE FUNCTION parallel_life.valid_default_travel_route(space jsonb, route jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE from_id text := route->>'fromPlaceId'; to_id text := route->>'toPlaceId';
  bytes bytea; h numeric := 14695981039346656037; signed_h bigint; i integer; expected_id text;
BEGIN
 IF from_id IS NULL OR to_id IS NULL OR from_id=to_id
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(space->'places') p WHERE p->>'id'=from_id)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(space->'places') p WHERE p->>'id'=to_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(space->'routes') r WHERE r->>'fromPlaceId'=from_id AND r->>'toPlaceId'=to_id)
 THEN RETURN false; END IF;
 -- Space IDs are ASCII; this is the same FNV-1a/64 of JSON.stringify([from,to]).
 IF from_id !~ '^[a-z0-9_]{1,64}$' OR to_id !~ '^[a-z0-9_]{1,64}$' THEN RETURN false; END IF;
 bytes := convert_to('[' || to_json(from_id)::text || ',' || to_json(to_id)::text || ']', 'UTF8');
 FOR i IN 0..octet_length(bytes)-1 LOOP
  signed_h := (CASE WHEN h>=9223372036854775808 THEN h-18446744073709551616 ELSE h END)::bigint;
  h := mod(mod((signed_h # get_byte(bytes,i))::numeric*1099511628211,18446744073709551616)+18446744073709551616,18446744073709551616);
 END LOOP;
 signed_h := (CASE WHEN h>=9223372036854775808 THEN h-18446744073709551616 ELSE h END)::bigint;
 expected_id := 'default_travel_' || lpad(to_hex(signed_h),16,'0');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(space->'routes') r WHERE r->>'id'=expected_id) THEN RETURN false; END IF;
 RETURN route=jsonb_build_object('id',expected_id,'fromPlaceId',from_id,'toPlaceId',to_id,
  'durationMinutes',10,'modeLabel','前往','source',jsonb_build_object('kind','system_policy','policy','default_travel_v1','snapshotVersion',0));
END $$;
REVOKE ALL ON FUNCTION parallel_life.valid_default_travel_route(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.valid_default_travel_route(jsonb,jsonb) TO pl_app;

-- Retain the current origin/attempt/result/lease guard (including prior fixes).
DO $migration$
DECLARE body text; old_rule text := 'EXISTS(SELECT 1 FROM jsonb_array_elements(w.state->''space''->''routes'') route WHERE route=NEW.document->''route'')';
BEGIN
 body := pg_get_functiondef('parallel_life.guard_npc_journey()'::regprocedure);
 IF strpos(body,old_rule)=0 THEN RAISE EXCEPTION 'UNEXPECTED_NPC_JOURNEY_ROUTE_GUARD'; END IF;
 EXECUTE replace(body,old_rule,'(' || old_rule || ' OR parallel_life.valid_default_travel_route(w.state->''space'',NEW.document->''route''))');
END
$migration$;
