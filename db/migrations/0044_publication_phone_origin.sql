-- Runtime may verify its own immutable source without receiving the private publication workspace.
CREATE FUNCTION parallel_life.player_publication_origin(w text,s uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('workId',b.work_id,'publicationVersion',COALESCE(b.publication_version,0),
   'draftVersion',b.draft_version,'contentHash',b.content_hash,'kind',b.kind)
 FROM parallel_life.publication_world_bindings b
 WHERE b.world_id=w AND b.seed_id=s AND b.owner_id=current_setting('app.user_id',true)
$$;
REVOKE ALL ON FUNCTION parallel_life.player_publication_origin(text,uuid) FROM PUBLIC,pl_worker,pl_publisher;
GRANT EXECUTE ON FUNCTION parallel_life.player_publication_origin(text,uuid) TO pl_app;
