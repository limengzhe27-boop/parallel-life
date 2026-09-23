-- 0009_memory_records.sql: Unified scoped memory records for profile, branch, and character
-- PostgreSQL CHECK constraints cannot contain subqueries. Keep the JSON shape
-- check declarative by delegating the element walk to an immutable function;
-- cross-table provenance checks live in triggers below/0013.
CREATE FUNCTION parallel_life.is_jsonb_string_array(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,parallel_life AS $$
DECLARE item jsonb;
BEGIN
  IF jsonb_typeof(value) <> 'array' THEN RETURN false; END IF;
  FOR item IN SELECT element FROM jsonb_array_elements(value) AS elements(element) LOOP
    IF jsonb_typeof(item) <> 'string' THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE TABLE parallel_life.memory_records (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK(scope_type IN ('profile', 'branch', 'character')),
  scope_id text NOT NULL,
  branch_id text,
  character_id text,
  kind text NOT NULL CHECK(kind IN ('preference', 'commitment', 'belief', 'summary', 'correction', 'episode')),
  text text NOT NULL CHECK(char_length(text) BETWEEN 1 AND 4000),
  key text CHECK(key IS NULL OR char_length(key) <= 128),
  source_type text NOT NULL CHECK(source_type IN ('user_statement', 'world_event', 'agent_inference', 'user_correction', 'conversation_summary')),
  source_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(parallel_life.is_jsonb_string_array(source_ids)),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded', 'forgotten')),
  importance int NOT NULL DEFAULT 1 CHECK(importance BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, owner_id),
  FOREIGN KEY (branch_id, owner_id) REFERENCES parallel_life.worlds(id, owner_id) ON DELETE CASCADE,
  CHECK (
    (scope_type='profile' AND branch_id IS NULL AND character_id IS NULL)
    OR (scope_type='branch' AND branch_id IS NOT NULL AND branch_id=scope_id AND character_id IS NULL)
    OR (scope_type='character' AND branch_id IS NOT NULL AND character_id IS NOT NULL AND character_id=scope_id)
  )
);

CREATE FUNCTION parallel_life.validate_memory_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,parallel_life AS $$
BEGIN
  IF NEW.scope_type='profile' THEN
    IF NOT EXISTS (SELECT 1 FROM parallel_life.profiles WHERE id::text=NEW.scope_id AND owner_id=NEW.owner_id) THEN
      RAISE EXCEPTION 'INVALID_MEMORY_PROFILE_SCOPE' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.scope_type IN ('branch','character') THEN
    IF NOT EXISTS (SELECT 1 FROM parallel_life.worlds WHERE id=NEW.branch_id AND owner_id=NEW.owner_id) THEN
      RAISE EXCEPTION 'INVALID_MEMORY_BRANCH_SCOPE' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memory_scope_check
  BEFORE INSERT OR UPDATE ON parallel_life.memory_records
  FOR EACH ROW EXECUTE FUNCTION parallel_life.validate_memory_scope();

CREATE INDEX memory_records_owner_scope ON parallel_life.memory_records(owner_id, scope_type, scope_id, status);
CREATE INDEX memory_records_branch ON parallel_life.memory_records(branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX memory_records_key ON parallel_life.memory_records(owner_id, key) WHERE key IS NOT NULL;

ALTER TABLE parallel_life.memory_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.memory_records FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.memory_records TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_life.memory_records TO pl_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_life.memory_records TO pl_worker;
REVOKE ALL ON parallel_life.memory_records FROM PUBLIC;
CREATE POLICY leased_worker ON parallel_life.memory_records TO pl_worker
  USING (parallel_life.worker_owns(owner_id))
  WITH CHECK (parallel_life.worker_owns(owner_id));

CREATE TABLE parallel_life.memory_candidates (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK(source_type IN ('interview','branch')),
  source_scope_id text NOT NULL,
  category text NOT NULL CHECK(category IN ('identity','interest','personality','relationship','experience','wish')),
  text text NOT NULL CHECK(char_length(text) BETWEEN 1 AND 2000),
  source_message_ids jsonb NOT NULL CHECK(
    parallel_life.is_jsonb_string_array(source_message_ids)
    AND jsonb_array_length(source_message_ids)>0
  ),
  status text NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','confirmed','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CHECK((status='confirmed')=(confirmed_at IS NOT NULL)),
  UNIQUE(id, owner_id)
);
CREATE INDEX memory_candidates_owner_status ON parallel_life.memory_candidates(owner_id,status,created_at DESC);
CREATE FUNCTION parallel_life.validate_memory_candidate_source() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,parallel_life AS $$
BEGIN
  IF NEW.source_type='interview' THEN
    IF NOT EXISTS (SELECT 1 FROM parallel_life.interviews WHERE id::text=NEW.source_scope_id AND owner_id=NEW.owner_id) THEN
      RAISE EXCEPTION 'INVALID_MEMORY_INTERVIEW_SCOPE' USING ERRCODE='23514';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM parallel_life.worlds WHERE id=NEW.source_scope_id AND owner_id=NEW.owner_id) THEN
    RAISE EXCEPTION 'INVALID_MEMORY_BRANCH_SCOPE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memory_candidate_source_check
  BEFORE INSERT OR UPDATE ON parallel_life.memory_candidates
  FOR EACH ROW EXECUTE FUNCTION parallel_life.validate_memory_candidate_source();
ALTER TABLE parallel_life.memory_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.memory_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.memory_candidates TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));
CREATE POLICY leased_worker ON parallel_life.memory_candidates TO pl_worker
  USING (parallel_life.worker_owns(owner_id))
  WITH CHECK (parallel_life.worker_owns(owner_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_life.memory_candidates TO pl_app, pl_worker;
REVOKE ALL ON parallel_life.memory_candidates FROM PUBLIC;
