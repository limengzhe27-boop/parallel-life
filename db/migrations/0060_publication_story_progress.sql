-- A presented authored event may continue across real player, NPC, and scene actions.
-- This sidecar is private to one player's immutable publication plan. It does not
-- turn an author's intended outcome into a world fact or player completion.
CREATE TABLE parallel_life.publication_story_progress (
 world_id text NOT NULL,
 owner_id text NOT NULL,
 node_key text NOT NULL,
 definition_hash text NOT NULL CHECK(definition_hash ~ '^[0-9a-f]{64}$'),
 revision integer NOT NULL CHECK(revision>=0),
 world_version integer NOT NULL CHECK(world_version>=0),
 state jsonb NOT NULL CHECK(
   jsonb_typeof(state)='object'
   AND state->>'schemaVersion'='1'
   AND state->>'nodeKey'=node_key
   AND octet_length(state::text)<32768
 ),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,node_key),
 UNIQUE(world_id,owner_id,node_key),
 FOREIGN KEY(world_id,owner_id,node_key)
   REFERENCES parallel_life.publication_story_nodes(world_id,owner_id,node_key)
);

-- One committed source record can advance a node once. Several distinct records
-- in a single committed world event may legitimately have different effects.
CREATE TABLE parallel_life.publication_story_progress_evidence (
 world_id text NOT NULL,
 owner_id text NOT NULL,
 node_key text NOT NULL,
 source_event_id text NOT NULL,
 source_record_id text NOT NULL CHECK(length(source_record_id) BETWEEN 1 AND 256),
 command_id text NOT NULL,
 world_version integer NOT NULL CHECK(world_version>0),
 signal_kind text NOT NULL CHECK(signal_kind IN (
   'introduced','engaged','declined','reopened','unrelated','npc_progress','nudge','closure'
 )),
 criterion_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(
   jsonb_typeof(criterion_ids)='array'
   AND jsonb_array_length(criterion_ids)<=16
   AND octet_length(criterion_ids::text)<2048
 ),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,node_key,source_event_id,source_record_id),
 FOREIGN KEY(world_id,owner_id,node_key)
   REFERENCES parallel_life.publication_story_progress(world_id,owner_id,node_key),
 FOREIGN KEY(world_id,source_event_id,owner_id)
   REFERENCES parallel_life.world_events(world_id,id,owner_id)
);
CREATE INDEX publication_story_progress_evidence_recent
 ON parallel_life.publication_story_progress_evidence(world_id,node_key,world_version DESC);

-- An evidence row must point to the exact event that a successful command
-- committed. A queued, failed or unknown command can never supply progress.
CREATE FUNCTION parallel_life.publication_story_progress_evidence_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE actual_version integer;
BEGIN
 SELECT e.version INTO actual_version
 FROM parallel_life.world_events e
 JOIN parallel_life.commands c
   ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
 WHERE e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id
   AND e.id=NEW.source_event_id AND e.command_id=NEW.command_id
   AND c.status='succeeded' AND c.result_event_id=e.id;
 IF actual_version IS NULL OR actual_version<>NEW.world_version THEN
   RAISE EXCEPTION 'uncommitted story progress source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER publication_story_progress_evidence_source
 BEFORE INSERT ON parallel_life.publication_story_progress_evidence
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_story_progress_evidence_guard();
CREATE TRIGGER publication_story_progress_evidence_immutable
 BEFORE UPDATE OR DELETE ON parallel_life.publication_story_progress_evidence
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_story_immutable();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['publication_story_progress','publication_story_progress_evidence'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format(
   'CREATE POLICY owner_story_progress ON parallel_life.%I TO pl_app USING(owner_id=current_setting(''app.user_id'',true)) WITH CHECK(owner_id=current_setting(''app.user_id'',true))',t
  );
  EXECUTE format('REVOKE ALL ON parallel_life.%I FROM PUBLIC,pl_app,pl_publisher,pl_worker',t);
  EXECUTE format('GRANT SELECT ON parallel_life.%I TO pl_app',t);
 END LOOP;
END $$;
GRANT INSERT,UPDATE ON parallel_life.publication_story_progress TO pl_app;
GRANT INSERT ON parallel_life.publication_story_progress_evidence TO pl_app;
REVOKE ALL ON FUNCTION parallel_life.publication_story_progress_evidence_guard()
 FROM PUBLIC,pl_app,pl_publisher,pl_worker;
