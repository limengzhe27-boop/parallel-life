ALTER TABLE parallel_life.approved_seeds ADD CONSTRAINT seed_owner_unique UNIQUE(id,owner_id);
CREATE TABLE parallel_life.world_builds (
 seed_id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 world_id text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 opening jsonb CHECK(opening IS NULL OR (jsonb_typeof(opening)='object' AND octet_length(opening::text)<32768)),
 FOREIGN KEY(seed_id,owner_id) REFERENCES parallel_life.approved_seeds(id,owner_id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.world_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_builds FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_builds TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE POLICY leased_worker ON parallel_life.world_builds TO pl_worker
 USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id));
GRANT SELECT,INSERT,DELETE ON parallel_life.world_builds TO pl_app;
GRANT SELECT,UPDATE ON parallel_life.world_builds TO pl_worker;
REVOKE ALL ON parallel_life.world_builds FROM PUBLIC;
