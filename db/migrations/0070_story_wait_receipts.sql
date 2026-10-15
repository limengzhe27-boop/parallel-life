-- Explicit, zero-model waits have immutable owner-scoped receipts.
CREATE TABLE parallel_life.story_wait_receipts (
 world_id text NOT NULL, owner_id text NOT NULL, command_id text NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 source_event_id text NOT NULL, version integer NOT NULL CHECK(version>0),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<4096),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,command_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id),
 FOREIGN KEY(world_id,command_id,owner_id) REFERENCES parallel_life.commands(world_id,id,owner_id),
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id)
);
ALTER TABLE parallel_life.story_wait_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.story_wait_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY story_wait_owner ON parallel_life.story_wait_receipts TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
REVOKE ALL ON parallel_life.story_wait_receipts FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
GRANT SELECT,INSERT ON parallel_life.story_wait_receipts TO pl_app;
CREATE FUNCTION parallel_life.check_story_wait_receipt() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e jsonb;v integer;event_command text;c parallel_life.commands%ROWTYPE;
BEGIN
 SELECT payload,version,command_id INTO e,v,event_command FROM parallel_life.world_events
 WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND id=NEW.source_event_id;
 SELECT * INTO c FROM parallel_life.commands
 WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND id=NEW.command_id;
 IF e IS NULL OR c.id IS NULL OR c.status IS DISTINCT FROM 'succeeded' OR c.request_hash IS DISTINCT FROM NEW.request_hash
  OR c.result_event_id IS DISTINCT FROM NEW.source_event_id OR e->>'type' IS DISTINCT FROM 'story.waited'
  OR event_command IS DISTINCT FROM NEW.command_id OR v IS DISTINCT FROM NEW.version
  OR e->>'id' IS DISTINCT FROM NEW.source_event_id OR e->>'worldId' IS DISTINCT FROM NEW.world_id
  OR e->>'commandId' IS DISTINCT FROM NEW.command_id OR (e->>'version')::integer IS DISTINCT FROM NEW.version
  OR c.expected_version+1 IS DISTINCT FROM NEW.version
  OR c.request_payload->>'target' IS DISTINCT FROM e->'data'->>'target'
  OR NEW.document IS DISTINCT FROM jsonb_build_object(
   'status','committed','commandId',NEW.command_id::text,'worldId',NEW.world_id,'version',NEW.version,
   'sourceEventId',NEW.source_event_id,'fromStoryAt',e->'data'->>'fromStoryAt',
   'storyNow',e->>'storyAt','targetAt',e->'data'->>'targetAt','stoppedBy',e->'data'->'stoppedBy')
 THEN RAISE EXCEPTION 'INVALID_STORY_WAIT_RECEIPT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER story_wait_receipt_source BEFORE INSERT ON parallel_life.story_wait_receipts
 FOR EACH ROW EXECUTE FUNCTION parallel_life.check_story_wait_receipt();
