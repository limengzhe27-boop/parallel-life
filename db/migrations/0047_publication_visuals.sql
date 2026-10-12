-- Only approved visual references from the exact owned publication are exposed.
-- No private profile assets, actor Persona or future plot is returned.
CREATE FUNCTION parallel_life.publication_world_visuals(w text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; c jsonb;
BEGIN
 SELECT p.* INTO b FROM parallel_life.publication_world_bindings p
 JOIN parallel_life.worlds owned ON owned.id=p.world_id AND owned.owner_id=p.owner_id
 WHERE p.world_id=w AND p.owner_id=current_setting('app.user_id',true);
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF b.kind='trial' THEN
  SELECT content INTO c FROM parallel_life.publication_draft_revisions
   WHERE work_id=b.work_id AND version=b.draft_version AND content_hash=b.content_hash;
 ELSE
  SELECT content INTO c FROM parallel_life.publication_versions
   WHERE work_id=b.work_id AND version=b.publication_version AND content_hash=b.content_hash;
 END IF;
 RETURN jsonb_build_object(
  'coverMediaKey',c->'work'->'coverMediaKey',
  'actors',COALESCE((SELECT jsonb_agg(jsonb_build_object('actorKey',a->>'key','mediaKey',a->'publicCard'->>'avatarMediaKey'))
    FROM jsonb_array_elements(c->'actors') a WHERE a->>'knownAtStart'='true' AND a->'publicCard'->>'avatarMediaKey' IS NOT NULL),'[]'::jsonb),
  'media',COALESCE((SELECT jsonb_agg(m) FROM jsonb_array_elements(c->'media') m
    WHERE m->>'use' IN ('cover','avatar') AND m->'visibility'->>'kind'='world'
      AND m->'asset'->>'namespace'='publication' AND m->>'depiction'='generated_image'),'[]'::jsonb));
END $$;
CREATE FUNCTION parallel_life.publication_catalog_visual(w uuid,v bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m FROM parallel_life.publication_versions pv
 JOIN parallel_life.publication_works works ON works.id=pv.work_id
 CROSS JOIN LATERAL jsonb_array_elements(pv.content->'media') m
 WHERE pv.work_id=w AND pv.version=v AND m->>'key'=pv.content->'work'->>'coverMediaKey'
 AND m->>'use'='cover' AND m->'visibility'->>'kind'='world'
 AND m->'asset'->>'namespace'='publication' AND m->>'depiction'='generated_image'
 AND ((works.listed AND works.publication_version=v) OR EXISTS(
  SELECT 1 FROM parallel_life.publication_world_bindings b JOIN parallel_life.worlds owned
   ON owned.id=b.world_id AND owned.owner_id=b.owner_id
  WHERE b.work_id=w AND b.publication_version=v AND b.kind='published_work'
   AND b.owner_id=current_setting('app.user_id',true)))
$$;
REVOKE ALL ON FUNCTION parallel_life.publication_world_visuals(text),parallel_life.publication_catalog_visual(uuid,bigint) FROM PUBLIC,pl_worker,pl_publisher;
GRANT EXECUTE ON FUNCTION parallel_life.publication_world_visuals(text),parallel_life.publication_catalog_visual(uuid,bigint) TO pl_app;
