-- Authoring has its own private scope. No public policy or publication state.
CREATE TABLE parallel_life.setting_drafts (
 id uuid PRIMARY KEY,
 owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 99),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,owner_id)
);
CREATE TABLE parallel_life.setting_draft_revisions (
 draft_id uuid NOT NULL,
 owner_id text NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 0 AND 99),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<32768),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(draft_id,owner_id,version),
 FOREIGN KEY(draft_id,owner_id) REFERENCES parallel_life.setting_drafts(id,owner_id) ON DELETE CASCADE,
 CHECK((content->>'schemaVersion'='1') IS TRUE)
);
ALTER TABLE parallel_life.setting_drafts ADD CONSTRAINT setting_current_revision
 FOREIGN KEY(id,owner_id,version) REFERENCES parallel_life.setting_draft_revisions(draft_id,owner_id,version)
 DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE parallel_life.setting_draft_receipts (
 owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 command_id uuid NOT NULL,
 request_hash text NOT NULL,
 draft_id uuid NOT NULL,
 version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,command_id),
 FOREIGN KEY(draft_id,owner_id,version) REFERENCES parallel_life.setting_draft_revisions(draft_id,owner_id,version) ON DELETE CASCADE
);
CREATE INDEX setting_drafts_recent ON parallel_life.setting_drafts(owner_id,updated_at DESC,id);
ALTER TABLE parallel_life.setting_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.setting_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.setting_draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.setting_draft_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.setting_draft_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.setting_draft_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.setting_drafts TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE POLICY owner_access ON parallel_life.setting_draft_revisions TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE POLICY owner_access ON parallel_life.setting_draft_receipts TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE FUNCTION parallel_life.guard_setting_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 RAISE EXCEPTION 'SETTING_REVISION_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER setting_revision_immutable BEFORE UPDATE ON parallel_life.setting_draft_revisions
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_setting_revision();
CREATE FUNCTION parallel_life.guard_setting_draft_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
  OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'SETTING_DRAFT_VERSION_CONFLICT' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER setting_draft_monotonic BEFORE UPDATE ON parallel_life.setting_drafts
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_setting_draft_update();
REVOKE ALL ON parallel_life.setting_drafts,parallel_life.setting_draft_revisions,parallel_life.setting_draft_receipts FROM PUBLIC,pl_app,pl_worker;
REVOKE ALL ON FUNCTION parallel_life.guard_setting_revision(),parallel_life.guard_setting_draft_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.guard_setting_revision(),parallel_life.guard_setting_draft_update() TO pl_app;
GRANT SELECT,INSERT ON parallel_life.setting_drafts,parallel_life.setting_draft_revisions,parallel_life.setting_draft_receipts TO pl_app;
GRANT UPDATE(version,updated_at) ON parallel_life.setting_drafts TO pl_app;
