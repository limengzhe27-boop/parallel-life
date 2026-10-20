-- Consumption uses actual append proof; immutable input, snapshot and claim guards are unchanged.
CREATE OR REPLACE FUNCTION parallel_life.guard_agent_episode_request() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE opportunity jsonb; body jsonb; intent jsonb; definition_ref text; BEGIN
 IF TG_OP='INSERT' THEN
  SELECT o INTO opportunity FROM parallel_life.director_decisions d
   JOIN parallel_life.director_runtime_attempts a ON a.id=d.attempt_id AND a.world_id=d.world_id AND a.owner_id=d.owner_id
   JOIN parallel_life.shared_episodes ep ON ep.world_id=d.world_id AND ep.owner_id=d.owner_id AND ep.id=NEW.episode_id AND ep.origin_decision_id=d.id,
   LATERAL jsonb_array_elements(d.document->'opportunities') o
   WHERE d.world_id=NEW.world_id AND d.owner_id=NEW.owner_id AND d.id=NEW.origin_decision_id
    AND d.engine_epoch=NEW.engine_epoch AND d.world_version=NEW.created_at_version
    AND a.status='committed' AND a.decision_id=d.id AND o->>'id'=NEW.episode_id;
  IF opportunity IS NULL OR NOT(opportunity->'participantActorIds' ? NEW.actor_id)
    OR opportunity->>'activity' IS DISTINCT FROM NEW.activity OR NEW.status<>'pending'
    OR NEW.input_receipt_id IS NOT NULL OR NEW.receipt_id IS NOT NULL
  THEN RAISE EXCEPTION 'INVALID_EPISODE_REQUEST_ORIGIN' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.world_id,NEW.owner_id,NEW.id,NEW.actor_id,NEW.episode_id,NEW.origin_decision_id,NEW.engine_epoch,NEW.created_at_version,NEW.activity,NEW.created_at)
   IS DISTINCT FROM (OLD.world_id,OLD.owner_id,OLD.id,OLD.actor_id,OLD.episode_id,OLD.origin_decision_id,OLD.engine_epoch,OLD.created_at_version,OLD.activity,OLD.created_at)
   OR OLD.status='consumed' OR (OLD.input_receipt_id IS NOT NULL AND NEW.input_receipt_id IS DISTINCT FROM OLD.input_receipt_id)
  THEN RAISE EXCEPTION 'IMMUTABLE_EPISODE_REQUEST_BASIS' USING ERRCODE='23514'; END IF;
  IF NEW.input_receipt_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM parallel_life.agent_attempts a
     JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
     JOIN parallel_life.worlds w ON w.id=e.world_id AND w.owner_id=e.owner_id AND w.version=e.version
     WHERE a.world_id=NEW.world_id AND a.owner_id=NEW.owner_id AND a.actor_id=NEW.actor_id
      AND a.id=current_setting('app.agent_commit_attempt_id',true) AND a.status='committed'
      AND a.engine_epoch=NEW.engine_epoch AND a.input_receipt_id=NEW.input_receipt_id
      AND e.version>a.expected_world_version
      AND e.command_id=a.command_id
      AND EXISTS(SELECT 1 FROM parallel_life.commands c
        WHERE c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
          AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=e.version-1))
   THEN RAISE EXCEPTION 'EPISODE_INPUT_REQUIRES_ACTUAL_COMMIT' USING ERRCODE='23514'; END IF;
   SELECT r.document INTO body FROM parallel_life.agent_input_receipts r WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.id=NEW.input_receipt_id;
   IF body->>'origin'='player' THEN
    IF body->>'channel' IS DISTINCT FROM 'private' OR body->>'recipientActorId' IS DISTINCT FROM NEW.actor_id
     OR body->>'threadId' IS DISTINCT FROM NEW.actor_id OR NOT EXISTS(
      SELECT 1 FROM parallel_life.agent_episode_attempt_bindings b
      JOIN parallel_life.agent_attempts a ON a.world_id=b.world_id AND a.owner_id=b.owner_id AND a.id=b.attempt_id
      WHERE b.world_id=NEW.world_id AND b.owner_id=NEW.owner_id AND b.request_id=NEW.id AND b.actor_id=NEW.actor_id
       AND b.episode_id=NEW.episode_id AND b.engine_epoch=NEW.engine_epoch AND b.input_receipt_id=NEW.input_receipt_id
       AND a.id=current_setting('app.agent_commit_attempt_id',true) AND a.status='committed'
       AND a.response->'snapshot'->'episodeManifest'=b.document
       AND a.response->'snapshot'->'input'->>'text'=body->>'text'
       AND a.response->'snapshot'->'input'->>'origin'='player'
       AND EXISTS(SELECT 1 FROM parallel_life.agent_episode_receipts er WHERE er.world_id=b.world_id
        AND er.owner_id=b.owner_id AND er.attempt_id=a.id AND er.request_id=b.request_id AND er.choice<>'unassessed'))
    THEN RAISE EXCEPTION 'INVALID_PLAYER_EPISODE_BINDING' USING ERRCODE='23514'; END IF;
   ELSE
   intent := (body->>'text')::jsonb;
   SELECT document->>'definitionRef' INTO definition_ref FROM parallel_life.actor_agent_states
    WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND actor_id=NEW.actor_id;
   IF body IS NULL OR body->>'origin' IS DISTINCT FROM 'coordination' OR body->>'channel' IS DISTINCT FROM 'private'
    OR body->>'recipientActorId' IS DISTINCT FROM NEW.actor_id OR body->>'threadId' IS DISTINCT FROM NEW.actor_id
    OR jsonb_typeof(intent) IS DISTINCT FROM 'object'
    OR NOT(intent ?& ARRAY['type','requestId','revision','activity','placeOptionIds','basisSourceIds'])
    OR intent-ARRAY['type','requestId','revision','activity','placeOptionIds','basisSourceIds'] IS DISTINCT FROM '{}'::jsonb
    OR intent->>'type' IS DISTINCT FROM 'npc_episode_consideration'
    OR intent->>'requestId' IS DISTINCT FROM NEW.id
    OR intent->>'activity' IS DISTINCT FROM NEW.activity
    OR intent->'revision' IS DISTINCT FROM '0'::jsonb
    -- Initial consideration grants no global venue or director-only source.
    -- Existing memories and known places are assembled independently by the NPC snapshot.
    OR intent->'placeOptionIds' IS DISTINCT FROM '[]'::jsonb
    OR definition_ref IS NULL OR intent->'basisSourceIds' IS DISTINCT FROM jsonb_build_array('definition:'||definition_ref)
   THEN RAISE EXCEPTION 'INVALID_EPISODE_REQUEST_INPUT' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
  IF NEW.status='consumed' AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_receipts r
   WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.id=NEW.receipt_id AND r.request_id=NEW.id
    AND r.actor_id=NEW.actor_id AND r.input_receipt_id=NEW.input_receipt_id)
  THEN RAISE EXCEPTION 'INVALID_EPISODE_REQUEST_CONSUMPTION' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION parallel_life.guard_agent_episode_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE decision jsonb; messages jsonb; BEGIN
 IF current_setting('app.agent_commit_attempt_id',true) IS DISTINCT FROM NEW.attempt_id OR NOT EXISTS(
  SELECT 1 FROM parallel_life.agent_attempts a
  JOIN parallel_life.agent_episode_requests r ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=NEW.request_id
  JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
  WHERE a.world_id=NEW.world_id AND a.owner_id=NEW.owner_id AND a.id=NEW.attempt_id AND a.status='committed'
   AND a.actor_id=NEW.actor_id AND r.actor_id=a.actor_id AND r.episode_id=NEW.episode_id AND r.status='pending'
   AND r.engine_epoch=a.engine_epoch AND (r.input_receipt_id IS NULL OR r.input_receipt_id=a.input_receipt_id)
   AND a.input_receipt_id=NEW.input_receipt_id
   AND e.id=NEW.source_event_id AND e.version=NEW.world_version AND e.version>a.expected_world_version
      AND e.command_id=a.command_id
      AND EXISTS(SELECT 1 FROM parallel_life.commands c
        WHERE c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
          AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=e.version-1)
   AND e.payload#>>'{data,agentRuntime,inputReceiptId}'=NEW.input_receipt_id)
 THEN RAISE EXCEPTION 'INVALID_EPISODE_ACTOR_RECEIPT' USING ERRCODE='23514'; END IF;
 SELECT payload#>'{data,agentRuntime,episodeDecision}' INTO decision FROM parallel_life.world_events
  WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND id=NEW.source_event_id;
 IF decision IS DISTINCT FROM (SELECT payload#>'{data,agentRuntime,proposal,episodeDecision}'
   FROM parallel_life.world_events WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND id=NEW.source_event_id)
 THEN RAISE EXCEPTION 'INCONSISTENT_EPISODE_PRIVATE_DECISION' USING ERRCODE='23514'; END IF;
 IF (NEW.choice='unassessed' AND decision IS NOT NULL) OR
  (NEW.choice<>'unassessed' AND decision IS DISTINCT FROM jsonb_build_object(
   'requestId',NEW.request_id,'choice',NEW.choice,'reason',NEW.reason,'sourceIds',NEW.source_ids))
 THEN RAISE EXCEPTION 'INVALID_EPISODE_PRIVATE_DECISION' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM parallel_life.agent_input_receipts i WHERE i.world_id=NEW.world_id AND i.owner_id=NEW.owner_id AND i.id=NEW.input_receipt_id AND i.document->>'origin'='player')
 AND (NEW.choice='unassessed' OR NOT EXISTS(
  SELECT 1 FROM parallel_life.agent_episode_attempt_bindings b JOIN parallel_life.agent_attempts a
   ON a.world_id=b.world_id AND a.owner_id=b.owner_id AND a.id=b.attempt_id
  WHERE b.world_id=NEW.world_id AND b.owner_id=NEW.owner_id AND b.actor_id=NEW.actor_id AND b.attempt_id=NEW.attempt_id
   AND b.input_receipt_id=NEW.input_receipt_id AND b.request_id=NEW.request_id AND b.episode_id=NEW.episode_id
   AND a.response->'snapshot'->'episodeManifest'=b.document
   AND NEW.source_ids ? (b.document->>'sourceId') AND NEW.source_ids ? NEW.input_receipt_id))
 THEN RAISE EXCEPTION 'INVALID_PLAYER_EPISODE_RECEIPT' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(jsonb_agg(m.id ORDER BY m.id),'[]'::jsonb) INTO messages FROM parallel_life.world_messages m
  WHERE m.world_id=NEW.world_id AND m.owner_id=NEW.owner_id AND m.actor_id=NEW.actor_id
   AND m.document->>'role'='assistant' AND m.document->>'sourceEventId'=NEW.source_event_id;
 IF messages IS DISTINCT FROM NEW.presented_message_ids THEN RAISE EXCEPTION 'INVALID_EPISODE_PRESENTATION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
