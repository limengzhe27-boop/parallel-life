-- App-only native NPC group projection. Existing player/worker policies stay unchanged.
-- A transaction marker is necessary but never sufficient to authorize an NPC message.
CREATE FUNCTION parallel_life.agent_native_group_insert_allowed(
  w text, o text, g text, e text, v integer, doc jsonb
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT o=current_setting('app.user_id',true) AND EXISTS (
  SELECT 1 FROM parallel_life.agent_attempts a
  JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=a.world_id AND rw.owner_id=a.owner_id AND rw.engine_epoch=a.engine_epoch
  JOIN parallel_life.worlds world ON world.id=a.world_id AND world.owner_id=a.owner_id AND world.version=a.expected_world_version
  JOIN parallel_life.actor_agent_states s ON s.world_id=a.world_id AND s.owner_id=a.owner_id AND s.actor_id=a.actor_id AND s.revision=a.expected_actor_revision
  JOIN parallel_life.agent_input_receipts r ON r.id=a.input_receipt_id AND r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.input_hash=a.input_hash
  JOIN parallel_life.world_events ev ON ev.id=e AND ev.world_id=a.world_id AND ev.owner_id=a.owner_id AND ev.version=a.expected_world_version+1 AND ev.command_id=a.command_id
  JOIN parallel_life.commands c ON c.world_id=ev.world_id AND c.owner_id=ev.owner_id AND c.id=ev.command_id AND c.expected_version=a.expected_world_version AND c.request_hash=a.input_hash
  WHERE a.id=current_setting('app.agent_commit_attempt_id',true)
   AND a.world_id=w AND a.owner_id=o AND a.status='response_received' AND a.lease_until>clock_timestamp()
   AND current_setting('app.agent_world_id',true)=w
   AND current_setting('app.agent_engine_epoch',true)=a.engine_epoch::text AND a.engine_epoch>=2
   AND ev.payload->>'type'='group.turn_resolved' AND ev.payload->'data'->>'groupId'=g
   AND ev.payload->'data'->>'actorId'=a.actor_id AND ev.version=v
   AND ev.payload->'data'->'agentRuntime'->>'inputReceiptId'=r.id
   AND ev.payload->'data'->'agentRuntime'->>'engineEpoch'=a.engine_epoch::text
   AND ev.payload->'data'->'agentRuntime'->>'inputStoryAt'=r.document->>'storyAt'
   AND ev.payload->'data'->'agentRuntime'->>'inputWorldVersion'=r.document->>'expectedWorldVersion'
   AND r.document->>'channel'='group' AND r.document->>'threadId'=g
   AND (r.document->>'recipientActorId' IS NULL OR r.document->>'recipientActorId'=a.actor_id)
   AND (r.document->>'expectedWorldVersion')::integer<=a.expected_world_version
   AND c.status IN ('queued','succeeded') AND (c.result_event_id IS NULL OR c.result_event_id=e)
   AND doc->>'ownerId'=o AND doc->>'worldId'=w AND doc->>'conversationId'=g
   AND doc->>'sourceEventId'=e AND doc->>'sourceVersion'=v::text
   AND doc->'sender'->>'kind'='actor' AND doc->'sender'->>'actorId'=a.actor_id
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(ev.payload->'data'->'replies') reply
     WHERE reply->>'actorId'=a.actor_id AND reply->>'messageId'=doc->>'id' AND reply->>'text'=doc->>'text')
   AND EXISTS(SELECT 1 FROM parallel_life.world_group_memberships m WHERE m.world_id=w AND m.owner_id=o AND m.group_id=g AND m.member_key=a.actor_id
     AND m.joined_version<=(r.document->>'expectedWorldVersion')::integer
     AND (m.left_version IS NULL OR m.left_version>(r.document->>'expectedWorldVersion')::integer)
     AND m.joined_version<=v AND (m.left_version IS NULL OR m.left_version>v))
   AND EXISTS(SELECT 1 FROM parallel_life.world_group_memberships m WHERE m.world_id=w AND m.owner_id=o AND m.group_id=g AND m.member_key='player'
     AND m.joined_version<=(r.document->>'expectedWorldVersion')::integer
     AND (m.left_version IS NULL OR m.left_version>(r.document->>'expectedWorldVersion')::integer)
     AND m.joined_version<=v AND (m.left_version IS NULL OR m.left_version>v))
 );
$$;
REVOKE ALL ON FUNCTION parallel_life.agent_native_group_insert_allowed(text,text,text,text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.agent_native_group_insert_allowed(text,text,text,text,integer,jsonb) TO pl_app;
CREATE POLICY agent_native_group_insert ON parallel_life.world_group_messages FOR INSERT TO pl_app
 WITH CHECK(parallel_life.agent_native_group_insert_allowed(world_id,owner_id,group_id,source_event_id,source_version,document));

-- INSERT happens while the command is queued and the attempt has a received response.
-- COMMIT is legal only after the same UoW finishes the actual command/actor/attempt.
CREATE FUNCTION parallel_life.agent_native_group_finish_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ok boolean; BEGIN
 IF NEW.document->'sender'->>'kind'<>'actor' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM parallel_life.world_events e WHERE e.id=NEW.source_event_id AND e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id AND e.payload->'data' ? 'agentRuntime')
 THEN RETURN NEW; END IF;
 SELECT EXISTS(
  SELECT 1 FROM parallel_life.world_events e
  JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
  JOIN parallel_life.agent_attempts a ON a.world_id=e.world_id AND a.owner_id=e.owner_id AND a.command_id=e.command_id AND a.status='committed' AND a.event_id=e.id
  JOIN parallel_life.actor_agent_states s ON s.world_id=a.world_id AND s.owner_id=a.owner_id AND s.actor_id=a.actor_id AND s.revision=a.expected_actor_revision+1 AND s.projected_world_version=e.version
  JOIN parallel_life.worlds w ON w.id=e.world_id AND w.owner_id=e.owner_id AND w.version=e.version
  WHERE e.id=NEW.source_event_id AND e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id
   AND e.version=NEW.source_version AND a.expected_world_version+1=e.version
   AND e.payload->>'type'='group.turn_resolved' AND e.payload->'data'->>'groupId'=NEW.group_id
   AND e.payload->'data'->>'actorId'=a.actor_id AND NEW.document->'sender'->>'actorId'=a.actor_id
   AND a.input_receipt_id=e.payload->'data'->'agentRuntime'->>'inputReceiptId'
   AND s.document=e.payload->'data'->'agentRuntime'->'stateAfter'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'replies') reply
     WHERE reply->>'actorId'=a.actor_id AND reply->>'messageId'=NEW.id AND reply->>'text'=NEW.document->>'text')
 ) INTO ok;
 IF NOT ok THEN RAISE EXCEPTION 'AGENT_NATIVE_COMMIT_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION parallel_life.agent_native_group_finish_guard() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER agent_native_group_finish
 AFTER INSERT ON parallel_life.world_group_messages DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_native_group_finish_guard();
