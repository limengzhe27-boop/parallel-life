-- Keep the owner-read nullable contract; leased workers retain scene/actor guards.
CREATE OR REPLACE FUNCTION parallel_life.publication_actor_life_modules(w text,a text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o text; caller text; result jsonb;
BEGIN
 caller:=CASE WHEN COALESCE(current_setting('role',true),'none')='none' THEN session_user ELSE current_setting('role',true) END;
 IF pg_has_role(caller,'pl_app','MEMBER') THEN
  SELECT owner_id INTO o FROM parallel_life.worlds WHERE id=w AND owner_id=current_setting('app.user_id',true);
  IF o IS NULL THEN RETURN NULL; END IF;
 ELSE
  o:=parallel_life.publication_scene_goal_owner(w);
 END IF;
 IF pg_has_role(caller,'pl_worker','MEMBER') AND NOT parallel_life.publication_scene_goal_actor(w,o,a)
 THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT actor->'lifeModules' INTO result FROM parallel_life.publication_world_bindings b
 JOIN LATERAL (
  SELECT d.content FROM parallel_life.publication_draft_revisions d
   WHERE b.kind='trial' AND d.work_id=b.work_id AND d.version=b.draft_version AND d.content_hash=b.content_hash
  UNION ALL
  SELECT v.content FROM parallel_life.publication_versions v
   WHERE b.kind='published_work' AND v.work_id=b.work_id AND v.version=b.publication_version
    AND v.draft_version=b.draft_version AND v.content_hash=b.content_hash
 ) saved ON true
 JOIN parallel_life.world_builds wb ON wb.world_id=b.world_id AND wb.owner_id=b.owner_id AND wb.seed_id=b.seed_id
 JOIN LATERAL jsonb_array_elements(wb.opening->'contacts') contact ON contact->>'actorId'=a
 JOIN LATERAL jsonb_array_elements(saved.content->'actors') actor ON actor->>'key'=contact->>'actorKey'
 WHERE b.world_id=w AND b.owner_id=o;
 RETURN result;
END $$;
