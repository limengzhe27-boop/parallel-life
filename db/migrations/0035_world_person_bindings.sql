-- Original reference photos remain private assets; each new world's mapping is immutable.
CREATE TABLE parallel_life.world_person_bindings (
 world_id text NOT NULL, owner_id text NOT NULL, person_id uuid NOT NULL, actor_id uuid NOT NULL,
 person_snapshot jsonb NOT NULL CHECK(jsonb_typeof(person_snapshot)='object'),
 asset_id uuid, asset_revision integer CHECK(asset_revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,person_id), UNIQUE(world_id,actor_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(asset_id,owner_id) REFERENCES parallel_life.assets(id,owner_id),
 CHECK((asset_id IS NULL)=(asset_revision IS NULL)),
 CHECK((person_snapshot->>'id'=person_id::text) IS TRUE)
);
ALTER TABLE parallel_life.world_person_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_person_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_person_bindings TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE POLICY leased_worker ON parallel_life.world_person_bindings TO pl_worker
 USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id));
REVOKE ALL ON parallel_life.world_person_bindings FROM PUBLIC,pl_app,pl_worker;
GRANT SELECT ON parallel_life.world_person_bindings TO pl_app;
GRANT SELECT,INSERT ON parallel_life.world_person_bindings TO pl_worker;
CREATE TRIGGER person_binding_immutable BEFORE UPDATE ON parallel_life.world_person_bindings
 FOR EACH ROW EXECUTE FUNCTION parallel_life.immutable_snapshot();
CREATE INDEX person_bindings_asset ON parallel_life.world_person_bindings(asset_id) WHERE asset_id IS NOT NULL;
