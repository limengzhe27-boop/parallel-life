-- A character's optional stage image is private work media. Keep avatar and
-- stage uses distinct without adding tables, columns, or mutable world bindings.
CREATE FUNCTION parallel_life.publication_actor_stage_assert_content(w uuid,c jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor jsonb; image jsonb; asset_id uuid;
BEGIN
 FOR actor IN SELECT value FROM jsonb_array_elements(COALESCE(c->'actors','[]'::jsonb)) LOOP
  image:=actor->'publicCard'->'stageImage';
  IF image IS NULL OR jsonb_typeof(image)='null' THEN CONTINUE; END IF;
  IF jsonb_typeof(image)<>'object' OR image->>'assetId' IS NULL
   OR image->>'assetId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'PUBLICATION_ACTOR_STAGE_IMAGE_INVALID' USING ERRCODE='23514';
  END IF;
  asset_id:=(image->>'assetId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM parallel_life.publication_media_assets m
   WHERE m.id=asset_id AND m.work_id=w AND m.kind='image' AND m.status='ready'
     AND m.mime_type IN ('image/png','image/webp','image/jpeg')) THEN
   RAISE EXCEPTION 'PUBLICATION_ACTOR_STAGE_IMAGE_NOT_READY' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION parallel_life.publication_actor_stage_version_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM parallel_life.publication_actor_stage_assert_content(NEW.work_id,NEW.content);
 RETURN NEW;
END $$;
CREATE TRIGGER publication_actor_stage_version_guard BEFORE INSERT ON parallel_life.publication_versions
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_actor_stage_version_guard();

CREATE FUNCTION parallel_life.publication_actor_stage_binding_guard() RETURNS trigger
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
 IF c IS NULL THEN RAISE EXCEPTION 'PUBLICATION_ACTOR_STAGE_SOURCE_MISSING' USING ERRCODE='23514'; END IF;
 PERFORM parallel_life.publication_actor_stage_assert_content(NEW.work_id,c);
 RETURN NEW;
END $$;
CREATE TRIGGER publication_actor_stage_binding_guard BEFORE INSERT ON parallel_life.publication_world_bindings
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_actor_stage_binding_guard();

-- Read exactly the owned immutable source. The established source function
-- authenticates contact actorKey/actorId mappings against the genesis binding.
-- Unknown authored actors stay private; a runtime actor ID alone is not reveal evidence.
CREATE FUNCTION parallel_life.publication_actor_stage_images_for_world(w text)
 RETURNS TABLE(actor_id text,asset_id uuid,storage_key text,mime_type text,byte_length bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; c jsonb; current_state jsonb; source jsonb; world_version bigint;
BEGIN
 SELECT binding.* INTO b FROM parallel_life.publication_world_bindings binding
 JOIN parallel_life.worlds owned ON owned.id=binding.world_id AND owned.owner_id=binding.owner_id
 WHERE binding.world_id=w AND binding.owner_id=current_setting('app.user_id',true);
 IF NOT FOUND THEN RETURN; END IF;
 SELECT owned.state,owned.version INTO current_state,world_version FROM parallel_life.worlds owned WHERE owned.id=w AND owned.owner_id=b.owner_id;
 IF current_state IS NULL THEN RETURN; END IF;
 IF b.kind='trial' THEN
  SELECT d.content INTO c FROM parallel_life.publication_draft_revisions d
   WHERE d.work_id=b.work_id AND d.version=b.draft_version AND d.content_hash=b.content_hash;
 ELSE
  SELECT v.content INTO c FROM parallel_life.publication_versions v
   WHERE v.work_id=b.work_id AND v.version=b.publication_version
    AND v.draft_version=b.draft_version AND v.content_hash=b.content_hash;
 END IF;
 IF c IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(c->'actors','[]'::jsonb)) a
   WHERE a->'publicCard'->'stageImage'->>'assetId' IS NOT NULL) THEN RETURN; END IF;
 source:=parallel_life.publication_story_source(w);
 IF source IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT contact.item->>'actorId',m.id,m.storage_key,m.mime_type,m.byte_length
 FROM jsonb_array_elements(COALESCE(c->'actors','[]'::jsonb)) authored(actor)
 JOIN LATERAL jsonb_array_elements(COALESCE(source->'contacts','[]'::jsonb)) contact(item)
   ON contact.item->>'actorKey'=authored.actor->>'key'
 JOIN parallel_life.publication_media_assets m
   ON m.id=(CASE WHEN authored.actor->'publicCard'->'stageImage'->>'assetId'
    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (authored.actor->'publicCard'->'stageImage'->>'assetId')::uuid ELSE NULL END)
   AND m.work_id=b.work_id AND m.kind='image' AND m.status='ready'
   AND m.mime_type IN ('image/png','image/webp','image/jpeg')
 WHERE (authored.actor->>'knownAtStart'='true' OR EXISTS(
    SELECT 1 FROM parallel_life.player_experiences experience
    JOIN parallel_life.scene_sessions scene ON scene.id=experience.current_scene_id
      AND scene.world_id=experience.world_id AND scene.owner_id=experience.owner_id
    WHERE experience.world_id=w AND experience.owner_id=b.owner_id
      AND scene.document->>'status'='active'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(scene.document->'presence','[]'::jsonb)) p
        WHERE p->'participant'->>'kind'='player'
          AND (p->>'joinedVersion')::bigint<=world_version
          AND (p->>'leftVersion' IS NULL OR world_version<(p->>'leftVersion')::bigint))
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(scene.document->'presence','[]'::jsonb)) p
        WHERE p->'participant'->>'kind'='actor' AND p->'participant'->>'actorId'=contact.item->>'actorId'
          AND (p->>'joinedVersion')::bigint<=world_version
          AND (p->>'leftVersion' IS NULL OR world_version<(p->>'leftVersion')::bigint))
  ))
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(current_state->'actors','[]'::jsonb)) actual(actor)
   WHERE actual.actor->>'id'=contact.item->>'actorId');
END $$;

CREATE FUNCTION parallel_life.publication_actor_stage_image_for_world(w text,a uuid)
 RETURNS TABLE(storage_key text,mime_type text,byte_length bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT visible.storage_key,visible.mime_type,visible.byte_length
 FROM parallel_life.publication_actor_stage_images_for_world(w) visible WHERE visible.asset_id=a LIMIT 1
$$;
REVOKE ALL ON FUNCTION parallel_life.publication_actor_stage_assert_content(uuid,jsonb),
 parallel_life.publication_actor_stage_version_guard(),parallel_life.publication_actor_stage_binding_guard(),
 parallel_life.publication_actor_stage_images_for_world(text),parallel_life.publication_actor_stage_image_for_world(text,uuid)
 FROM PUBLIC,pl_app,pl_worker,pl_publisher;
GRANT EXECUTE ON FUNCTION parallel_life.publication_actor_stage_images_for_world(text),
 parallel_life.publication_actor_stage_image_for_world(text,uuid) TO pl_app;
