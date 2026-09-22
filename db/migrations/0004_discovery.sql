CREATE TABLE parallel_life.discoveries (
 profile_id uuid PRIMARY KEY, owner_id text UNIQUE NOT NULL,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 profile_version integer NOT NULL CHECK(profile_version>=0),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<65536),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(profile_id,owner_id) REFERENCES parallel_life.profiles(id,owner_id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.discoveries FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.discoveries TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE POLICY leased_worker ON parallel_life.discoveries TO pl_worker
 USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON parallel_life.discoveries TO pl_app;
GRANT SELECT,UPDATE ON parallel_life.discoveries TO pl_worker;
REVOKE ALL ON parallel_life.discoveries FROM PUBLIC;
