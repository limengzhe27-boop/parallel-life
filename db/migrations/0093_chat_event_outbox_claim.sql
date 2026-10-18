-- One committed event may dispatch its own effects without waiting behind another life.
-- Same Outbox lease/attempt/finish and task idempotency lifecycle; unknown stays fenced.
CREATE FUNCTION parallel_life.claim_outbox_event_jobs(
 p_owner text,p_world text,p_event text,max_jobs integer,lease_seconds integer
) RETURNS SETOF parallel_life.outbox_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_owner IS NULL OR p_owner IS DISTINCT FROM current_setting('app.user_id',true)
   OR NOT pg_has_role(session_user,'pl_app','MEMBER')
   OR max_jobs IS NULL OR max_jobs<1 OR max_jobs>20 OR lease_seconds IS NULL OR lease_seconds<1 OR lease_seconds>300
   OR NOT EXISTS(SELECT 1 FROM parallel_life.world_events e WHERE e.id=p_event AND e.world_id=p_world AND e.owner_id=p_owner)
 THEN RETURN; END IF;
 RETURN QUERY UPDATE parallel_life.outbox_jobs job
 SET status='running',attempts=job.attempts+1,lease_until=now()+make_interval(secs=>lease_seconds),last_error=NULL
 WHERE job.id IN (
  SELECT pending.id FROM parallel_life.outbox_jobs pending
  WHERE pending.owner_id=p_owner AND pending.world_id=p_world AND pending.event_id=p_event
   AND (pending.status='queued' OR (pending.status='running' AND pending.lease_until<now()))
  ORDER BY pending.created_at,pending.id FOR UPDATE SKIP LOCKED LIMIT max_jobs
 ) RETURNING job.*;
END $$;
REVOKE ALL ON FUNCTION parallel_life.claim_outbox_event_jobs(text,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.claim_outbox_event_jobs(text,text,text,integer,integer) TO pl_app;
