-- Global queue access exists only through these audited, fixed-search-path functions.
CREATE FUNCTION parallel_life.claim_task(kinds text[]) RETURNS SETOF parallel_life.tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE picked uuid;
BEGIN
 UPDATE parallel_life.tasks SET status='unknown',error_code='UNKNOWN',updated_at=now() WHERE status='running' AND lease_until<clock_timestamp();
 SELECT id INTO picked FROM parallel_life.tasks WHERE status='queued' AND scope_kind=ANY(kinds) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF picked IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE parallel_life.tasks SET status='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',attempts=attempts+1,updated_at=now() WHERE id=picked RETURNING *;
END $$;
CREATE FUNCTION parallel_life.worker_owns(target_owner text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM parallel_life.tasks WHERE id::text=current_setting('app.task_id',true) AND lease_token::text=current_setting('app.lease_token',true) AND owner_id=target_owner AND status='running' AND lease_until>clock_timestamp())
$$;
CREATE FUNCTION parallel_life.renew_task(task uuid,token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE count integer;
BEGIN
 UPDATE parallel_life.tasks SET lease_until=clock_timestamp()+interval '120 seconds' WHERE id=task AND lease_token=token AND status='running' AND lease_until>clock_timestamp();GET DIAGNOSTICS count=ROW_COUNT;RETURN count=1;
END $$;
CREATE FUNCTION parallel_life.finish_task(task uuid,token uuid,outcome text,error text,result integer,model_name text,template text,duration integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE count integer;
BEGIN
 IF outcome NOT IN ('succeeded','failed','conflict','unknown','cancelled') THEN RAISE EXCEPTION 'INVALID_STATUS';END IF;
 UPDATE parallel_life.tasks SET status=outcome,error_code=error,result_version=result,model=left(model_name,100),prompt_version=left(template,100),duration_ms=duration,updated_at=now()
 WHERE id=task AND lease_token=token AND status='running' AND lease_until>clock_timestamp();GET DIAGNOSTICS count=ROW_COUNT;RETURN count=1;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','interviews','interview_messages','worlds','world_initial_snapshots','commands','world_events','world_messages','world_appointments','world_media_requests','outbox_jobs','assets'] LOOP
 EXECUTE format('CREATE POLICY leased_worker ON parallel_life.%I TO pl_worker USING (parallel_life.worker_owns(owner_id)) WITH CHECK (parallel_life.worker_owns(owner_id))',t);
 END LOOP;
END $$;
CREATE POLICY leased_worker ON parallel_life.tasks TO pl_worker USING(id::text=current_setting('app.task_id',true) AND parallel_life.worker_owns(owner_id));
GRANT SELECT,UPDATE ON parallel_life.tasks TO pl_worker;
GRANT SELECT,INSERT,UPDATE ON parallel_life.profiles,parallel_life.interviews,parallel_life.interview_messages,parallel_life.worlds,parallel_life.commands,parallel_life.world_events,parallel_life.world_messages,parallel_life.world_appointments,parallel_life.world_media_requests,parallel_life.outbox_jobs,parallel_life.assets TO pl_worker;
GRANT SELECT,INSERT ON parallel_life.world_initial_snapshots TO pl_worker;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA parallel_life TO pl_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA parallel_life FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.claim_task(text[]),parallel_life.worker_owns(text),parallel_life.renew_task(uuid,uuid),parallel_life.finish_task(uuid,uuid,text,text,integer,text,text,integer) TO pl_worker;
