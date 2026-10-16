-- Continue an owner's already admitted published world after downlisting or a new edition.
-- Never substitute the new edition's card for a world bound to an older immutable version.
CREATE OR REPLACE FUNCTION parallel_life.publication_player_catalog(cursor_id uuid,take_count integer)
 RETURNS TABLE(id uuid,version bigint,title text,hook text,identity_label text,experience_note text,description text,world_id text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF take_count IS NULL OR take_count NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'INVALID_CATALOG_LIMIT' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 SELECT w.id,v.version,v.card->>'title',v.card->>'hook',v.card->>'identityLabel',
        v.card->>'experienceNote',v.card->>'description',saved.world_id
 FROM parallel_life.publication_works w
 LEFT JOIN LATERAL (
  SELECT b.publication_version,b.world_id
  FROM parallel_life.publication_world_bindings b
  JOIN parallel_life.worlds owned ON owned.id=b.world_id AND owned.owner_id=b.owner_id
  WHERE b.work_id=w.id AND b.kind='published_work'
    AND b.owner_id=current_setting('app.user_id',true)
  ORDER BY b.created_at DESC,b.publication_version DESC,b.id DESC
  LIMIT 1
 ) saved ON true
 JOIN parallel_life.publication_versions v
   ON v.work_id=w.id AND v.version=COALESCE(saved.publication_version,
        CASE WHEN w.listed THEN w.publication_version ELSE NULL END)
 WHERE (cursor_id IS NULL OR w.id>cursor_id) AND (w.listed OR saved.world_id IS NOT NULL)
 ORDER BY w.id LIMIT take_count+1;
END $$;
REVOKE ALL ON FUNCTION parallel_life.publication_player_catalog(uuid,integer) FROM PUBLIC,pl_worker,pl_publisher;
GRANT EXECUTE ON FUNCTION parallel_life.publication_player_catalog(uuid,integer) TO pl_app;
