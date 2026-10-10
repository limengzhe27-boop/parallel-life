-- Official experiences carry no real profile snapshot. Existing personal seeds retain their FK.
ALTER TABLE parallel_life.approved_seeds ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE parallel_life.approved_seeds ADD CONSTRAINT seed_profile_source CHECK (
  profile_id IS NOT NULL OR COALESCE(document->'source'->>'kind' = 'official_life',false)
);
CREATE TABLE parallel_life.official_life_instances (
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
  preset_id text NOT NULL CHECK(preset_id IN ('county-yellow-hair','only-child','returned-daughter','retired-star')),
  content_version integer NOT NULL CHECK(content_version>0),
  seed_id uuid NOT NULL,
  world_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,preset_id,content_version),
  UNIQUE(world_id,owner_id),
  FOREIGN KEY(seed_id,owner_id) REFERENCES parallel_life.approved_seeds(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE parallel_life.official_life_start_receipts (
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(length(request_hash)=64),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<2048),
  world_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,command_id),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.official_life_instances(world_id,owner_id) ON DELETE CASCADE
);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['official_life_instances','official_life_start_receipts'] LOOP
    EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY owner_access ON parallel_life.%I TO pl_app USING(owner_id=current_setting(''app.user_id'',true)) WITH CHECK(owner_id=current_setting(''app.user_id'',true))',t);
    EXECUTE format('REVOKE ALL ON parallel_life.%I FROM PUBLIC,pl_app,pl_worker',t);
    EXECUTE format('GRANT SELECT,INSERT,DELETE ON parallel_life.%I TO pl_app',t);
    EXECUTE format('CREATE TRIGGER immutable_official BEFORE UPDATE ON parallel_life.%I FOR EACH ROW EXECUTE FUNCTION parallel_life.immutable_snapshot()',t);
  END LOOP;
END $$;
