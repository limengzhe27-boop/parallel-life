-- Explicit recovery of a known, protected completion. Never authorizes another model request.
CREATE TABLE parallel_life.agent_task_recoveries (
 owner_id text NOT NULL, command_id uuid NOT NULL, world_id text NOT NULL, task_id uuid NOT NULL,
 attempt_id text NOT NULL, input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 prior_token text NOT NULL, next_token text, prior_lease_until timestamptz NOT NULL, next_lease_until timestamptz,
 outcome text NOT NULL CHECK(outcome IN ('requeued','stale')), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,command_id),
 FOREIGN KEY(task_id,owner_id) REFERENCES parallel_life.tasks(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,attempt_id,owner_id) REFERENCES parallel_life.agent_attempts(world_id,id,owner_id) ON DELETE CASCADE,
 CHECK((outcome='requeued')=(next_token IS NOT NULL AND next_lease_until IS NOT NULL)),
 CHECK(outcome<>'requeued' OR (next_token<>prior_token AND next_lease_until>prior_lease_until))
);
CREATE UNIQUE INDEX agent_recovery_token ON parallel_life.agent_task_recoveries(world_id,attempt_id,next_token) WHERE next_token IS NOT NULL;
ALTER TABLE parallel_life.agent_task_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_task_recoveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_task_recoveries FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY agent_recovery_owner ON parallel_life.agent_task_recoveries TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT ON parallel_life.agent_task_recoveries TO pl_app;
CREATE TRIGGER agent_recovery_immutable BEFORE UPDATE ON parallel_life.agent_task_recoveries
 FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();

-- Tokens and execution leases are fenced independently from queue leases. A previous worker
-- cannot commit after explicit recovery; immutable accepted inputs and saved raw stay intact.
CREATE FUNCTION parallel_life.agent_attempt_identity_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF ROW(NEW.id,NEW.world_id,NEW.owner_id,NEW.actor_id,NEW.command_id,NEW.input_receipt_id,NEW.input_hash,
        NEW.engine_epoch,NEW.expected_world_version,NEW.expected_actor_revision,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.world_id,OLD.owner_id,OLD.actor_id,OLD.command_id,OLD.input_receipt_id,OLD.input_hash,
        OLD.engine_epoch,OLD.expected_world_version,OLD.expected_actor_revision,OLD.created_at)
 THEN RAISE EXCEPTION 'IMMUTABLE_AGENT_IDENTITY' USING ERRCODE='23514'; END IF;
 IF OLD.response_hash IS NOT NULL AND ROW(NEW.response_hash,NEW.response) IS DISTINCT FROM ROW(OLD.response_hash,OLD.response)
 THEN RAISE EXCEPTION 'IMMUTABLE_AGENT_RESPONSE' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.token,NEW.lease_until) IS DISTINCT FROM ROW(OLD.token,OLD.lease_until) THEN
  IF OLD.status<>'response_received' OR NEW.status<>OLD.status OR OLD.response_hash IS NULL
    OR NEW.lease_until<=clock_timestamp() OR NEW.lease_until>clock_timestamp()+interval '5 minutes'
    OR NOT EXISTS(SELECT 1 FROM parallel_life.agent_task_recoveries r
      WHERE r.owner_id=OLD.owner_id AND r.world_id=OLD.world_id AND r.attempt_id=OLD.id
      AND r.input_hash=OLD.input_hash AND r.prior_token=OLD.token AND r.next_token=NEW.token
      AND r.prior_lease_until=OLD.lease_until AND r.next_lease_until=NEW.lease_until AND r.outcome='requeued')
  THEN RAISE EXCEPTION 'AGENT_RECOVERY_REQUIRED' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_attempt_identity_fence BEFORE UPDATE ON parallel_life.agent_attempts
 FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_attempt_identity_fence();
REVOKE ALL ON FUNCTION parallel_life.agent_attempt_identity_fence() FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
