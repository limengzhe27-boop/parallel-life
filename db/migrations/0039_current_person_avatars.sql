-- Current contact presentation is separate from immutable seed, album and chat sources.
CREATE TABLE parallel_life.world_person_avatars (
 world_id text NOT NULL, owner_id text NOT NULL, person_id uuid NOT NULL, actor_id uuid NOT NULL,
 asset_id uuid, asset_revision integer, version integer NOT NULL CHECK(version>0),
 profile_version bigint NOT NULL CHECK(profile_version>=0), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,actor_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,person_id) REFERENCES parallel_life.world_person_bindings(world_id,person_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,actor_id) REFERENCES parallel_life.world_person_bindings(world_id,actor_id) ON DELETE CASCADE,
 FOREIGN KEY(asset_id,owner_id) REFERENCES parallel_life.assets(id,owner_id),
 CHECK((asset_id IS NULL)=(asset_revision IS NULL)), CHECK(asset_revision>0)
);
CREATE TABLE parallel_life.world_person_avatar_updates (
 world_id text NOT NULL, owner_id text NOT NULL, person_id uuid NOT NULL, actor_id uuid NOT NULL,
 avatar_version integer NOT NULL CHECK(avatar_version>0), profile_version bigint NOT NULL,
 previous_asset_id uuid, asset_id uuid, asset_revision integer, command_id uuid,
 reason text NOT NULL CHECK(reason IN ('profile','binding','backfill')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(world_id,actor_id,avatar_version),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 CHECK((asset_id IS NULL)=(asset_revision IS NULL))
);
ALTER TABLE parallel_life.world_person_avatars ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_person_avatars FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_person_avatar_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_person_avatar_updates FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON parallel_life.world_person_avatars TO pl_app USING(owner_id=current_setting('app.user_id',true));
CREATE POLICY owner_read ON parallel_life.world_person_avatar_updates TO pl_app USING(owner_id=current_setting('app.user_id',true));
CREATE POLICY leased_read ON parallel_life.world_person_avatars TO pl_worker USING(parallel_life.worker_owns(owner_id));
CREATE POLICY leased_read ON parallel_life.world_person_avatar_updates TO pl_worker USING(parallel_life.worker_owns(owner_id));
REVOKE ALL ON parallel_life.world_person_avatars,parallel_life.world_person_avatar_updates FROM PUBLIC,pl_app,pl_worker;
GRANT SELECT ON parallel_life.world_person_avatars,parallel_life.world_person_avatar_updates TO pl_app,pl_worker;
CREATE INDEX current_avatar_asset ON parallel_life.world_person_avatars(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX current_avatar_person ON parallel_life.world_person_avatars(owner_id,person_id);

-- Only triggers invoke the private helper. Neither app nor worker can grant an arbitrary image.
CREATE FUNCTION parallel_life.sync_current_person_avatar(
 p_owner text,p_world text,p_person uuid,p_actor uuid,p_asset uuid,p_profile_version bigint,p_command uuid,p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,parallel_life AS $$
DECLARE revision integer; prior uuid; saved_version integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM parallel_life.world_person_bindings WHERE world_id=p_world AND owner_id=p_owner AND person_id=p_person AND actor_id=p_actor)
 THEN RAISE EXCEPTION 'avatar binding missing' USING ERRCODE='23514'; END IF;
 IF p_asset IS NOT NULL THEN
  SELECT a.revision INTO revision FROM parallel_life.assets a
   WHERE a.id=p_asset AND a.owner_id=p_owner AND a.status='ready' AND a.origin='upload' AND a.world_id IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'avatar source unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT asset_id INTO prior FROM parallel_life.world_person_avatars WHERE world_id=p_world AND actor_id=p_actor FOR UPDATE;
 INSERT INTO parallel_life.world_person_avatars(world_id,owner_id,person_id,actor_id,asset_id,asset_revision,version,profile_version)
 VALUES(p_world,p_owner,p_person,p_actor,p_asset,revision,1,p_profile_version)
 ON CONFLICT(world_id,actor_id) DO UPDATE
 SET asset_id=EXCLUDED.asset_id,asset_revision=EXCLUDED.asset_revision,version=world_person_avatars.version+1,
     profile_version=EXCLUDED.profile_version,updated_at=clock_timestamp()
 WHERE world_person_avatars.profile_version<=EXCLUDED.profile_version
   AND (world_person_avatars.asset_id IS DISTINCT FROM EXCLUDED.asset_id OR world_person_avatars.asset_revision IS DISTINCT FROM EXCLUDED.asset_revision)
 RETURNING version INTO saved_version;
 IF saved_version IS NOT NULL THEN
  INSERT INTO parallel_life.world_person_avatar_updates(world_id,owner_id,person_id,actor_id,avatar_version,profile_version,previous_asset_id,asset_id,asset_revision,command_id,reason)
  VALUES(p_world,p_owner,p_person,p_actor,saved_version,p_profile_version,prior,p_asset,revision,p_command,p_reason);
 END IF;
END $$;
REVOKE ALL ON FUNCTION parallel_life.sync_current_person_avatar(text,text,uuid,uuid,uuid,bigint,uuid,text) FROM PUBLIC,pl_app,pl_worker;

CREATE FUNCTION parallel_life.profile_current_avatar_sync() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,parallel_life AS $$
DECLARE person jsonb; previous jsonb; binding record; command uuid;
BEGIN
 command:=NULLIF(current_setting('app.person_avatar_command_id',true),'')::uuid;
 FOR person IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.document->'people','[]'::jsonb)) LOOP
  SELECT value INTO previous FROM jsonb_array_elements(COALESCE(OLD.document->'people','[]'::jsonb)) WHERE value->>'id'=person->>'id';
  IF previous IS NULL OR previous->>'assetId' IS DISTINCT FROM person->>'assetId' THEN
   FOR binding IN SELECT * FROM parallel_life.world_person_bindings WHERE owner_id=NEW.owner_id AND person_id=(person->>'id')::uuid LOOP
    PERFORM parallel_life.sync_current_person_avatar(NEW.owner_id,binding.world_id,binding.person_id,binding.actor_id,NULLIF(person->>'assetId','')::uuid,NEW.version,command,'profile');
   END LOOP;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION parallel_life.profile_current_avatar_sync() FROM PUBLIC,pl_app,pl_worker;
