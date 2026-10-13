-- Director-only fictional setting, scoped to this exact owner and bound edition.
CREATE FUNCTION parallel_life.publication_director_setting(w text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d jsonb; BEGIN
 SELECT r.content INTO d FROM parallel_life.publication_world_bindings b
 JOIN parallel_life.publication_draft_revisions r ON r.work_id=b.work_id AND r.version=b.draft_version AND r.content_hash=b.content_hash
 WHERE b.world_id=w AND b.owner_id=current_setting('app.user_id',true);
 IF d IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('setting',d->'world'->>'publicSetting','tone',d->'world'->>'tone','hiddenContext',d->'world'->>'hiddenContext',
 'identity',d->'protagonist'->>'identity','situation',d->'protagonist'->>'situation');
END $$;
REVOKE ALL ON FUNCTION parallel_life.publication_director_setting(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.publication_director_setting(text) TO pl_app;
