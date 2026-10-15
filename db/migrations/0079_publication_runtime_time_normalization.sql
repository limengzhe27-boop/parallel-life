-- Normalize runtime JSON at the authoritative admission boundary too. This keeps the
-- old and new application compilers safe during a rolling deployment without weakening
-- the source equality guard or rewriting any immutable authored draft/version.
CREATE FUNCTION parallel_life.publication_runtime_instant(v text) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $function$
 SELECT to_char(
   regexp_replace(v,'([.][0-9]{3})[0-9]+(Z|[+-][0-9]{2}:[0-9]{2})$','\1\2')::timestamptz
   AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 $function$;
REVOKE ALL ON FUNCTION parallel_life.publication_runtime_instant(text)
 FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;

DO $migration$
DECLARE definition text; marker text; normalization text;
BEGIN
 definition=pg_get_functiondef('parallel_life.publication_commit_internal(text,uuid,jsonb)'::regprocedure);
 marker=$marker$world=prepared->'world';seed=prepared->'seed';opening=prepared->'opening';src='publication-genesis:'||a.world_id;$marker$;
 normalization=$body$
 world=jsonb_set(world,'{time}',to_jsonb(parallel_life.publication_runtime_instant(world->>'time')));
 world=jsonb_set(world,'{messageHistory,startAt}',to_jsonb(parallel_life.publication_runtime_instant(world->'messageHistory'->>'startAt')));
 world=jsonb_set(world,'{messages}',COALESCE(
  (SELECT jsonb_agg(jsonb_set(value,'{at}',to_jsonb(parallel_life.publication_runtime_instant(value->>'at'))) ORDER BY ord)
   FROM jsonb_array_elements(world->'messages') WITH ORDINALITY AS x(value,ord)),'[]'::jsonb));
 world=jsonb_set(world,'{appointments}',COALESCE(
  (SELECT jsonb_agg(jsonb_set(value,'{at}',to_jsonb(parallel_life.publication_runtime_instant(value->>'at'))) ORDER BY ord)
   FROM jsonb_array_elements(world->'appointments') WITH ORDINALITY AS x(value,ord)),'[]'::jsonb));
 $body$;
 IF (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1
 THEN RAISE EXCEPTION 'PUBLICATION_NORMALIZATION_BASELINE_CHANGED'; END IF;
 EXECUTE replace(definition,marker,marker||normalization);
END $migration$;
