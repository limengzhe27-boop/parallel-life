-- Leased workers must declare the world engine epoch before a group reply can
-- update an epoch-2 world, but they cannot read the control table directly.
-- Expose only the integer epoch for one world; no rows or settings are returned.
CREATE OR REPLACE FUNCTION parallel_life.runtime_engine_epoch(w text, o text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT COALESCE((SELECT engine_epoch FROM parallel_life.agent_runtime_worlds
    WHERE world_id=w AND owner_id=o),1)
$$;
REVOKE ALL ON FUNCTION parallel_life.runtime_engine_epoch(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.runtime_engine_epoch(text,text) TO pl_app,pl_worker;
