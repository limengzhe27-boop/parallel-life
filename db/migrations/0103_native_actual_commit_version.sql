-- Preserve immutable model/input baselines; certify native projections and departures
-- against the actual successful command/event append. Existing policies/triggers remain.
-- App-only native NPC group projection. Existing player/worker policies stay unchanged.
-- A transaction marker is necessary but never sufficient to authorize an NPC message.
CREATE OR REPLACE FUNCTION parallel_life.agent_native_group_insert_allowed(
  w text, o text, g text, e text, v integer, doc jsonb
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT o=current_setting('app.user_id',true) AND EXISTS (
  SELECT 1 FROM parallel_life.agent_attempts a
  JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=a.world_id AND rw.owner_id=a.owner_id AND rw.engine_epoch=a.engine_epoch
  JOIN parallel_life.worlds world ON world.id=a.world_id AND world.owner_id=a.owner_id 
  JOIN parallel_life.actor_agent_states s ON s.world_id=a.world_id AND s.owner_id=a.owner_id AND s.actor_id=a.actor_id AND s.revision=a.expected_actor_revision
  JOIN parallel_life.agent_input_receipts r ON r.id=a.input_receipt_id AND r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.input_hash=a.input_hash
  JOIN parallel_life.world_events ev ON ev.id=e AND ev.world_id=a.world_id AND ev.owner_id=a.owner_id AND ev.version>a.expected_world_version AND world.version=ev.version-1 AND ev.command_id=a.command_id
  JOIN parallel_life.commands c ON c.world_id=ev.world_id AND c.owner_id=ev.owner_id AND c.id=ev.command_id AND c.expected_version=ev.version-1 AND c.request_hash=a.input_hash
  WHERE a.id=current_setting('app.agent_commit_attempt_id',true)
   AND a.world_id=w AND a.owner_id=o AND a.status='response_received' AND a.lease_until>clock_timestamp()
   AND current_setting('app.agent_world_id',true)=w
   AND current_setting('app.agent_engine_epoch',true)=a.engine_epoch::text AND a.engine_epoch>=2
   AND ev.payload->>'type'='group.turn_resolved' AND ev.payload->'data'->>'groupId'=g
   AND ev.payload->'data'->>'actorId'=a.actor_id AND ev.version=v AND current_setting('app.agent_commit_version',true)=v::text
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

-- INSERT happens while the command is queued and the attempt has a received response.
-- COMMIT is legal only after the same UoW finishes the actual command/actor/attempt.
CREATE OR REPLACE FUNCTION parallel_life.agent_native_group_finish_guard()
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
   AND e.version=NEW.source_version AND a.expected_world_version<e.version AND c.expected_version=e.version-1
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

CREATE OR REPLACE FUNCTION parallel_life.guard_npc_journey() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE ok boolean; pos jsonb; BEGIN
 IF current_setting('app.user_id',true) IS DISTINCT FROM NEW.owner_id THEN
  RAISE EXCEPTION 'JOURNEY_OWNER_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'in_transit' OR NEW.revision<>0 THEN
   RAISE EXCEPTION 'JOURNEY_DEPARTURE_REQUIRED' USING ERRCODE='23514'; END IF;
  SELECT EXISTS(
   SELECT 1 FROM parallel_life.agent_attempts a
   JOIN parallel_life.agent_runtime_worlds control ON control.world_id=a.world_id AND control.owner_id=a.owner_id AND control.engine_epoch=a.engine_epoch
   JOIN parallel_life.worlds w ON w.id=a.world_id AND w.owner_id=a.owner_id
   JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
   JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
   JOIN parallel_life.agent_action_results r ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.actor_id=a.actor_id AND r.id=NEW.departure_result_id
   JOIN parallel_life.actor_agent_states s ON s.world_id=a.world_id AND s.owner_id=a.owner_id AND s.actor_id=a.actor_id
   WHERE a.id=NEW.departure_attempt_id AND a.world_id=NEW.world_id AND a.owner_id=NEW.owner_id AND a.actor_id=NEW.actor_id
    AND a.status='committed' AND a.engine_epoch=NEW.engine_epoch AND a.event_id=NEW.departure_event_id
    AND a.id=current_setting('app.agent_commit_attempt_id',true)
    AND a.world_id=current_setting('app.agent_world_id',true) AND a.engine_epoch::text=current_setting('app.agent_engine_epoch',true)
    AND a.expected_world_version<NEW.departure_version AND e.version=NEW.departure_version AND w.version=e.version
    AND e.command_id=a.command_id AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=e.version-1
    AND e.payload->>'worldId'=NEW.world_id AND e.payload->>'id'=e.id AND e.payload->>'commandId'=c.id
    AND (e.payload->>'version')::integer=e.version AND (e.payload->>'storyAt')::timestamptz=NEW.departed_at
    AND e.payload->'data'->>'actorId'=NEW.actor_id
    AND e.payload->'data'->'agentRuntime'->>'inputReceiptId'=a.input_receipt_id
    AND (e.payload->'data'->'agentRuntime'->>'engineEpoch')::integer=a.engine_epoch
    AND s.document=e.payload->'data'->'agentRuntime'->'stateAfter' AND s.projected_world_version=e.version
    AND r.action_id=NEW.departure_action_id AND r.source_event_id=e.id AND r.world_version=e.version
    AND r.document->>'outcome'='succeeded' AND r.document @> (NEW.document->'departure')
    AND (SELECT count(*) FROM jsonb_array_elements(e.payload->'data'->'agentRuntime'->'departures') d WHERE d=NEW.document)=1
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'agentRuntime'->'proposal'->'actions') action
      WHERE action->>'id'=NEW.departure_action_id AND action->>'capability'='travel.begin'
       AND action->'parameters'=jsonb_build_object('routeId',NEW.document->'route'->>'id'))
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.document->'actions') action
      WHERE action->>'id'=NEW.departure_action_id AND action->>'capability'='travel.begin'
       AND action->>'status'='succeeded' AND action->>'resultId'=r.id
       AND action->'parameters'=jsonb_build_object('routeId',NEW.document->'route'->>'id'))
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'agentRuntime'->'results') result WHERE result=r.document)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.state->'space'->'routes') route WHERE route=NEW.document->'route')
    AND NEW.document->'origin'->>'worldId'=NEW.world_id AND NEW.document->'origin'->'subject'=jsonb_build_object('kind','actor','actorId',NEW.actor_id)
    AND NEW.document->'origin'->>'status'='at' AND NEW.document->'origin'->>'placeId'=NEW.document->'route'->>'fromPlaceId'
    AND NEW.document->'departure'=jsonb_build_object('worldId',NEW.world_id,'actorId',NEW.actor_id,'id',r.id,
      'actionId',r.action_id,'eventId',e.id,'worldVersion',e.version,'at',NEW.document->>'departedAt','outcome','succeeded')
    AND (NEW.document->'origin'->>'occurredAt')::timestamptz<=NEW.departed_at
    AND (NEW.document->'route'->>'durationMinutes')::integer BETWEEN 1 AND 120
    AND NEW.planned_arrival_at=NEW.departed_at+((NEW.document->'route'->>'durationMinutes')::integer*interval '1 minute')
  ) INTO ok;
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_JOURNEY_DEPARTURE_SOURCE' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','revision','arrival_command_id','arrival_event_id','arrival_version','arrival_receipt_id','arrived_at','document','route_source_event_id','route_source_version'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','arrival_command_id','arrival_event_id','arrival_version','arrival_receipt_id','arrived_at','document','route_source_event_id','route_source_version'])
    OR (NEW.document-ARRAY['status','revision','arrival']) IS DISTINCT FROM (OLD.document-ARRAY['status','revision','arrival'])
    OR OLD.status<>'in_transit' OR OLD.revision<>0 OR NEW.status<>'arrived' OR NEW.revision<>1
  THEN RAISE EXCEPTION 'IMMUTABLE_JOURNEY_BASIS' USING ERRCODE='23514'; END IF;
  SELECT EXISTS(
   SELECT 1 FROM parallel_life.world_events e
   JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
   JOIN parallel_life.worlds w ON w.id=e.world_id AND w.owner_id=e.owner_id
   JOIN parallel_life.world_clock clock ON clock.world_id=e.world_id AND clock.owner_id=e.owner_id
   JOIN parallel_life.agent_runtime_worlds control ON control.world_id=e.world_id AND control.owner_id=e.owner_id
   WHERE e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id AND e.id=NEW.arrival_event_id AND e.version=NEW.arrival_version
    AND c.id=NEW.arrival_command_id AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=e.version-1
    AND w.version=e.version AND control.engine_epoch=NEW.engine_epoch
    AND current_setting('app.agent_world_id',true)=NEW.world_id AND current_setting('app.agent_engine_epoch',true)=NEW.engine_epoch::text
    AND NULLIF(current_setting('app.agent_commit_attempt_id',true),'') IS NULL
    AND clock.paused=false AND clock.story_now=NEW.arrived_at AND NEW.arrived_at>=NEW.planned_arrival_at
    AND e.payload->>'id'=e.id AND e.payload->>'worldId'=NEW.world_id AND e.payload->>'commandId'=c.id
    AND (e.payload->>'version')::integer=e.version AND e.payload->>'type'='agent.arrival_committed'
    AND (e.payload->>'storyAt')::timestamptz=NEW.arrived_at
    AND e.payload->'data'=jsonb_build_object('actorId',NEW.actor_id,'journeyId',NEW.id,
      'departureEventId',NEW.departure_event_id,'route',NEW.document->'route','arrival',NEW.document->'arrival')
  ) INTO ok;
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'INVALID_JOURNEY_ARRIVAL_SOURCE' USING ERRCODE='23514'; END IF;
 END IF;
 -- Only this actor's authoritative projection, never the player's position.
 SELECT document INTO pos FROM parallel_life.world_authoritative_positions
  WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND subject_key='actor:'||NEW.actor_id;
 IF TG_OP='INSERT' THEN
  ok := (pos->>'status'='at' AND pos->>'sourceEventId'=NEW.origin_event_id
    AND (pos->>'worldVersion')::integer=NEW.origin_version AND pos->>'placeId'=NEW.document->'route'->>'fromPlaceId'
    AND (pos->>'occurredAt')::timestamptz=(NEW.document->'origin'->>'occurredAt')::timestamptz)
   OR (pos->>'status'='in_transit' AND pos->>'sourceEventId'=NEW.departure_event_id
    AND (pos->>'worldVersion')::integer=NEW.departure_version AND pos->'placeId'='null'::jsonb
    AND (pos->>'occurredAt')::timestamptz=NEW.departed_at);
 ELSE
  ok := (pos->>'status'='in_transit' AND pos->>'sourceEventId'=NEW.departure_event_id
    AND (pos->>'worldVersion')::integer=NEW.departure_version AND pos->'placeId'='null'::jsonb
    AND (pos->>'occurredAt')::timestamptz=NEW.departed_at)
   OR (pos->>'status'='at' AND pos->>'sourceEventId'=NEW.arrival_event_id
    AND (pos->>'worldVersion')::integer=NEW.arrival_version AND pos->>'placeId'=NEW.document->'route'->>'toPlaceId'
    AND (pos->>'occurredAt')::timestamptz=NEW.arrived_at);
 END IF;
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'JOURNEY_POSITION_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
