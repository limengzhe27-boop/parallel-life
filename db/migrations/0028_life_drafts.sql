ALTER TABLE parallel_life.approved_seeds ADD CONSTRAINT seed_id_owner_unique UNIQUE(id,owner_id);
CREATE TABLE parallel_life.life_drafts (
 id uuid PRIMARY KEY,
 owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 profile_id uuid NOT NULL,
 direction_id uuid NOT NULL,
 discovery_version integer NOT NULL CHECK(discovery_version>=0),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 status text NOT NULL CHECK(status IN ('draft','confirmed')),
 seed_id uuid,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<65536),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(profile_id,owner_id) REFERENCES parallel_life.profiles(id,owner_id),
 FOREIGN KEY(seed_id,owner_id) REFERENCES parallel_life.approved_seeds(id,owner_id),
 UNIQUE(owner_id,direction_id,discovery_version), UNIQUE(id,owner_id),
 CHECK((status='confirmed')=(seed_id IS NOT NULL)),
 CHECK(document->>'id'=id::text AND (document->>'version')::int=version AND document->>'status'=status),
 CHECK(COALESCE(document->>'seedId','')=COALESCE(seed_id::text,''))
);
CREATE TABLE parallel_life.draft_receipts (
 owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 command_id uuid NOT NULL, request_hash text NOT NULL,
 draft_id uuid NOT NULL, response jsonb NOT NULL CHECK(octet_length(response::text)<65536),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,command_id),
 FOREIGN KEY(draft_id,owner_id) REFERENCES parallel_life.life_drafts(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX life_draft_recent ON parallel_life.life_drafts(owner_id,updated_at DESC,id);
ALTER TABLE parallel_life.life_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.life_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.draft_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.draft_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.life_drafts TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE POLICY owner_access ON parallel_life.draft_receipts TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE FUNCTION parallel_life.guard_confirmed_draft() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.status='confirmed' THEN RAISE EXCEPTION 'CONFIRMED_DRAFT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER confirmed_draft_immutable BEFORE UPDATE ON parallel_life.life_drafts FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_confirmed_draft();
REVOKE ALL ON parallel_life.life_drafts,parallel_life.draft_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION parallel_life.guard_confirmed_draft() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.guard_confirmed_draft() TO pl_app,pl_worker;
GRANT SELECT,INSERT,UPDATE ON parallel_life.life_drafts TO pl_app;
GRANT SELECT,INSERT ON parallel_life.draft_receipts TO pl_app;
