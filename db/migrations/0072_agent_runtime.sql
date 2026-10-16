-- Durable NPC state and model attempts. No worker-wide access; leased adapters are added separately.
CREATE TABLE parallel_life.agent_runtime_worlds (
 world_id text PRIMARY KEY, owner_id text NOT NULL, engine_epoch integer NOT NULL DEFAULT 1 CHECK(engine_epoch>=1),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE parallel_life.actor_agent_states (
 world_id text NOT NULL, owner_id text NOT NULL, actor_id text NOT NULL,
 revision integer NOT NULL CHECK(revision>=0), projected_world_version integer NOT NULL CHECK(projected_world_version>=0),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=262144),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(world_id,actor_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 CHECK(document ?& ARRAY['worldId','actorId','schemaVersion','revision','projectedWorldVersion'] AND (document->>'worldId') IS NOT DISTINCT FROM world_id AND (document->>'actorId') IS NOT DISTINCT FROM actor_id AND (document->'schemaVersion') IS NOT DISTINCT FROM '1'::jsonb
   AND (document->'revision') IS NOT DISTINCT FROM to_jsonb(revision) AND (document->'projectedWorldVersion') IS NOT DISTINCT FROM to_jsonb(projected_world_version))
);
CREATE TABLE parallel_life.agent_input_receipts (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, command_id text NOT NULL,
 input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(world_id,command_id), UNIQUE(world_id,id,owner_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 CHECK(document ?& ARRAY['worldId','id','commandId','inputHash'] AND (document->>'worldId') IS NOT DISTINCT FROM world_id AND (document->>'id') IS NOT DISTINCT FROM id AND (document->>'commandId') IS NOT DISTINCT FROM command_id AND (document->>'inputHash') IS NOT DISTINCT FROM input_hash)
);
CREATE TABLE parallel_life.agent_attempts (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, actor_id text NOT NULL, command_id text NOT NULL,
 input_receipt_id text NOT NULL, input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 engine_epoch integer NOT NULL CHECK(engine_epoch>=1), expected_world_version integer NOT NULL CHECK(expected_world_version>=0),
 expected_actor_revision integer NOT NULL CHECK(expected_actor_revision>=0), token text NOT NULL, lease_until timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('reserved','request_sent','response_received','invalid_output','stale_discarded','committed','cancelled_before_send','unknown_after_send')),
 response jsonb CHECK(response IS NULL OR octet_length(response::text)<=2097152), response_hash text CHECK(response_hash ~ '^[0-9a-f]{64}$'),
 sent_at timestamptz, event_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(world_id,command_id), UNIQUE(world_id,id,owner_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,input_receipt_id,owner_id) REFERENCES parallel_life.agent_input_receipts(world_id,id,owner_id),
 FOREIGN KEY(world_id,event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id),
 CHECK((status='committed')=(event_id IS NOT NULL)), CHECK((response IS NULL)=(response_hash IS NULL))
);
CREATE UNIQUE INDEX agent_attempt_one_active_actor ON parallel_life.agent_attempts(world_id,actor_id)
 WHERE status IN ('reserved','request_sent','response_received','unknown_after_send');
CREATE TABLE parallel_life.agent_action_results (
 world_id text NOT NULL, owner_id text NOT NULL, actor_id text NOT NULL, id text NOT NULL, action_id text NOT NULL,
 source_event_id text NOT NULL, world_version integer NOT NULL CHECK(world_version>=1), document jsonb NOT NULL,
 PRIMARY KEY(world_id,id), UNIQUE(world_id,actor_id,action_id),
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id),
 CHECK(document ?& ARRAY['worldId','actorId','id','actionId','eventId','worldVersion'] AND jsonb_typeof(document)='object' AND octet_length(document::text)<=32768
   AND (document->>'worldId') IS NOT DISTINCT FROM world_id AND (document->>'actorId') IS NOT DISTINCT FROM actor_id AND (document->>'id') IS NOT DISTINCT FROM id
   AND (document->>'actionId') IS NOT DISTINCT FROM action_id AND (document->>'eventId') IS NOT DISTINCT FROM source_event_id AND (document->'worldVersion') IS NOT DISTINCT FROM to_jsonb(world_version))
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['agent_runtime_worlds','actor_agent_states','agent_input_receipts','agent_attempts','agent_action_results'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON parallel_life.%I FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login',t);
  EXECUTE format('CREATE POLICY agent_owner ON parallel_life.%I TO pl_app USING(owner_id=current_setting(''app.user_id'',true)) WITH CHECK(owner_id=current_setting(''app.user_id'',true))',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON parallel_life.%I TO pl_app',t);
 END LOOP;
END $$;
-- Input and action-result provenance is immutable. A retry cannot replace accepted text or executed evidence.
CREATE FUNCTION parallel_life.agent_runtime_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_AGENT_RECORD' USING ERRCODE='23514'; END $$;
CREATE TRIGGER agent_input_immutable BEFORE UPDATE ON parallel_life.agent_input_receipts FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();
CREATE TRIGGER agent_result_immutable BEFORE UPDATE ON parallel_life.agent_action_results FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();
REVOKE UPDATE ON parallel_life.agent_input_receipts,parallel_life.agent_action_results FROM pl_app;
CREATE FUNCTION parallel_life.agent_epoch_monotonic() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM parallel_life.worlds WHERE id=OLD.world_id AND owner_id=OLD.owner_id FOR UPDATE;
 IF NEW.world_id IS DISTINCT FROM OLD.world_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.engine_epoch<>OLD.engine_epoch+1
 THEN RAISE EXCEPTION 'ENGINE_EPOCH_CONFLICT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_epoch_monotonic BEFORE UPDATE ON parallel_life.agent_runtime_worlds FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_epoch_monotonic();
-- All existing final-world writers encounter this fence. Epoch1 is intentionally unchanged.
-- SECURITY DEFINER permits the guard to inspect control rows even for narrowly leased workers.
CREATE FUNCTION parallel_life.guard_agent_world_epoch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e integer; BEGIN
 SELECT engine_epoch INTO e FROM parallel_life.agent_runtime_worlds WHERE world_id=OLD.id AND owner_id=OLD.owner_id;
 IF COALESCE(e,1)>=2 AND (current_setting('app.agent_engine_epoch',true) IS DISTINCT FROM e::text
   OR current_setting('app.agent_world_id',true) IS DISTINCT FROM OLD.id)
 THEN RAISE EXCEPTION 'ENGINE_EPOCH_CONFLICT' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_world_epoch_fence BEFORE UPDATE OR DELETE ON parallel_life.worlds FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_agent_world_epoch();
REVOKE ALL ON FUNCTION parallel_life.agent_runtime_immutable(),parallel_life.agent_epoch_monotonic(),parallel_life.guard_agent_world_epoch() FROM PUBLIC;
