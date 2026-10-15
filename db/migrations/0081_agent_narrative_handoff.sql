-- One runtime: explicit new-genesis admission, director opportunities and actor-owned delivery.
-- None of these records changes a player's choice, actual position or completed outcome.
CREATE TABLE parallel_life.agent_narrative_admissions (
 world_id text PRIMARY KEY, owner_id text NOT NULL, engine_epoch integer NOT NULL CHECK(engine_epoch>=2),
 kind text NOT NULL CHECK(kind='new_genesis'), genesis_hash text NOT NULL CHECK(genesis_hash ~ '^[0-9a-f]{32}$'),
 admitted_at_version integer NOT NULL CHECK(admitted_at_version=0), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE parallel_life.agent_episode_requests (
 world_id text NOT NULL, owner_id text NOT NULL, id text NOT NULL, actor_id text NOT NULL,
 episode_id text NOT NULL, origin_decision_id text NOT NULL, engine_epoch integer NOT NULL CHECK(engine_epoch>=2),
 created_at_version integer NOT NULL CHECK(created_at_version>=0),
 activity text NOT NULL CHECK(activity IN ('conversation','meeting','follow_up')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','consumed')),
 input_receipt_id text, receipt_id text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,id), UNIQUE(world_id,episode_id,actor_id), UNIQUE(world_id,input_receipt_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,actor_id) REFERENCES parallel_life.actor_agent_states(world_id,actor_id),
 FOREIGN KEY(world_id,episode_id) REFERENCES parallel_life.shared_episodes(world_id,id),
 FOREIGN KEY(world_id,origin_decision_id,owner_id) REFERENCES parallel_life.director_decisions(world_id,id,owner_id),
 FOREIGN KEY(world_id,input_receipt_id,owner_id) REFERENCES parallel_life.agent_input_receipts(world_id,id,owner_id),
 CHECK((status='consumed')=(receipt_id IS NOT NULL)), CHECK(receipt_id IS NULL OR input_receipt_id IS NOT NULL)
);
CREATE TABLE parallel_life.agent_episode_receipts (
 world_id text NOT NULL, owner_id text NOT NULL, id text NOT NULL, actor_id text NOT NULL,
 request_id text NOT NULL, episode_id text NOT NULL, attempt_id text NOT NULL, input_receipt_id text NOT NULL,
 source_event_id text NOT NULL, world_version integer NOT NULL CHECK(world_version>0),
 choice text NOT NULL CHECK(choice IN ('engage','decline','defer','need_information','quiet','unassessed')),
 reason text, source_ids jsonb NOT NULL, presented_message_ids jsonb NOT NULL,
 PRIMARY KEY(world_id,id), UNIQUE(world_id,request_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,request_id) REFERENCES parallel_life.agent_episode_requests(world_id,id),
 FOREIGN KEY(world_id,episode_id) REFERENCES parallel_life.shared_episodes(world_id,id),
 FOREIGN KEY(world_id,attempt_id,owner_id) REFERENCES parallel_life.agent_attempts(world_id,id,owner_id),
 FOREIGN KEY(world_id,input_receipt_id,owner_id) REFERENCES parallel_life.agent_input_receipts(world_id,id,owner_id),
 FOREIGN KEY(world_id,source_event_id,owner_id,world_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 CHECK(jsonb_typeof(source_ids)='array' AND jsonb_array_length(source_ids)<=64),
 CHECK(jsonb_typeof(presented_message_ids)='array' AND jsonb_array_length(presented_message_ids)<=64),
 CHECK((choice='unassessed' AND reason IS NULL AND source_ids='[]'::jsonb) OR
  (choice<>'unassessed' AND reason IS NOT NULL AND length(trim(reason)) BETWEEN 1 AND 2000 AND jsonb_array_length(source_ids)>0))
);
ALTER TABLE parallel_life.agent_episode_requests ADD CONSTRAINT episode_request_receipt
 FOREIGN KEY(world_id,receipt_id) REFERENCES parallel_life.agent_episode_receipts(world_id,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['agent_narrative_admissions','agent_episode_requests','agent_episode_receipts'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON parallel_life.%I FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login',t);
  EXECUTE format('CREATE POLICY agent_narrative_owner ON parallel_life.%I TO pl_app USING(owner_id=current_setting(''app.user_id'',true)) WITH CHECK(owner_id=current_setting(''app.user_id'',true))',t);
  EXECUTE format('GRANT SELECT,INSERT ON parallel_life.%I TO pl_app',t);
 END LOOP;
END $$;
GRANT UPDATE ON parallel_life.agent_episode_requests,parallel_life.shared_episodes TO pl_app;
CREATE FUNCTION parallel_life.guard_agent_narrative_admission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM parallel_life.worlds w
   JOIN parallel_life.world_initial_snapshots i ON i.world_id=w.id AND i.owner_id=w.owner_id
   JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id
   WHERE w.id=NEW.world_id AND w.owner_id=NEW.owner_id AND w.version=0
   AND c.engine_epoch=NEW.engine_epoch AND md5(i.state::text)=NEW.genesis_hash)
 OR EXISTS(SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=NEW.world_id)
 OR EXISTS(SELECT 1 FROM parallel_life.director_runtime_attempts WHERE world_id=NEW.world_id)
 THEN RAISE EXCEPTION 'INVALID_NEW_NARRATIVE_ADMISSION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_narrative_admission_guard BEFORE INSERT ON parallel_life.agent_narrative_admissions
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_agent_narrative_admission();
CREATE FUNCTION parallel_life.guard_agent_episode_request() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE opportunity jsonb; body jsonb; BEGIN
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
   SELECT r.document INTO body FROM parallel_life.agent_input_receipts r WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.id=NEW.input_receipt_id;
   IF body IS NULL OR body->>'origin' IS DISTINCT FROM 'coordination' OR body->>'channel' IS DISTINCT FROM 'private'
    OR body->>'recipientActorId' IS DISTINCT FROM NEW.actor_id OR body->>'threadId' IS DISTINCT FROM NEW.actor_id
    OR (body->>'text')::jsonb->>'type' IS DISTINCT FROM 'npc_episode_consideration'
    OR (body->>'text')::jsonb->>'requestId' IS DISTINCT FROM NEW.id
    OR (body->>'text')::jsonb->>'activity' IS DISTINCT FROM NEW.activity
    OR (body->>'text')::jsonb->'revision' IS DISTINCT FROM '0'::jsonb
   THEN RAISE EXCEPTION 'INVALID_EPISODE_REQUEST_INPUT' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.status='consumed' AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_receipts r
   WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.id=NEW.receipt_id AND r.request_id=NEW.id
    AND r.actor_id=NEW.actor_id AND r.input_receipt_id=NEW.input_receipt_id)
  THEN RAISE EXCEPTION 'INVALID_EPISODE_REQUEST_CONSUMPTION' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_episode_request_guard BEFORE INSERT OR UPDATE ON parallel_life.agent_episode_requests
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_agent_episode_request();
CREATE FUNCTION parallel_life.guard_agent_episode_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE decision jsonb; messages jsonb; BEGIN
 IF current_setting('app.agent_commit_attempt_id',true) IS DISTINCT FROM NEW.attempt_id OR NOT EXISTS(
  SELECT 1 FROM parallel_life.agent_attempts a
  JOIN parallel_life.agent_episode_requests r ON r.world_id=a.world_id AND r.owner_id=a.owner_id AND r.id=NEW.request_id
  JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
  WHERE a.world_id=NEW.world_id AND a.owner_id=NEW.owner_id AND a.id=NEW.attempt_id AND a.status='committed'
   AND a.actor_id=NEW.actor_id AND r.actor_id=a.actor_id AND r.episode_id=NEW.episode_id AND r.status='pending'
   AND r.engine_epoch=a.engine_epoch AND r.input_receipt_id=a.input_receipt_id AND a.input_receipt_id=NEW.input_receipt_id
   AND e.id=NEW.source_event_id AND e.version=NEW.world_version AND e.version=a.expected_world_version+1
   AND e.payload#>>'{data,agentRuntime,inputReceiptId}'=NEW.input_receipt_id)
 THEN RAISE EXCEPTION 'INVALID_EPISODE_ACTOR_RECEIPT' USING ERRCODE='23514'; END IF;
 SELECT payload#>'{data,agentRuntime,episodeDecision}' INTO decision FROM parallel_life.world_events
  WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND id=NEW.source_event_id;
 IF (NEW.choice='unassessed' AND decision IS NOT NULL) OR
  (NEW.choice<>'unassessed' AND decision IS DISTINCT FROM jsonb_build_object(
   'requestId',NEW.request_id,'choice',NEW.choice,'reason',NEW.reason,'sourceIds',NEW.source_ids))
 THEN RAISE EXCEPTION 'INVALID_EPISODE_PRIVATE_DECISION' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(jsonb_agg(m.id ORDER BY m.id),'[]'::jsonb) INTO messages FROM parallel_life.world_messages m
  WHERE m.world_id=NEW.world_id AND m.owner_id=NEW.owner_id AND m.actor_id=NEW.actor_id
   AND m.document->>'role'='assistant' AND m.document->>'sourceEventId'=NEW.source_event_id;
 IF messages IS DISTINCT FROM NEW.presented_message_ids THEN RAISE EXCEPTION 'INVALID_EPISODE_PRESENTATION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_episode_receipt_guard BEFORE INSERT ON parallel_life.agent_episode_receipts
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_agent_episode_receipt();
-- Proposed opportunity -> actually presented by an independently agreeing actor.
-- This deliberately does not admit resolved/withdrawn or infer completion from message counts.
ALTER TABLE parallel_life.shared_episodes DROP CONSTRAINT shared_episodes_check;
ALTER TABLE parallel_life.shared_episodes ADD CONSTRAINT shared_episodes_check CHECK(
 jsonb_typeof(document)='object' AND octet_length(document::text)<=65536
 AND document ?& ARRAY['schemaVersion','worldId','id','revision','origin','status','title','description','participantActorIds','placeIds','sourceEventIds','resultIds','unresolvedResponsibilityIds']
 AND document - ARRAY['schemaVersion','worldId','id','revision','origin','status','title','description','participantActorIds','placeIds','sourceEventIds','resultIds','unresolvedResponsibilityIds']='{}'::jsonb
 AND document->'schemaVersion'='1'::jsonb AND (document->>'worldId') IS NOT DISTINCT FROM world_id
 AND (document->>'id') IS NOT DISTINCT FROM id AND jsonb_typeof(document->'revision')='number'
 AND (document->>'revision')::integer>=0
 AND document->>'status' IN ('proposed','active') AND document->'origin'=jsonb_build_object('kind','director','sourceId',origin_decision_id)
 AND jsonb_typeof(document->'title')='string' AND jsonb_typeof(document->'description')='string'
 AND jsonb_typeof(document->'participantActorIds')='array' AND jsonb_array_length(document->'participantActorIds')>0
 AND jsonb_typeof(document->'placeIds')='array' AND jsonb_typeof(document->'sourceEventIds')='array'
 AND document->'resultIds'='[]'::jsonb AND document->'unresolvedResponsibilityIds'='[]'::jsonb
 AND ((document->>'status'='proposed' AND document->'revision'='0'::jsonb AND document->'sourceEventIds'='[]'::jsonb)
  OR (document->>'status'='active' AND (document->>'revision')::integer>0 AND jsonb_array_length(document->'sourceEventIds')>0))
);
DROP TRIGGER director_episode_immutable ON parallel_life.shared_episodes;
CREATE FUNCTION parallel_life.guard_agent_episode_progress() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source_id text; BEGIN
 IF (NEW.world_id,NEW.owner_id,NEW.id,NEW.origin_decision_id,NEW.created_at)
  IS DISTINCT FROM (OLD.world_id,OLD.owner_id,OLD.id,OLD.origin_decision_id,OLD.created_at)
  OR (NEW.document-ARRAY['revision','status','sourceEventIds']) IS DISTINCT FROM (OLD.document-ARRAY['revision','status','sourceEventIds'])
  OR (NEW.document->>'revision')::integer<>(OLD.document->>'revision')::integer+1
  OR NEW.document->>'status'<>'active'
  OR jsonb_array_length(NEW.document->'sourceEventIds')<>jsonb_array_length(OLD.document->'sourceEventIds')+1
  OR NOT(NEW.document->'sourceEventIds' @> OLD.document->'sourceEventIds')
 THEN RAISE EXCEPTION 'INVALID_EPISODE_PROGRESS' USING ERRCODE='23514'; END IF;
 SELECT v INTO source_id FROM jsonb_array_elements_text(NEW.document->'sourceEventIds') v
  WHERE NOT(OLD.document->'sourceEventIds' ? v);
 IF source_id IS NULL OR NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_receipts r
  WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.episode_id=NEW.id AND r.source_event_id=source_id
   AND r.attempt_id=current_setting('app.agent_commit_attempt_id',true) AND r.choice='engage'
   AND jsonb_array_length(r.presented_message_ids)>0)
 THEN RAISE EXCEPTION 'EPISODE_NOT_ACTUALLY_PRESENTED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_episode_progress_guard BEFORE UPDATE ON parallel_life.shared_episodes
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_agent_episode_progress();
REVOKE ALL ON FUNCTION parallel_life.guard_agent_narrative_admission(),parallel_life.guard_agent_episode_request(),
 parallel_life.guard_agent_episode_receipt(),parallel_life.guard_agent_episode_progress()
 FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
