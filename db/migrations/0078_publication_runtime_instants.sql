-- Preserve the latest admission/ownership/content guards while comparing canonical runtime
-- milliseconds to the immutable author's instant. No authored draft/version is rewritten.
DO $migration$
DECLARE definition text; old_world text; new_world text; old_history text; new_history text;
BEGIN
 definition=pg_get_functiondef('parallel_life.publication_commit_internal(text,uuid,jsonb)'::regprocedure);
 old_world=$old$world->>'time' IS DISTINCT FROM content->'world'->>'startAt'$old$;
 new_world=$new$world->>'time' IS DISTINCT FROM to_char((regexp_replace(content->'world'->>'startAt','([.][0-9]{3})[0-9]+Z$','\1Z'))::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')$new$;
 old_history=$old$(j->>'at')::timestamptz=(m->>'at')::timestamptz$old$;
 new_history=$new$j->>'at'=to_char((regexp_replace(m->>'at','([.][0-9]{3})[0-9]+Z$','\1Z'))::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')$new$;
 IF (length(definition)-length(replace(definition,old_world,'')))/length(old_world)<>1
 OR (length(definition)-length(replace(definition,old_history,'')))/length(old_history)<>1
 THEN RAISE EXCEPTION 'PUBLICATION_INSTANT_GUARD_BASELINE_CHANGED'; END IF;
 definition=replace(replace(definition,old_world,new_world),old_history,new_history);
 EXECUTE definition;
END $migration$;
