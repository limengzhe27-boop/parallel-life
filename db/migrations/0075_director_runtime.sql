-- One protected director call/decision boundary. No worker grants or invented world events.
CREATE TABLE parallel_life.director_runtime_attempts (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, command_id text NOT NULL,
 engine_epoch integer NOT NULL CHECK(engine_epoch>=2), expected_world_version integer NOT NULL CHECK(expected_world_version>=0),
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), token text NOT NULL, lease_until timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('reserved','request_sent','response_received','invalid_output','stale_discarded','committed','cancelled_before_send','unknown_after_send')),
 snapshot jsonb NOT NULL, response jsonb, response_hash text CHECK(response_hash ~ '^[a-f0-9]{64}$'),
 sent_at timestamptz, decision_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(world_id,command_id), UNIQUE(world_id,id,owner_id),
 UNIQUE(world_id,id,owner_id,engine_epoch,expected_world_version,input_hash),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=2097152
   AND snapshot ?& ARRAY['schemaVersion','worldId','engineEpoch','worldVersion','observedThroughVersion','evaluatedThroughVersion']
   AND snapshot->'schemaVersion'='1'::jsonb AND (snapshot->>'worldId') IS NOT DISTINCT FROM world_id
   AND (snapshot->'engineEpoch') IS NOT DISTINCT FROM to_jsonb(engine_epoch)
   AND (snapshot->'worldVersion') IS NOT DISTINCT FROM to_jsonb(expected_world_version)
   AND jsonb_typeof(snapshot->'observedThroughVersion')='number' AND jsonb_typeof(snapshot->'evaluatedThroughVersion')='number'
   AND (snapshot->>'evaluatedThroughVersion')::integer>=0
   AND (snapshot->>'observedThroughVersion')::integer BETWEEN (snapshot->>'evaluatedThroughVersion')::integer AND expected_world_version),
 CHECK((response IS NULL)=(response_hash IS NULL)), CHECK(response IS NULL OR octet_length(response::text)<=2097152),
 CHECK((status='committed')=(decision_id IS NOT NULL)),
 CHECK(status NOT IN ('response_received','invalid_output','committed') OR (response_hash IS NOT NULL AND sent_at IS NOT NULL)),
 CHECK(status NOT IN ('request_sent','unknown_after_send') OR sent_at IS NOT NULL)
);
CREATE UNIQUE INDEX director_one_pending_world ON parallel_life.director_runtime_attempts(world_id)
 WHERE status IN ('reserved','request_sent','response_received','unknown_after_send');
