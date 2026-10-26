-- Reuse the existing immutable authored-future revalidation receipt for a fully
-- received raw string rejected by an older parser. Unknown/truncation objects
-- and ordinary invalid output gain no direct transition or execution authority.
CREATE OR REPLACE FUNCTION parallel_life.guard_director_handoff_revalidation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE a record; w record; BEGIN
 SELECT * INTO w FROM parallel_life.worlds WHERE id=NEW.world_id AND owner_id=NEW.owner_id FOR UPDATE;
 SELECT * INTO a FROM parallel_life.director_runtime_attempts WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND id=NEW.attempt_id FOR UPDATE;
 IF w.id IS NULL OR a.id IS NULL OR NOT (a.status IN ('stale_discarded','response_received') OR
  (a.status='invalid_output' AND jsonb_typeof(a.response)='string' AND a.sent_at IS NOT NULL))
 OR a.response_hash IS NULL OR a.response_hash IS DISTINCT FROM NEW.response_hash OR a.input_hash IS DISTINCT FROM NEW.input_hash
 OR a.expected_world_version<>NEW.assessed_version OR w.version<>NEW.applied_version
 OR NEW.current_snapshot->>'worldId' IS DISTINCT FROM NEW.world_id
 OR NEW.current_snapshot->'worldVersion' IS DISTINCT FROM to_jsonb(NEW.applied_version)
 OR NEW.current_snapshot->'engineEpoch' IS DISTINCT FROM to_jsonb(a.engine_epoch)
 THEN RAISE EXCEPTION 'DIRECTOR_HANDOFF_REVALIDATION_CONFLICT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

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
 ((OLD.status='stale_discarded' OR (OLD.status='invalid_output' AND jsonb_typeof(OLD.response)='string' AND OLD.sent_at IS NOT NULL)) AND NEW.status='committed' AND OLD.response_hash IS NOT NULL
  AND current_setting('app.director_handoff_revalidation',true)=OLD.id
  AND EXISTS(SELECT 1 FROM parallel_life.director_handoff_revalidations r
   JOIN parallel_life.worlds w ON w.id=r.world_id AND w.owner_id=r.owner_id AND w.version=r.applied_version
   WHERE r.world_id=OLD.world_id AND r.owner_id=OLD.owner_id AND r.attempt_id=OLD.id
   AND r.response_hash=OLD.response_hash AND r.input_hash=OLD.input_hash AND r.assessed_version=OLD.expected_world_version)))
 THEN RAISE EXCEPTION 'INVALID_DIRECTOR_TRANSITION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
