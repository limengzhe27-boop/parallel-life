CREATE TABLE parallel_life.approved_seeds (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 profile_id uuid NOT NULL, command_id uuid NOT NULL, request_hash text NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<65536),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(profile_id,owner_id) REFERENCES parallel_life.profiles(id,owner_id),
 UNIQUE(owner_id,command_id)
);
CREATE INDEX approved_seed_owner ON parallel_life.approved_seeds(owner_id,created_at DESC);
ALTER TABLE parallel_life.approved_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.approved_seeds FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.approved_seeds TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE POLICY leased_worker ON parallel_life.approved_seeds TO pl_worker
 USING(parallel_life.worker_owns(owner_id));
CREATE TRIGGER approved_seed_immutable BEFORE UPDATE ON parallel_life.approved_seeds FOR EACH ROW EXECUTE FUNCTION parallel_life.immutable_snapshot();
GRANT SELECT,INSERT,DELETE ON parallel_life.approved_seeds TO pl_app;
GRANT SELECT ON parallel_life.approved_seeds TO pl_worker;
REVOKE ALL ON parallel_life.approved_seeds FROM PUBLIC;