CREATE TABLE parallel_life.director_decisions (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, attempt_id text NOT NULL,
 engine_epoch integer NOT NULL CHECK(engine_epoch>=2), world_version integer NOT NULL CHECK(world_version>=0),
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), evaluated_through_version integer NOT NULL CHECK(evaluated_through_version BETWEEN 0 AND world_version),
 document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(world_id,id,owner_id), UNIQUE(world_id,attempt_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,attempt_id,owner_id,engine_epoch,world_version,input_hash)
   REFERENCES parallel_life.director_runtime_attempts(world_id,id,owner_id,engine_epoch,expected_world_version,input_hash),
 CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=1048576
   AND document ?& ARRAY['schemaVersion','id','worldId','engineEpoch','worldVersion','inputHash','evaluatedThroughVersion','mode','selectedCandidateIds','deferred','nudges','opportunities','audit']
   AND document - ARRAY['schemaVersion','id','worldId','engineEpoch','worldVersion','inputHash','evaluatedThroughVersion','mode','selectedCandidateIds','deferred','nudges','opportunities','audit']='{}'::jsonb
   AND document->'schemaVersion'='1'::jsonb AND (document->>'id') IS NOT DISTINCT FROM id AND (document->>'worldId') IS NOT DISTINCT FROM world_id
   AND (document->'engineEpoch') IS NOT DISTINCT FROM to_jsonb(engine_epoch) AND (document->'worldVersion') IS NOT DISTINCT FROM to_jsonb(world_version)
   AND (document->>'inputHash') IS NOT DISTINCT FROM input_hash AND (document->'evaluatedThroughVersion') IS NOT DISTINCT FROM to_jsonb(evaluated_through_version)
   AND document->>'mode' IN ('quiet','coordinate','bounded_opportunity')
   AND jsonb_typeof(document->'selectedCandidateIds')='array' AND jsonb_typeof(document->'deferred')='array'
   AND jsonb_typeof(document->'nudges')='array' AND jsonb_typeof(document->'opportunities')='array' AND jsonb_typeof(document->'audit')='object'
   AND (document->>'mode'<>'quiet' OR (document->'selectedCandidateIds'='[]'::jsonb AND document->'nudges'='[]'::jsonb AND document->'opportunities'='[]'::jsonb)))
);
ALTER TABLE parallel_life.director_runtime_attempts ADD CONSTRAINT director_attempt_decision
 FOREIGN KEY(world_id,decision_id,owner_id) REFERENCES parallel_life.director_decisions(world_id,id,owner_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE parallel_life.shared_episodes (
 world_id text NOT NULL, owner_id text NOT NULL, id text NOT NULL, origin_decision_id text NOT NULL,
 document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(world_id,id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,origin_decision_id,owner_id) REFERENCES parallel_life.director_decisions(world_id,id,owner_id),
 CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=65536
   AND document ?& ARRAY['schemaVersion','worldId','id','revision','origin','status','title','description','participantActorIds','placeIds','sourceEventIds','resultIds','unresolvedResponsibilityIds']
   AND document - ARRAY['schemaVersion','worldId','id','revision','origin','status','title','description','participantActorIds','placeIds','sourceEventIds','resultIds','unresolvedResponsibilityIds']='{}'::jsonb
   AND document->'schemaVersion'='1'::jsonb AND (document->>'worldId') IS NOT DISTINCT FROM world_id AND (document->>'id') IS NOT DISTINCT FROM id
   AND document->'revision'='0'::jsonb AND document->>'status'='proposed'
   AND document->'origin'=jsonb_build_object('kind','director','sourceId',origin_decision_id)
   AND jsonb_typeof(document->'title')='string' AND jsonb_typeof(document->'description')='string'
   AND jsonb_typeof(document->'participantActorIds')='array' AND jsonb_array_length(document->'participantActorIds')>0
   AND jsonb_typeof(document->'placeIds')='array' AND document->'sourceEventIds'='[]'::jsonb
   AND document->'resultIds'='[]'::jsonb AND document->'unresolvedResponsibilityIds'='[]'::jsonb)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['director_runtime_attempts','director_decisions','shared_episodes'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON parallel_life.%I FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login',t);
  EXECUTE format('CREATE POLICY director_owner ON parallel_life.%I TO pl_app USING(owner_id=current_setting(''app.user_id'',true)) WITH CHECK(owner_id=current_setting(''app.user_id'',true))',t);
  EXECUTE format('GRANT SELECT,INSERT ON parallel_life.%I TO pl_app',t);
 END LOOP;
END $$;
GRANT UPDATE ON parallel_life.director_runtime_attempts TO pl_app;
CREATE FUNCTION parallel_life.guard_director_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (NEW.id,NEW.world_id,NEW.owner_id,NEW.command_id,NEW.engine_epoch,NEW.expected_world_version,NEW.input_hash,NEW.token,NEW.lease_until,NEW.snapshot,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.world_id,OLD.owner_id,OLD.command_id,OLD.engine_epoch,OLD.expected_world_version,OLD.input_hash,OLD.token,OLD.lease_until,OLD.snapshot,OLD.created_at)
 THEN RAISE EXCEPTION 'IMMUTABLE_DIRECTOR_INPUT' USING ERRCODE='23514'; END IF;
 IF OLD.response_hash IS NOT NULL AND (NEW.response,NEW.response_hash) IS DISTINCT FROM (OLD.response,OLD.response_hash)
 THEN RAISE EXCEPTION 'IMMUTABLE_DIRECTOR_RESPONSE' USING ERRCODE='23514'; END IF;
 IF OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at
 THEN RAISE EXCEPTION 'IMMUTABLE_DIRECTOR_SEND' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NOT (
   (OLD.status='reserved' AND NEW.status IN ('request_sent','cancelled_before_send','stale_discarded')) OR
   (OLD.status='request_sent' AND NEW.status IN ('response_received','unknown_after_send','invalid_output','stale_discarded')) OR
   (OLD.status='response_received' AND NEW.status IN ('invalid_output','stale_discarded','committed')) OR
   (OLD.status='unknown_after_send' AND NEW.status IN ('response_received','invalid_output','stale_discarded')))
 THEN RAISE EXCEPTION 'INVALID_DIRECTOR_TRANSITION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER director_attempt_guard BEFORE UPDATE ON parallel_life.director_runtime_attempts FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_director_attempt();
CREATE TRIGGER director_decision_immutable BEFORE UPDATE ON parallel_life.director_decisions FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();
CREATE TRIGGER director_episode_immutable BEFORE UPDATE ON parallel_life.shared_episodes FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();
CREATE FUNCTION parallel_life.guard_director_episode_origin() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE opportunity jsonb; BEGIN
 SELECT o INTO opportunity FROM parallel_life.director_decisions d,
   LATERAL jsonb_array_elements(d.document->'opportunities') o
 WHERE d.world_id=NEW.world_id AND d.owner_id=NEW.owner_id AND d.id=NEW.origin_decision_id AND o->>'id'=NEW.id;
 IF opportunity IS NULL OR (NEW.document->'title',NEW.document->'description',NEW.document->'participantActorIds',NEW.document->'placeIds')
   IS DISTINCT FROM (opportunity->'title',opportunity->'description',opportunity->'participantActorIds',opportunity->'placeIds')
 THEN RAISE EXCEPTION 'INVALID_DIRECTOR_EPISODE_ORIGIN' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER director_episode_origin BEFORE INSERT ON parallel_life.shared_episodes FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_director_episode_origin();
REVOKE ALL ON FUNCTION parallel_life.guard_director_attempt() FROM PUBLIC;
REVOKE ALL ON FUNCTION parallel_life.guard_director_episode_origin() FROM PUBLIC;
