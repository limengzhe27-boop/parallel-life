-- Exact bound fictional manuscript context. Never exposed by a public HTTP route.
CREATE OR REPLACE FUNCTION parallel_life.publication_director_setting(w text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d jsonb; overall text; BEGIN
 SELECT r.content INTO d FROM parallel_life.publication_world_bindings b
 JOIN parallel_life.publication_draft_revisions r ON r.work_id=b.work_id AND r.version=b.draft_version AND r.content_hash=b.content_hash
 WHERE b.world_id=w AND b.owner_id=current_setting('app.user_id',true);
 IF d IS NULL THEN RETURN NULL; END IF;
 SELECT e->'data'->>'text' INTO overall FROM jsonb_array_elements(d->'extensions') e
 WHERE e->>'namespace'='parallel_life.authoring_overall' AND e->'version'='1'::jsonb AND e->>'purpose'='editorial';
 RETURN jsonb_build_object('setting',d->'world'->>'publicSetting','tone',d->'world'->>'tone','hiddenContext',d->'world'->>'hiddenContext',
 'identity',d->'protagonist'->>'identity','situation',d->'protagonist'->>'situation','overallSetting',overall,
 'characterSettings',COALESCE((SELECT jsonb_agg(jsonb_build_object('actorKey',a->>'key','name',a->>'name','lifeModules',a->'lifeModules')) FROM jsonb_array_elements(d->'actors') a WHERE a ? 'lifeModules'),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION parallel_life.publication_director_setting(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.publication_director_setting(text) TO pl_app;
CREATE FUNCTION parallel_life.publication_actor_life_modules(w text,a text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; BEGIN
 SELECT actor->'lifeModules' INTO result FROM parallel_life.publication_world_bindings b
 JOIN parallel_life.publication_draft_revisions r ON r.work_id=b.work_id AND r.version=b.draft_version AND r.content_hash=b.content_hash
 JOIN parallel_life.world_builds wb ON wb.world_id=b.world_id AND wb.owner_id=b.owner_id AND wb.seed_id=b.seed_id
 CROSS JOIN LATERAL jsonb_array_elements(wb.opening->'contacts') contact
 CROSS JOIN LATERAL jsonb_array_elements(r.content->'actors') actor
 WHERE b.world_id=w AND b.owner_id=current_setting('app.user_id',true) AND contact->>'actorId'=a AND actor->>'key'=contact->>'actorKey';
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION parallel_life.publication_actor_life_modules(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.publication_actor_life_modules(text,text) TO pl_app;
