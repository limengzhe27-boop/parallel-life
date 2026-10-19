-- Request recovery metadata only; all narrative effects stay in the existing Agent kernel.
CREATE TABLE parallel_life.agent_advance_operations (
 world_id text NOT NULL, owner_id text NOT NULL, id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '270 seconds',
 finished_at timestamptz, succeeded boolean NOT NULL DEFAULT false,
 failure_code text CHECK(failure_code IN ('VERSION_CONFLICT','INVALID_OUTPUT','UNAVAILABLE','PENDING','UNCLASSIFIED')),
 result jsonb,
 PRIMARY KEY(world_id,id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE parallel_life.agent_advance_operation_work (
 world_id text NOT NULL, owner_id text NOT NULL, operation_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('npc','director')), command_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(world_id,operation_id,kind,command_id),
 FOREIGN KEY(world_id,operation_id) REFERENCES parallel_life.agent_advance_operations(world_id,id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.agent_advance_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_advance_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_advance_operation_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_advance_operation_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_advance_operations, parallel_life.agent_advance_operation_work FROM PUBLIC,pl_worker,pl_publisher,pl_publisher_login;
GRANT SELECT,INSERT,UPDATE ON parallel_life.agent_advance_operations TO pl_app;
GRANT SELECT,INSERT ON parallel_life.agent_advance_operation_work TO pl_app;
CREATE POLICY advance_operation_owner ON parallel_life.agent_advance_operations TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE POLICY advance_operation_work_owner ON parallel_life.agent_advance_operation_work TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
