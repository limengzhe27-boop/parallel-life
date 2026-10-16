-- Original identities survive confirmed pre-send cancellation. Never recycles a paid call.
CREATE TABLE parallel_life.agent_zero_send_recoveries (
 id uuid PRIMARY KEY, owner_id text NOT NULL, world_id text NOT NULL, attempt_id text NOT NULL,
 input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 prior_token text NOT NULL, next_token text NOT NULL,
 prior_lease_until timestamptz NOT NULL, next_lease_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(world_id,attempt_id,prior_token), UNIQUE(world_id,attempt_id,next_token),
 FOREIGN KEY(world_id,attempt_id,owner_id) REFERENCES parallel_life.agent_attempts(world_id,id,owner_id) ON DELETE CASCADE,
 CHECK(next_token<>prior_token AND next_lease_until>prior_lease_until)
);
ALTER TABLE parallel_life.agent_zero_send_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_zero_send_recoveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_zero_send_recoveries FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY agent_zero_send_owner ON parallel_life.agent_zero_send_recoveries TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT ON parallel_life.agent_zero_send_recoveries TO pl_app;
CREATE TRIGGER agent_zero_send_immutable BEFORE UPDATE ON parallel_life.agent_zero_send_recoveries
 FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();

-- Queue recovery is not a protected model completion.
CREATE TABLE parallel_life.agent_zero_send_task_requeues (
 owner_id text NOT NULL, command_id uuid NOT NULL, world_id text NOT NULL,
 task_id uuid NOT NULL, attempt_id text, input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 prior_token text, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,command_id),
 FOREIGN KEY(task_id,owner_id) REFERENCES parallel_life.tasks(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,attempt_id,owner_id) REFERENCES parallel_life.agent_attempts(world_id,id,owner_id) ON DELETE CASCADE,
 CHECK((attempt_id IS NULL)=(prior_token IS NULL))
);
ALTER TABLE parallel_life.agent_zero_send_task_requeues ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_zero_send_task_requeues FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_zero_send_task_requeues FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY agent_zero_send_task_owner ON parallel_life.agent_zero_send_task_requeues TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT ON parallel_life.agent_zero_send_task_requeues TO pl_app;
CREATE TRIGGER agent_zero_send_task_immutable BEFORE UPDATE ON parallel_life.agent_zero_send_task_requeues
 FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();

CREATE OR REPLACE FUNCTION parallel_life.agent_attempt_identity_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE zero_recovery boolean; BEGIN
 IF ROW(NEW.id,NEW.world_id,NEW.owner_id,NEW.actor_id,NEW.command_id,NEW.input_receipt_id,NEW.input_hash,
        NEW.engine_epoch,NEW.expected_world_version,NEW.expected_actor_revision,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.world_id,OLD.owner_id,OLD.actor_id,OLD.command_id,OLD.input_receipt_id,OLD.input_hash,
        OLD.engine_epoch,OLD.expected_world_version,OLD.expected_actor_revision,OLD.created_at)
 THEN RAISE EXCEPTION 'IMMUTABLE_AGENT_IDENTITY' USING ERRCODE='23514'; END IF;
 IF OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at
 THEN RAISE EXCEPTION 'IMMUTABLE_AGENT_SEND' USING ERRCODE='23514'; END IF;
 IF OLD.response_hash IS NOT NULL AND ROW(NEW.response_hash,NEW.response) IS DISTINCT FROM ROW(OLD.response_hash,OLD.response)
 THEN RAISE EXCEPTION 'IMMUTABLE_AGENT_RESPONSE' USING ERRCODE='23514'; END IF;
 zero_recovery := OLD.status='cancelled_before_send' AND NEW.status='reserved'
   AND OLD.sent_at IS NULL AND OLD.response_hash IS NULL AND OLD.response IS NULL AND OLD.event_id IS NULL
   AND NEW.sent_at IS NULL AND NEW.response_hash IS NULL AND NEW.response IS NULL AND NEW.event_id IS NULL
   AND NEW.token<>OLD.token AND NEW.lease_until>OLD.lease_until
   AND NEW.lease_until>clock_timestamp() AND NEW.lease_until<=clock_timestamp()+interval '5 minutes'
   AND EXISTS(SELECT 1 FROM parallel_life.agent_zero_send_recoveries r
     WHERE r.owner_id=OLD.owner_id AND r.world_id=OLD.world_id AND r.attempt_id=OLD.id
       AND r.input_hash=OLD.input_hash AND r.prior_token=OLD.token AND r.next_token=NEW.token
       AND r.prior_lease_until=OLD.lease_until AND r.next_lease_until=NEW.lease_until);
 IF NEW.status='reserved' AND OLD.status<>'reserved' AND NOT zero_recovery
 THEN RAISE EXCEPTION 'AGENT_ZERO_SEND_RECOVERY_REQUIRED' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.token,NEW.lease_until) IS DISTINCT FROM ROW(OLD.token,OLD.lease_until) AND NOT zero_recovery THEN
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
REVOKE ALL ON FUNCTION parallel_life.agent_attempt_identity_fence() FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
