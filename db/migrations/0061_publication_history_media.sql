-- Writer-authored chat media lives outside draft JSON. The bucket is private and
-- provisioned separately with a 50,000,000-byte object limit; this table only
-- records staff-owned references and never grants player direct table access.
CREATE TABLE parallel_life.publication_media_assets (
 id uuid PRIMARY KEY,
 work_id uuid NOT NULL REFERENCES parallel_life.publication_works(id),
 created_by uuid NOT NULL REFERENCES parallel_life.publisher_principals(id),
 storage_key text NOT NULL UNIQUE CHECK(storage_key ~ '^works/[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|png|webp|mp4)$'),
 kind text NOT NULL CHECK(kind IN ('image','video')),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','video/mp4')),
 declared_bytes bigint NOT NULL CHECK(declared_bytes BETWEEN 1 AND 50000000),
 byte_length bigint CHECK(byte_length BETWEEN 1 AND 50000000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')),
 created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz,
 CHECK((kind='video')=(mime_type='video/mp4')),
 CHECK((status='pending' AND byte_length IS NULL AND confirmed_at IS NULL)
    OR (status='ready' AND byte_length=declared_bytes AND confirmed_at IS NOT NULL))
);
CREATE INDEX publication_media_work_status ON parallel_life.publication_media_assets(work_id,status,created_at);
CREATE FUNCTION parallel_life.publication_media_update() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF OLD.status<>'pending' OR NEW.id IS DISTINCT FROM OLD.id
  OR NEW.work_id IS DISTINCT FROM OLD.work_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
  OR NEW.storage_key IS DISTINCT FROM OLD.storage_key OR NEW.kind IS DISTINCT FROM OLD.kind
  OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.declared_bytes IS DISTINCT FROM OLD.declared_bytes
  OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.status<>'ready'
  OR NEW.byte_length IS DISTINCT FROM OLD.declared_bytes OR NEW.confirmed_at IS NULL THEN
  RAISE EXCEPTION 'IMMUTABLE_PUBLICATION_MEDIA' USING ERRCODE='23514';
 END IF;
 PERFORM parallel_life.publisher_lock_permission('edit');
 RETURN NEW;
END $$;
CREATE TRIGGER publication_media_update BEFORE UPDATE ON parallel_life.publication_media_assets
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_media_update();
ALTER TABLE parallel_life.publication_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.publication_media_assets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.publication_media_assets FROM PUBLIC,pl_app,pl_worker,pl_publisher;
CREATE POLICY publication_media_read ON parallel_life.publication_media_assets FOR SELECT TO pl_publisher
 USING(parallel_life.publisher_has_permission('view'));
CREATE POLICY publication_media_insert ON parallel_life.publication_media_assets FOR INSERT TO pl_publisher
 WITH CHECK(parallel_life.publisher_has_permission('edit') AND created_by::text=current_setting('publisher.principal_id',true));
CREATE POLICY publication_media_finish ON parallel_life.publication_media_assets FOR UPDATE TO pl_publisher
 USING(parallel_life.publisher_has_permission('edit')) WITH CHECK(parallel_life.publisher_has_permission('edit'));
GRANT SELECT,INSERT ON parallel_life.publication_media_assets TO pl_publisher;
GRANT UPDATE(status,byte_length,confirmed_at) ON parallel_life.publication_media_assets TO pl_publisher;

CREATE FUNCTION parallel_life.publication_media_assert_content(w uuid,c jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE msg jsonb; att jsonb; asset_id uuid;
BEGIN
 FOR msg IN SELECT value FROM jsonb_array_elements(COALESCE(c->'phone'->'messages','[]'::jsonb)) LOOP
  att:=msg->'attachment';
  IF att IS NULL OR jsonb_typeof(att)='null' THEN CONTINUE; END IF;
  IF jsonb_typeof(att)<>'object' OR att->>'assetId' IS NULL
   OR att->>'assetId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR att->>'kind' IS NULL OR att->>'kind' NOT IN ('image','video') THEN
   RAISE EXCEPTION 'PUBLICATION_MEDIA_INVALID' USING ERRCODE='23514';
  END IF;
  asset_id:=(att->>'assetId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM parallel_life.publication_media_assets m
     WHERE m.id=asset_id AND m.work_id=w AND m.kind=att->>'kind' AND m.status='ready') THEN
   RAISE EXCEPTION 'PUBLICATION_MEDIA_NOT_READY' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION parallel_life.publication_media_version_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM parallel_life.publication_media_assert_content(NEW.work_id,NEW.content);
 RETURN NEW;
END $$;
CREATE TRIGGER publication_media_version_guard BEFORE INSERT ON parallel_life.publication_versions
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_media_version_guard();
CREATE FUNCTION parallel_life.publication_media_binding_guard() RETURNS trigger
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
 IF c IS NULL THEN RAISE EXCEPTION 'PUBLICATION_MEDIA_SOURCE_MISSING' USING ERRCODE='23514'; END IF;
 PERFORM parallel_life.publication_media_assert_content(NEW.work_id,c);
 RETURN NEW;
END $$;
CREATE TRIGGER publication_media_binding_guard BEFORE INSERT ON parallel_life.publication_world_bindings
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_media_binding_guard();

-- This is the sole player-facing bridge. A player must own the precise world,
-- and the exact immutable publication (or the staff trial's pinned draft) must
-- name the ready asset in an authored chat attachment. The function never
-- exposes an asset merely because it belongs to a listed work.
CREATE FUNCTION parallel_life.publication_media_for_world(w text,a uuid)
 RETURNS TABLE(storage_key text,mime_type text,byte_length bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; c jsonb;
BEGIN
 SELECT binding.* INTO b FROM parallel_life.publication_world_bindings binding
 JOIN parallel_life.worlds owned ON owned.id=binding.world_id AND owned.owner_id=binding.owner_id
 WHERE binding.world_id=w AND binding.owner_id=current_setting('app.user_id',true);
 IF NOT FOUND THEN RETURN; END IF;
 IF b.kind='trial' THEN
  SELECT d.content INTO c FROM parallel_life.publication_draft_revisions d
  WHERE d.work_id=b.work_id AND d.version=b.draft_version AND d.content_hash=b.content_hash;
 ELSE
  SELECT v.content INTO c FROM parallel_life.publication_versions v
  WHERE v.work_id=b.work_id AND v.version=b.publication_version
   AND v.draft_version=b.draft_version AND v.content_hash=b.content_hash;
 END IF;
 IF c IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT m.storage_key,m.mime_type,m.byte_length
 FROM parallel_life.publication_media_assets m
 WHERE m.id=a AND m.work_id=b.work_id AND m.status='ready'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(c->'phone'->'messages','[]'::jsonb)) msg
    WHERE msg->'attachment'->>'assetId'=m.id::text
      AND msg->'attachment'->>'kind'=m.kind);
END $$;
REVOKE ALL ON FUNCTION parallel_life.publication_media_for_world(text,uuid),
 parallel_life.publication_media_update(),
 parallel_life.publication_media_assert_content(uuid,jsonb),
 parallel_life.publication_media_version_guard(),
 parallel_life.publication_media_binding_guard() FROM PUBLIC,pl_publisher,pl_worker,pl_app;
GRANT EXECUTE ON FUNCTION parallel_life.publication_media_update() TO pl_publisher;
GRANT EXECUTE ON FUNCTION parallel_life.publication_media_for_world(text,uuid) TO pl_app;
