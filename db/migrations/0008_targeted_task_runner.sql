-- HTTP runner may claim only the task already authorized by its caller's session.
CREATE FUNCTION parallel_life.claim_task_for_owner(target uuid, target_owner text, kinds text[])
RETURNS SETOF parallel_life.tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE picked uuid;
BEGIN
 UPDATE parallel_life.tasks SET status='unknown',error_code='UNKNOWN',updated_at=now()
 WHERE id=target AND owner_id=target_owner AND status='running' AND lease_until<clock_timestamp();
 SELECT id INTO picked FROM parallel_life.tasks
 WHERE id=target AND owner_id=target_owner AND status='queued' AND scope_kind=ANY(kinds)
 FOR UPDATE SKIP LOCKED;
 IF picked IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE parallel_life.tasks SET status='running',lease_token=gen_random_uuid(),
 lease_until=clock_timestamp()+interval '120 seconds',attempts=attempts+1,updated_at=now()
 WHERE id=picked RETURNING *;
END $$;
REVOKE ALL ON FUNCTION parallel_life.claim_task_for_owner(uuid,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.claim_task_for_owner(uuid,text,text[]) TO pl_worker;
