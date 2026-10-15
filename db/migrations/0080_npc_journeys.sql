-- Physical journey ledger only. Real capability execution, projection and scheduling are separate.
CREATE TABLE parallel_life.npc_journeys (
 world_id text NOT NULL, owner_id text NOT NULL, id text NOT NULL,
 actor_id text NOT NULL, engine_epoch integer NOT NULL CHECK(engine_epoch>=2),
 status text NOT NULL CHECK(status IN ('in_transit','arrived')),
 revision integer NOT NULL CHECK(revision IN (0,1)),
 departure_attempt_id text NOT NULL, departure_action_id text NOT NULL, departure_result_id text NOT NULL,
 origin_event_id text NOT NULL, origin_version integer NOT NULL CHECK(origin_version>0),
 departure_event_id text NOT NULL, departure_version integer NOT NULL CHECK(departure_version>origin_version),
 departed_at timestamptz NOT NULL, planned_arrival_at timestamptz NOT NULL CHECK(planned_arrival_at>departed_at),
 arrival_command_id text, arrival_event_id text, arrival_version integer, arrival_receipt_id text, arrived_at timestamptz,
 document jsonb NOT NULL,
 route_source_event_id text GENERATED ALWAYS AS (CASE WHEN document->'route'->'source'->>'kind'='world_event' THEN document->'route'->'source'->>'eventId' END) STORED,
 route_source_version integer GENERATED ALWAYS AS (CASE WHEN document->'route'->'source'->>'kind'='world_event' THEN (document->'route'->'source'->>'eventVersion')::integer END) STORED,
 PRIMARY KEY(world_id,id), UNIQUE(world_id,actor_id,departure_action_id),
 UNIQUE(world_id,arrival_command_id), UNIQUE(world_id,arrival_event_id), UNIQUE(world_id,arrival_receipt_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,actor_id) REFERENCES parallel_life.actor_agent_states(world_id,actor_id),
 FOREIGN KEY(world_id,departure_attempt_id,owner_id) REFERENCES parallel_life.agent_attempts(world_id,id,owner_id),
 FOREIGN KEY(world_id,departure_result_id) REFERENCES parallel_life.agent_action_results(world_id,id),
 FOREIGN KEY(world_id,route_source_event_id,owner_id,route_source_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 FOREIGN KEY(world_id,origin_event_id,owner_id,origin_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 FOREIGN KEY(world_id,departure_event_id,owner_id,departure_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 FOREIGN KEY(world_id,arrival_event_id,owner_id,arrival_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 FOREIGN KEY(world_id,arrival_command_id,owner_id) REFERENCES parallel_life.commands(world_id,id,owner_id),
 CHECK(id ~ '^[a-zA-Z0-9_-]{1,56}$'),
 CHECK((document->'route'->'source'->>'kind') IS DISTINCT FROM 'world_event' OR (route_source_event_id IS NOT NULL AND route_source_version>0 AND route_source_version<departure_version)),
 CHECK((status='in_transit' AND revision=0 AND arrival_command_id IS NULL AND arrival_event_id IS NULL
   AND arrival_version IS NULL AND arrival_receipt_id IS NULL AND arrived_at IS NULL AND NOT(document ? 'arrival'))
  OR (status='arrived' AND revision=1 AND arrival_command_id='arrival_'||id AND arrival_event_id IS NOT NULL
   AND arrival_version>departure_version AND arrival_receipt_id IS NOT NULL AND arrived_at>=planned_arrival_at
   AND arrival_event_id<>departure_event_id AND arrival_event_id<>origin_event_id AND arrival_receipt_id<>departure_result_id)),
 CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=32768
  AND document ?& ARRAY['id','worldId','actorId','status','revision','beginActionId','origin','route','preparedAtVersion','departedAt','plannedArrivalAt','departure','departureLocalTime','plannedArrivalLocalTime']
  AND (document->>'id') IS NOT DISTINCT FROM id AND (document->>'worldId') IS NOT DISTINCT FROM world_id
  AND (document->>'actorId') IS NOT DISTINCT FROM actor_id AND (document->>'status') IS NOT DISTINCT FROM status
  AND (document->'revision') IS NOT DISTINCT FROM to_jsonb(revision)
  AND (document->>'beginActionId') IS NOT DISTINCT FROM departure_action_id
  AND (document->>'preparedAtVersion')::integer=departure_version-1
  AND (document->>'departedAt')::timestamptz=departed_at
  AND (document->>'plannedArrivalAt')::timestamptz=planned_arrival_at
  AND (document->'origin'->>'sourceEventId') IS NOT DISTINCT FROM origin_event_id
  AND (document->'origin'->>'worldVersion')::integer=origin_version
  AND (document->'departure'->>'id') IS NOT DISTINCT FROM departure_result_id
  AND (document->'departure'->>'eventId') IS NOT DISTINCT FROM departure_event_id
  AND (document->'departure'->>'worldVersion')::integer=departure_version),
 CHECK(status<>'arrived' OR (document->'arrival') IS NOT DISTINCT FROM jsonb_build_object(
  'worldId',world_id,'actorId',actor_id,'id',arrival_receipt_id,'commandId',arrival_command_id,
  'eventId',arrival_event_id,'worldVersion',arrival_version,'at',document->'arrival'->>'at','journeyId',id)
  AND (document->'arrival'->>'at')::timestamptz=arrived_at)
);
CREATE UNIQUE INDEX npc_journey_one_active_actor ON parallel_life.npc_journeys(world_id,actor_id) WHERE status='in_transit';
CREATE INDEX npc_journey_due ON parallel_life.npc_journeys(world_id,planned_arrival_at,id) WHERE status='in_transit';
ALTER TABLE parallel_life.npc_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.npc_journeys FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.npc_journeys FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY npc_journey_owner ON parallel_life.npc_journeys TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE ON parallel_life.npc_journeys TO pl_app;

-- SECURITY INVOKER deliberately preserves caller RLS/ACL; GUCs alone never certify travel.
CREATE FUNCTION parallel_life.guard_npc_journey() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
    AND a.expected_world_version=NEW.departure_version-1 AND e.version=NEW.departure_version AND w.version=e.version
    AND e.command_id=a.command_id AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=a.expected_world_version
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
CREATE TRIGGER npc_journey_source_guard BEFORE INSERT OR UPDATE ON parallel_life.npc_journeys
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_npc_journey();
REVOKE ALL ON FUNCTION parallel_life.guard_npc_journey() FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
