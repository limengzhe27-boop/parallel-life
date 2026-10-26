-- Restricted background discovery only. Payloads and queue writes remain owner-scoped.
CREATE FUNCTION parallel_life.discover_due_outbox_scopes(
 p_limit integer DEFAULT 4,p_after_owner text DEFAULT NULL
) RETURNS TABLE(owner_id text,world_id text,event_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT pg_has_role(session_user,'pl_scheduler','MEMBER') THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>32
    OR (p_after_owner IS NOT NULL AND char_length(p_after_owner)>160) THEN
   RAISE EXCEPTION 'INVALID_OUTBOX_DISCOVERY_ARGUMENT' USING ERRCODE='22023';
 END IF;
 RETURN QUERY
 WITH scopes AS (
  SELECT j.owner_id,j.world_id,j.event_id,min(j.created_at) AS first_at
  FROM parallel_life.outbox_jobs j
  JOIN parallel_life.world_events e ON e.world_id=j.world_id AND e.owner_id=j.owner_id AND e.id=j.event_id
  JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
    AND c.status='succeeded' AND c.result_event_id=e.id
  WHERE j.status='queued' OR (j.status='running' AND j.lease_until<now())
  GROUP BY j.owner_id,j.world_id,j.event_id
 ), ranked AS (
  SELECT s.*,row_number() OVER(PARTITION BY s.owner_id ORDER BY s.first_at,s.world_id,s.event_id) AS owner_round
  FROM scopes s
 )
 SELECT r.owner_id,r.world_id,r.event_id FROM ranked r
 ORDER BY r.owner_round,
  CASE WHEN p_after_owner IS NOT NULL AND r.owner_id<=p_after_owner THEN 1 ELSE 0 END,
  r.owner_id,r.first_at,r.world_id,r.event_id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION parallel_life.discover_due_outbox_scopes(integer,text) FROM PUBLIC,pl_app,pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.discover_due_outbox_scopes(integer,text) TO pl_scheduler;