CREATE TRIGGER profile_current_avatar_sync AFTER UPDATE OF document ON parallel_life.profiles
 FOR EACH ROW WHEN(OLD.document->'people' IS DISTINCT FROM NEW.document->'people')
 EXECUTE FUNCTION parallel_life.profile_current_avatar_sync();

CREATE FUNCTION parallel_life.binding_current_avatar_sync() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,parallel_life AS $$
DECLARE profile record; person jsonb; current_asset uuid;
BEGIN
 -- Serializes late world creation with a concurrent profile edit, without changing the seed.
 SELECT document,version INTO profile FROM parallel_life.profiles WHERE owner_id=NEW.owner_id FOR SHARE;
 SELECT value INTO person FROM jsonb_array_elements(COALESCE(profile.document->'people','[]'::jsonb)) WHERE value->>'id'=NEW.person_id::text;
 current_asset:=CASE WHEN person IS NOT NULL THEN NULLIF(person->>'assetId','')::uuid ELSE NEW.asset_id END;
 PERFORM parallel_life.sync_current_person_avatar(NEW.owner_id,NEW.world_id,NEW.person_id,NEW.actor_id,current_asset,profile.version,NULL,'binding');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION parallel_life.binding_current_avatar_sync() FROM PUBLIC,pl_app,pl_worker;
CREATE TRIGGER binding_current_avatar_sync AFTER INSERT ON parallel_life.world_person_bindings
 FOR EACH ROW EXECUTE FUNCTION parallel_life.binding_current_avatar_sync();

-- Existing authorized contacts adopt the current source person's display photo; historical rows stay frozen.
DO $$
DECLARE binding record; profile record; person jsonb; current_asset uuid;
BEGIN
 FOR binding IN SELECT * FROM parallel_life.world_person_bindings ORDER BY owner_id,world_id,person_id LOOP
  SELECT document,version INTO profile FROM parallel_life.profiles WHERE owner_id=binding.owner_id FOR SHARE;
  SELECT value INTO person FROM jsonb_array_elements(COALESCE(profile.document->'people','[]'::jsonb)) WHERE value->>'id'=binding.person_id::text;
  current_asset:=CASE WHEN person IS NOT NULL THEN NULLIF(person->>'assetId','')::uuid ELSE binding.asset_id END;
  PERFORM parallel_life.sync_current_person_avatar(binding.owner_id,binding.world_id,binding.person_id,binding.actor_id,current_asset,profile.version,NULL,'backfill');
 END LOOP;
END $$;

CREATE FUNCTION parallel_life.protect_current_avatar_asset() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,parallel_life AS $$
BEGIN
 IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.revision IS DISTINCT FROM OLD.revision)
 AND EXISTS(SELECT 1 FROM parallel_life.world_person_avatars WHERE asset_id=OLD.id)
 THEN RAISE EXCEPTION 'current avatar source in use' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION parallel_life.protect_current_avatar_asset() FROM PUBLIC,pl_app,pl_worker;
CREATE TRIGGER protect_current_avatar_asset BEFORE UPDATE OF status,revision ON parallel_life.assets
 FOR EACH ROW EXECUTE FUNCTION parallel_life.protect_current_avatar_asset();
CREATE TRIGGER avatar_update_immutable BEFORE UPDATE ON parallel_life.world_person_avatar_updates
 FOR EACH ROW EXECUTE FUNCTION parallel_life.immutable_snapshot();
