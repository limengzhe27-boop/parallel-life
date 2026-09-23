-- 0020_guest_limits_by_caller.sql: guest creation used to share one global counter,
-- so a single caller could exhaust the quota for everyone. Limit per caller and keep
-- a much wider global ceiling as a backstop.
CREATE TABLE parallel_life.guest_limits_by_key(
  key text PRIMARY KEY CHECK(char_length(key) BETWEEN 1 AND 64),
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK(count > 0)
);
-- No runtime role reads this table: it is only touched through the SECURITY DEFINER
-- function below, so an application bug cannot widen its own quota.
REVOKE ALL ON parallel_life.guest_limits_by_key FROM PUBLIC, pl_app, pl_worker;

CREATE FUNCTION parallel_life.reserve_guest_key(
  bucket text,
  per_key integer,
  ceiling integer,
  window_seconds integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  window_start timestamptz := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);
  key_updated integer;
  global_updated integer;
BEGIN
  IF bucket IS NULL OR char_length(bucket) NOT BETWEEN 1 AND 64
     OR per_key < 1 OR ceiling < 1 OR window_seconds < 1 THEN
    RAISE EXCEPTION 'INVALID_LIMIT_ARGUMENT';
  END IF;
  INSERT INTO parallel_life.guest_limits_by_key(key,window_start,count) VALUES(bucket,window_start,1)
  ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN guest_limits_by_key.window_start < EXCLUDED.window_start THEN 1 ELSE guest_limits_by_key.count + 1 END,
    window_start = EXCLUDED.window_start
  WHERE guest_limits_by_key.window_start < EXCLUDED.window_start OR guest_limits_by_key.count < per_key;
  GET DIAGNOSTICS key_updated = ROW_COUNT;
  IF key_updated <> 1 THEN RETURN false; END IF;

  INSERT INTO parallel_life.guest_limits(id,window_start,count) VALUES(1,window_start,1)
  ON CONFLICT(id) DO UPDATE SET
    count = CASE WHEN guest_limits.window_start < EXCLUDED.window_start THEN 1 ELSE guest_limits.count + 1 END,
    window_start = EXCLUDED.window_start
  WHERE guest_limits.window_start < EXCLUDED.window_start OR guest_limits.count < ceiling;
  GET DIAGNOSTICS global_updated = ROW_COUNT;
  IF global_updated <> 1 THEN
    -- The global ceiling stopped this caller: do not leave the per-caller slot consumed.
    UPDATE parallel_life.guest_limits_by_key SET count = count - 1 WHERE key = bucket AND count > 1;
    DELETE FROM parallel_life.guest_limits_by_key WHERE key = bucket AND count <= 1;
    RETURN false;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION parallel_life.reserve_guest_key(text,integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.reserve_guest_key(text,integer,integer,integer) TO pl_app;
