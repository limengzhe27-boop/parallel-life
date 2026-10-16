-- Per-player live opening work; authored historical messages are never receipts.
CREATE TABLE parallel_life.publication_opening_batches (
 world_id text PRIMARY KEY, owner_id text NOT NULL, source_hash text NOT NULL,
 node_key text NOT NULL, status text NOT NULL CHECK(status IN ('planning','ready','unknown','complete')),
 plan_command_id uuid NOT NULL, expected_version integer NOT NULL CHECK(expected_version>=0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(world_id,owner_id), FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id),
 CHECK(source_hash ~ '^[0-9a-f]{64}$'), CHECK(node_key ~ '^[a-z][a-z0-9_]{0,31}$')
);
CREATE TABLE parallel_life.publication_opening_deliveries (
 world_id text NOT NULL, owner_id text NOT NULL, actor_id text NOT NULL,
 brief text NOT NULL CHECK(length(trim(brief)) BETWEEN 1 AND 2400), ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 23),
 command_id uuid NOT NULL UNIQUE, expected_version integer CHECK(expected_version>=0),
 command_history jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(command_history)='array' AND jsonb_array_length(command_history)<=16),
 status text NOT NULL CHECK(status IN ('queued','sending','unknown','delivered')),
 source_event_id text, source_message_id text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,actor_id), UNIQUE(world_id,ordinal),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.publication_opening_batches(world_id,owner_id),
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id),
 CHECK((status='delivered' AND source_event_id IS NOT NULL AND source_message_id IS NOT NULL) OR status<>'delivered')
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['publication_opening_batches','publication_opening_deliveries'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY opening_owner ON parallel_life.%I TO pl_app USING(owner_id=current_setting(''app.user_id'',true)) WITH CHECK(owner_id=current_setting(''app.user_id'',true))',t);
  EXECUTE format('REVOKE ALL ON parallel_life.%I FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON parallel_life.%I TO pl_app',t);
 END LOOP;
END $$;
