-- Deterministic travel receipts reference the same atomic world command/event.
CREATE TABLE parallel_life.world_space_receipts (
 world_id text NOT NULL, owner_id text NOT NULL, command_id text NOT NULL,
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 source_event_id text NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<8192),
 PRIMARY KEY(world_id,command_id),
 FOREIGN KEY(world_id,command_id,owner_id) REFERENCES parallel_life.commands(world_id,id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id)
);
ALTER TABLE parallel_life.world_space_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_space_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_space_receipts TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
REVOKE ALL ON parallel_life.world_space_receipts FROM PUBLIC,pl_app,pl_worker;
GRANT SELECT,INSERT,DELETE ON parallel_life.world_space_receipts TO pl_app;
CREATE TRIGGER immutable_space_receipt BEFORE UPDATE ON parallel_life.world_space_receipts FOR EACH ROW EXECUTE FUNCTION parallel_life.immutable_snapshot();
