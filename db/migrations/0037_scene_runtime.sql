-- Text scenes are separate projections of actual world events. Navigation is not departure.
CREATE TABLE parallel_life.scene_sessions (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, source_event_id text NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 UNIQUE(world_id,id,owner_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id)
);
CREATE TABLE parallel_life.scene_items (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, scene_id text NOT NULL,
 source_event_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('action','entry','matter')),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'), ordinal bigint GENERATED ALWAYS AS IDENTITY,
 FOREIGN KEY(world_id,scene_id,owner_id) REFERENCES parallel_life.scene_sessions(world_id,id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id)
);
CREATE INDEX scene_items_read ON parallel_life.scene_items(world_id,scene_id,kind,ordinal);
CREATE TABLE parallel_life.player_experiences (
 world_id text PRIMARY KEY, owner_id text NOT NULL, current_scene_id text, document jsonb NOT NULL,
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,current_scene_id,owner_id) REFERENCES parallel_life.scene_sessions(world_id,id,owner_id)
);
CREATE TABLE parallel_life.scene_receipts (
 world_id text NOT NULL, owner_id text NOT NULL, command_id text NOT NULL, document jsonb NOT NULL,
 PRIMARY KEY(world_id,command_id),
 FOREIGN KEY(world_id,command_id,owner_id) REFERENCES parallel_life.commands(world_id,id,owner_id) ON DELETE CASCADE
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['scene_sessions','scene_items','player_experiences','scene_receipts'] LOOP
 EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY owner_access ON parallel_life.%I TO pl_app USING(owner_id=current_setting(''app.user_id'',true)) WITH CHECK(owner_id=current_setting(''app.user_id'',true))',t);
 EXECUTE format('CREATE POLICY leased_worker ON parallel_life.%I TO pl_worker USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id))',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON parallel_life.%I TO pl_app,pl_worker',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE parallel_life.scene_items_ordinal_seq TO pl_app,pl_worker;
