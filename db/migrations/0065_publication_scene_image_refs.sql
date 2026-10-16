-- A scene picture is an optional, privately stored image attached to an
-- authored place. It is never inferred from a public URL or a media registry
-- label. The immutable publication source and the actual world map both matter.
CREATE FUNCTION parallel_life.publication_scene_assert_content(w uuid, c jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE place jsonb; image jsonb; asset_id uuid;
BEGIN
 FOR place IN SELECT value FROM jsonb_array_elements(COALESCE(c->'places','[]'::jsonb)) LOOP
  image:=place->'sceneImage';
  IF image IS NULL OR jsonb_typeof(image)='null' THEN CONTINUE; END IF;
  IF jsonb_typeof(image)<>'object'
   OR image->>'assetId' IS NULL
   OR image->>'assetId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'PUBLICATION_SCENE_IMAGE_INVALID' USING ERRCODE='23514';
  END IF;
  asset_id:=(image->>'assetId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM parallel_life.publication_media_assets m
     WHERE m.id=asset_id AND m.work_id=w AND m.kind='image' AND m.status='ready') THEN
   RAISE EXCEPTION 'PUBLICATION_SCENE_IMAGE_NOT_READY' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION parallel_life.publication_scene_version_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM parallel_life.publication_scene_assert_content(NEW.work_id,NEW.content);
 RETURN NEW;
END $$;
CREATE TRIGGER publication_scene_version_guard BEFORE INSERT ON parallel_life.publication_versions
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_scene_version_guard();

CREATE FUNCTION parallel_life.publication_scene_binding_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb;
BEGIN
 IF NEW.kind='trial' THEN
  SELECT d.content INTO c FROM parallel_life.publication_draft_revisions d
   WHERE d.work_id=NEW.work_id AND d.version=NEW.draft_version AND d.content_hash=NEW.content_hash;
 ELSE
  SELECT v.content INTO c FROM parallel_life.publication_versions v
   WHERE v.work_id=NEW.work_id AND v.version=NEW.publication_version
    AND v.draft_version=NEW.draft_version AND v.content_hash=NEW.content_hash;
 END IF;
 IF c IS NULL THEN RAISE EXCEPTION 'PUBLICATION_SCENE_SOURCE_MISSING' USING ERRCODE='23514'; END IF;
 PERFORM parallel_life.publication_scene_assert_content(NEW.work_id,c);
 RETURN NEW;
END $$;
CREATE TRIGGER publication_scene_binding_guard BEFORE INSERT ON parallel_life.publication_world_bindings
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_scene_binding_guard();

-- The app role can only see scenes referenced by this owner's immutable source
-- and whose place is currently present in this player's actual world space.
-- Unvisited/unrevealed places do not leak their pictures or even asset IDs.
CREATE FUNCTION parallel_life.publication_scene_images_for_world(w text)
 RETURNS TABLE(place_key text,asset_id uuid,storage_key text,mime_type text,byte_length bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; c jsonb; current_state jsonb;
BEGIN
 SELECT binding.* INTO b FROM parallel_life.publication_world_bindings binding
 JOIN parallel_life.worlds owned ON owned.id=binding.world_id AND owned.owner_id=binding.owner_id
 WHERE binding.world_id=w AND binding.owner_id=current_setting('app.user_id',true);
 IF NOT FOUND THEN RETURN; END IF;
 SELECT owned.state INTO current_state FROM parallel_life.worlds owned
  WHERE owned.id=w AND owned.owner_id=b.owner_id;
 IF current_state IS NULL THEN RETURN; END IF;
 IF b.kind='trial' THEN
  SELECT d.content INTO c FROM parallel_life.publication_draft_revisions d
   WHERE d.work_id=b.work_id AND d.version=b.draft_version AND d.content_hash=b.content_hash;
 ELSE
  SELECT v.content INTO c FROM parallel_life.publication_versions v
   WHERE v.work_id=b.work_id AND v.version=b.publication_version
    AND v.draft_version=b.draft_version AND v.content_hash=b.content_hash;
 END IF;
 IF c IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT authored.place->>'key',m.id,m.storage_key,m.mime_type,m.byte_length
 FROM jsonb_array_elements(COALESCE(c->'places','[]'::jsonb)) authored(place)
 JOIN parallel_life.publication_media_assets m
  ON m.id=(CASE WHEN authored.place->'sceneImage'->>'assetId'
                  ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (authored.place->'sceneImage'->>'assetId')::uuid ELSE NULL END)
  AND m.work_id=b.work_id AND m.kind='image' AND m.status='ready'
 WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(current_state->'space'->'places','[]'::jsonb)) known(place)
  WHERE known.place->>'id'=authored.place->>'key');
END $$;

CREATE FUNCTION parallel_life.publication_scene_image_for_world(w text,a uuid)
 RETURNS TABLE(storage_key text,mime_type text,byte_length bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT visible.storage_key,visible.mime_type,visible.byte_length
 FROM parallel_life.publication_scene_images_for_world(w) visible WHERE visible.asset_id=a
$$;

REVOKE ALL ON FUNCTION parallel_life.publication_scene_assert_content(uuid,jsonb),
 parallel_life.publication_scene_version_guard(),parallel_life.publication_scene_binding_guard(),
 parallel_life.publication_scene_images_for_world(text),
 parallel_life.publication_scene_image_for_world(text,uuid)
 FROM PUBLIC,pl_app,pl_worker,pl_publisher;
GRANT EXECUTE ON FUNCTION parallel_life.publication_scene_images_for_world(text),
 parallel_life.publication_scene_image_for_world(text,uuid) TO pl_app;
