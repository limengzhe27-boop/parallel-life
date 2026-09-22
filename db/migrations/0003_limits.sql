CREATE TABLE parallel_life.rate_limits(owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,bucket text NOT NULL,window_start timestamptz NOT NULL,count integer NOT NULL CHECK(count>0),PRIMARY KEY(owner_id,bucket));
ALTER TABLE parallel_life.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY own_rate ON parallel_life.rate_limits TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON parallel_life.rate_limits TO pl_app;
CREATE TABLE parallel_life.guest_limits(id integer PRIMARY KEY CHECK(id=1),window_start timestamptz NOT NULL,count integer NOT NULL);
CREATE FUNCTION parallel_life.reserve_guest() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE count_updated integer;
BEGIN
 INSERT INTO parallel_life.guest_limits(id,window_start,count) VALUES(1,date_trunc('hour',now()),1)
 ON CONFLICT(id) DO UPDATE SET count=CASE WHEN guest_limits.window_start<EXCLUDED.window_start THEN 1 ELSE guest_limits.count+1 END,window_start=EXCLUDED.window_start
 WHERE guest_limits.window_start<EXCLUDED.window_start OR guest_limits.count<60;
 GET DIAGNOSTICS count_updated=ROW_COUNT;RETURN count_updated=1;
END $$;
REVOKE ALL ON parallel_life.guest_limits FROM PUBLIC,pl_app,pl_worker;
REVOKE ALL ON FUNCTION parallel_life.reserve_guest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.reserve_guest() TO pl_app;
