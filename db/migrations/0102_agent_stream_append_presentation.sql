-- Preserve every immutable per-unit presentation source under the same paid attempt.
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
   AND m.document->>'role'='assistant' AND (m.document->>'sourceEventId'=NEW.source_event_id OR EXISTS(
     SELECT 1 FROM parallel_life.agent_attempt_stream_segments s JOIN parallel_life.world_events e
       ON e.world_id=s.world_id AND e.owner_id=s.owner_id AND e.id=s.source_event_id AND e.version=s.source_version
     JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
       AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=e.version-1
     WHERE s.world_id=NEW.world_id AND s.owner_id=NEW.owner_id AND s.attempt_id=NEW.attempt_id
       AND s.actor_id=NEW.actor_id AND s.status='committed' AND s.message_id=m.id AND s.source_event_id=m.document->>'sourceEventId'
       AND e.payload#>>'{data,stream,attemptId}'=NEW.attempt_id
       AND e.payload#>>'{data,agentRuntime,inputReceiptId}'=NEW.input_receipt_id));
 IF messages IS DISTINCT FROM NEW.presented_message_ids THEN RAISE EXCEPTION 'INVALID_EPISODE_PRESENTATION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

-- The stream metadata is runtime provenance, not a model-authored alternate command.
CREATE UNIQUE INDEX agent_stream_execution_unit_unique
 ON parallel_life.world_events(world_id,(payload#>>'{data,stream,attemptId}'),(payload#>>'{data,stream,unit}'))
 WHERE payload#>'{data,stream}' IS NOT NULL;
CREATE FUNCTION parallel_life.guard_agent_stream_execution_unit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE unit jsonb; attempt parallel_life.agent_attempts%ROWTYPE; input jsonb; BEGIN
 IF TG_OP='UPDATE' AND OLD.payload#>'{data,stream}' IS NOT NULL AND NEW IS DISTINCT FROM OLD
 THEN RAISE EXCEPTION 'IMMUTABLE_STREAM_EXECUTION_UNIT' USING ERRCODE='23514'; END IF;
 unit:=NEW.payload#>'{data,stream}';
 IF unit IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO attempt FROM parallel_life.agent_attempts a WHERE a.world_id=NEW.world_id AND a.owner_id=NEW.owner_id AND a.id=unit->>'attemptId';
 SELECT document INTO input FROM parallel_life.agent_input_receipts r WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.id=attempt.input_receipt_id;
 IF jsonb_typeof(unit)<>'object' OR NOT(unit ?& ARRAY['attemptId','parentCommandId','unit','inputMessageId'])
   OR unit-ARRAY['attemptId','parentCommandId','unit','inputMessageId','replyMessageId']<>'{}'::jsonb
   OR attempt.id IS NULL OR current_setting('app.agent_commit_attempt_id',true) IS DISTINCT FROM attempt.id
   OR attempt.status NOT IN ('request_sent','response_received')
   OR unit->>'parentCommandId' IS DISTINCT FROM attempt.command_id
   OR unit->>'unit' !~ '^(statement:([0-9]|[1-5][0-9]|6[0-3])|media|final)$'
   OR (unit->>'unit'='final') IS DISTINCT FROM (NEW.command_id=attempt.command_id)
   OR NEW.payload#>>'{data,actorId}' IS DISTINCT FROM attempt.actor_id
   OR NEW.payload#>>'{data,agentRuntime,inputReceiptId}' IS DISTINCT FROM attempt.input_receipt_id
   OR NEW.payload#>>'{data,userText}' IS DISTINCT FROM input->>'text'
   OR NEW.version<=attempt.expected_world_version
 THEN RAISE EXCEPTION 'INVALID_STREAM_EXECUTION_UNIT' USING ERRCODE='23514'; END IF;
 IF unit->>'inputMessageId'=NEW.id||'_user' AND EXISTS(SELECT 1 FROM parallel_life.world_events e
   WHERE e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id AND e.payload#>>'{data,stream,attemptId}'=attempt.id)
 THEN RAISE EXCEPTION 'DUPLICATE_STREAM_INPUT_ANCHOR' USING ERRCODE='23514'; END IF;
 IF unit->>'inputMessageId' IS DISTINCT FROM NEW.id||'_user' AND NOT EXISTS(
   SELECT 1 FROM parallel_life.world_messages m JOIN parallel_life.world_events e
    ON e.world_id=m.world_id AND e.owner_id=m.owner_id AND e.id=m.document->>'sourceEventId'
   WHERE m.world_id=NEW.world_id AND m.owner_id=NEW.owner_id AND m.id=unit->>'inputMessageId'
    AND m.actor_id=attempt.actor_id AND m.document->>'role'='user' AND m.document->>'text'=input->>'text'
    AND e.payload#>>'{data,stream,attemptId}'=attempt.id AND e.payload#>>'{data,stream,parentCommandId}'=attempt.command_id)
 THEN RAISE EXCEPTION 'INVALID_STREAM_INPUT_ANCHOR' USING ERRCODE='23514'; END IF;
 IF unit ? 'replyMessageId' AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_attempt_stream_segments s
   JOIN parallel_life.world_messages m ON m.world_id=s.world_id AND m.owner_id=s.owner_id AND m.id=s.message_id
   WHERE s.world_id=NEW.world_id AND s.owner_id=NEW.owner_id AND s.attempt_id=attempt.id AND s.actor_id=attempt.actor_id
    AND s.status='committed' AND s.message_id=unit->>'replyMessageId' AND m.document->>'role'='assistant')
 THEN RAISE EXCEPTION 'INVALID_STREAM_MEDIA_ANCHOR' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_stream_execution_unit_guard BEFORE INSERT OR UPDATE ON parallel_life.world_events
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_agent_stream_execution_unit();
CREATE FUNCTION parallel_life.guard_agent_stream_segment_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.status='committed' AND (NEW.source_event_id,NEW.source_version,NEW.message_id,NEW.text,NEW.user_message_id)
   IS DISTINCT FROM (OLD.source_event_id,OLD.source_version,OLD.message_id,OLD.text,OLD.user_message_id)
 THEN RAISE EXCEPTION 'IMMUTABLE_STREAM_SEGMENT_SOURCE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_stream_segment_source_guard BEFORE UPDATE ON parallel_life.agent_attempt_stream_segments
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_agent_stream_segment_source();
