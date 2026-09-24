-- 0022_outbox_consumer.sql: the outbox was write-only, so media requests produced by
-- a turn never reached the task queue. This adds claiming/leasing for the consumer
-- plus the fields needed to report why a job did not run.
ALTER TABLE parallel_life.outbox_jobs
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0);
ALTER TABLE parallel_life.outbox_jobs ADD COLUMN lease_until timestamptz;
ALTER TABLE parallel_life.outbox_jobs
  ADD COLUMN last_error text CHECK(last_error IS NULL OR char_length(last_error) <= 200);
CREATE INDEX outbox_pending ON parallel_life.outbox_jobs(created_at) WHERE status = 'queued';
CREATE INDEX outbox_expired_lease ON parallel_life.outbox_jobs(lease_until) WHERE status = 'running';

-- Dispatch runs as the application role (the worker deliberately has no INSERT on
-- tasks). Claiming is owner-scoped so a session can only drain its own life.
CREATE FUNCTION parallel_life.claim_outbox_jobs(
  p_owner text,
  max_jobs integer,
  lease_seconds integer
) RETURNS SETOF parallel_life.outbox_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_owner IS NULL OR max_jobs < 1 OR max_jobs > 100 OR lease_seconds < 1 THEN
    RAISE EXCEPTION 'INVALID_CLAIM_ARGUMENT';
  END IF;
  RETURN QUERY
  UPDATE parallel_life.outbox_jobs job
     SET status = 'running',
         attempts = job.attempts + 1,
         lease_until = now() + make_interval(secs => lease_seconds),
         last_error = NULL
   WHERE job.id IN (
     SELECT pending.id
       FROM parallel_life.outbox_jobs pending
      WHERE pending.owner_id = p_owner
        AND (
          pending.status = 'queued'
          OR (pending.status = 'running' AND pending.lease_until < now())
        )
      ORDER BY pending.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT max_jobs
   )
  RETURNING job.*;
END $$;
REVOKE ALL ON FUNCTION parallel_life.claim_outbox_jobs(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.claim_outbox_jobs(text, integer, integer) TO pl_app;

-- Terminal marking is used by both roles: the dispatcher marks dispatched/failed,
-- and the media handler records an upstream-unknown result without ever retrying it.
CREATE FUNCTION parallel_life.finish_outbox_job(
  p_job text,
  p_status text,
  p_detail text DEFAULT NULL,
  p_task_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE updated integer;
BEGIN
  IF p_status NOT IN ('submitted','succeeded','failed','unknown','queued') THEN
    RAISE EXCEPTION 'INVALID_OUTBOX_STATUS';
  END IF;
  UPDATE parallel_life.outbox_jobs
     SET status = p_status,
         last_error = left(p_detail, 200),
         provider_task_id = COALESCE(p_task_id, provider_task_id),
         lease_until = NULL
   WHERE id = p_job;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated = 1;
END $$;
REVOKE ALL ON FUNCTION parallel_life.finish_outbox_job(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.finish_outbox_job(text, text, text, text) TO pl_app, pl_worker;
