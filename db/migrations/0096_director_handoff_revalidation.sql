-- A received coordination proposal may be revalidated, never re-purchased, after
-- a concurrent player turn. Its assessed frame remains immutable; application
-- at a later frame has a separate receipt. No dialogue or world action is seeded.
CREATE TABLE parallel_life.director_handoff_revalidations (
 world_id text NOT NULL, owner_id text NOT NULL, attempt_id text NOT NULL,
 response_hash text NOT NULL CHECK(response_hash ~ '^[a-f0-9]{64}$'),
 assessed_version integer NOT NULL CHECK(assessed_version>=0),
 applied_version integer NOT NULL CHECK(applied_version>=assessed_version),
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 readset_hash text NOT NULL CHECK(readset_hash ~ '^[a-f0-9]{64}$'),
 current_snapshot jsonb NOT NULL CHECK(jsonb_typeof(current_snapshot)='object' AND octet_length(current_snapshot::text)<=2097152),
 opportunity_ids jsonb NOT NULL CHECK(jsonb_typeof(opportunity_ids)='array' AND jsonb_array_length(opportunity_ids) BETWEEN 1 AND 2),
 superseded_unknown_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(superseded_unknown_ids)='array'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(world_id,attempt_id),
 FOREIGN KEY(world_id,attempt_id,owner_id) REFERENCES parallel_life.director_runtime_attempts(world_id,id,owner_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.director_handoff_revalidations ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.director_handoff_revalidations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.director_handoff_revalidations FROM PUBLIC,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY handoff_owner ON parallel_life.director_handoff_revalidations TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT ON parallel_life.director_handoff_revalidations TO pl_app;
CREATE TRIGGER director_handoff_immutable BEFORE UPDATE ON parallel_life.director_handoff_revalidations
 FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();
CREATE FUNCTION parallel_life.guard_director_handoff_revalidation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a record; w record; BEGIN
 SELECT * INTO w FROM parallel_life.worlds WHERE id=NEW.world_id AND owner_id=NEW.owner_id FOR UPDATE;
 SELECT * INTO a FROM parallel_life.director_runtime_attempts WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND id=NEW.attempt_id FOR UPDATE;
 IF w.id IS NULL OR a.id IS NULL OR a.status NOT IN ('stale_discarded','response_received')
 OR a.response_hash IS NULL OR a.response_hash IS DISTINCT FROM NEW.response_hash OR a.input_hash IS DISTINCT FROM NEW.input_hash
 OR a.expected_world_version<>NEW.assessed_version OR w.version<>NEW.applied_version
 OR NEW.current_snapshot->>'worldId' IS DISTINCT FROM NEW.world_id
 OR NEW.current_snapshot->'worldVersion' IS DISTINCT FROM to_jsonb(NEW.applied_version)
 OR NEW.current_snapshot->'engineEpoch' IS DISTINCT FROM to_jsonb(a.engine_epoch)
 THEN RAISE EXCEPTION 'DIRECTOR_HANDOFF_REVALIDATION_CONFLICT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER director_handoff_guard BEFORE INSERT ON parallel_life.director_handoff_revalidations
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_director_handoff_revalidation();
REVOKE ALL ON FUNCTION parallel_life.guard_director_handoff_revalidation() FROM PUBLIC;
CREATE OR REPLACE FUNCTION parallel_life.guard_director_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
 (OLD.status='unknown_after_send' AND NEW.status IN ('response_received','invalid_output','stale_discarded')) OR
 (OLD.status='stale_discarded' AND NEW.status='committed' AND OLD.response_hash IS NOT NULL
  AND current_setting('app.director_handoff_revalidation',true)=OLD.id
  AND EXISTS(SELECT 1 FROM parallel_life.director_handoff_revalidations r
   JOIN parallel_life.worlds w ON w.id=r.world_id AND w.owner_id=r.owner_id AND w.version=r.applied_version
   WHERE r.world_id=OLD.world_id AND r.owner_id=OLD.owner_id AND r.attempt_id=OLD.id
   AND r.response_hash=OLD.response_hash AND r.input_hash=OLD.input_hash AND r.assessed_version=OLD.expected_world_version)))
 THEN RAISE EXCEPTION 'INVALID_DIRECTOR_TRANSITION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
