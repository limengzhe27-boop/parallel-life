-- A database-resident scheduler must authenticate without a Vercel env change.
-- Only a SHA-256 hash is stored; the plaintext token lives in the pg_cron job.
CREATE TABLE IF NOT EXISTS parallel_life.cron_tokens (
  name text PRIMARY KEY,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON parallel_life.cron_tokens FROM PUBLIC;

CREATE OR REPLACE FUNCTION parallel_life.verify_cron_token(p_hash text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = parallel_life, pg_temp
AS $$
  SELECT EXISTS(SELECT 1 FROM parallel_life.cron_tokens WHERE token_hash = p_hash)
$$;
REVOKE ALL ON FUNCTION parallel_life.verify_cron_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.verify_cron_token(text) TO pl_app;
