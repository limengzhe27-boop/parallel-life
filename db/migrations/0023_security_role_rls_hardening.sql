-- 0023_security_role_rls_hardening.sql: Enforce NOBYPASSRLS, revoke public function execute, and enforce RLS across all schema tables
DO $$
DECLARE
  r text;
  t text;
BEGIN
  -- 1. Ensure dedicated roles never bypass row level security (wrapped in exception block for managed cloud providers like Supabase)
  FOREACH r IN ARRAY ARRAY['pl_app', 'pl_worker'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      BEGIN
        EXECUTE format('ALTER ROLE %I NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE', r);
      EXCEPTION WHEN insufficient_privilege THEN
        -- Cloud databases (e.g. Supabase managed postgres) cannot alter roles due to supautils
        NULL;
      END;
    END IF;
  END LOOP;

  -- 2. Force row level security on every single table in parallel_life schema
  FOR t IN (
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'parallel_life' AND table_type = 'BASE TABLE'
  ) LOOP
    EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- 3. Lock down public access on all current schema functions and tables
REVOKE ALL ON ALL TABLES IN SCHEMA parallel_life FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA parallel_life FROM PUBLIC;
REVOKE ALL ON SCHEMA parallel_life FROM PUBLIC;
