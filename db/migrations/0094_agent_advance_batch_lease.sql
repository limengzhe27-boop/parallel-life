-- A short runtime scheduling lease, not a story/goal store. Never held as a DB transaction over AI.
CREATE TABLE parallel_life.agent_advance_batch_leases (
 world_id text PRIMARY KEY, owner_id text NOT NULL, engine_epoch integer NOT NULL CHECK(engine_epoch>=2),
 token uuid NOT NULL, lease_until timestamptz NOT NULL,
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.agent_advance_batch_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_advance_batch_leases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_advance_batch_leases FROM PUBLIC,pl_worker,pl_publisher,pl_publisher_login;
GRANT SELECT,INSERT,UPDATE,DELETE ON parallel_life.agent_advance_batch_leases TO pl_app;
CREATE POLICY agent_advance_batch_owner ON parallel_life.agent_advance_batch_leases TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
