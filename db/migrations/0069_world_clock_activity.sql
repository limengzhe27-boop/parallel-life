ALTER TABLE parallel_life.world_clock ALTER COLUMN speed SET DEFAULT 12;
-- Persist browser presence without a running client clock or an offline catch-up.
ALTER TABLE parallel_life.world_clock
 ADD COLUMN managed boolean NOT NULL DEFAULT false,
 ADD COLUMN active_until timestamptz;
CREATE TABLE parallel_life.world_clock_activity (
 world_id text NOT NULL, owner_id text NOT NULL, client_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence BETWEEN 0 AND 9007199254740991),
 mode text NOT NULL CHECK(mode IN ('browsing','conversation','away')),
 expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,client_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id)
);
ALTER TABLE parallel_life.world_clock_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_clock_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY clock_activity_owner ON parallel_life.world_clock_activity TO pl_app
 USING(owner_id=current_setting('app.user_id',true))
 WITH CHECK(owner_id=current_setting('app.user_id',true));
REVOKE ALL ON parallel_life.world_clock_activity FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_clock_activity TO pl_app;
