-- 0010_memory_source_refs.sql: Independent evidence provenance verification table
CREATE TABLE parallel_life.memory_source_refs (
  memory_id text NOT NULL,
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK(source_type IN ('interview_message', 'world_message', 'world_event', 'profile_edit', 'conversation_summary')),
  source_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_id, source_id),
  FOREIGN KEY (memory_id, owner_id) REFERENCES parallel_life.memory_records(id, owner_id) ON DELETE CASCADE
);

CREATE FUNCTION parallel_life.validate_memory_source_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,parallel_life AS $$
DECLARE source_owner text;
BEGIN
  IF NEW.source_type='interview_message' THEN
    SELECT owner_id INTO source_owner FROM parallel_life.interview_messages WHERE id::text=NEW.source_id;
  ELSIF NEW.source_type='world_message' THEN
    SELECT owner_id INTO source_owner FROM parallel_life.world_messages WHERE id=NEW.source_id;
  ELSIF NEW.source_type='world_event' THEN
    SELECT owner_id INTO source_owner FROM parallel_life.world_events WHERE id=NEW.source_id;
  END IF;
  IF NEW.source_type IN ('interview_message','world_message','world_event') AND source_owner IS NULL THEN
    RAISE EXCEPTION 'MEMORY_SOURCE_NOT_FOUND' USING ERRCODE='23503';
  END IF;
  IF source_owner IS NOT NULL AND source_owner<>NEW.owner_id THEN
    RAISE EXCEPTION 'MEMORY_SOURCE_OWNER_MISMATCH' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER memory_source_owner_check
  BEFORE INSERT OR UPDATE ON parallel_life.memory_source_refs
  FOR EACH ROW EXECUTE FUNCTION parallel_life.validate_memory_source_owner();

CREATE INDEX memory_source_refs_owner ON parallel_life.memory_source_refs(owner_id, source_id);

ALTER TABLE parallel_life.memory_source_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.memory_source_refs FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.memory_source_refs TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));

GRANT SELECT, INSERT, DELETE ON parallel_life.memory_source_refs TO pl_app;
GRANT SELECT, INSERT, DELETE ON parallel_life.memory_source_refs TO pl_worker;
REVOKE ALL ON parallel_life.memory_source_refs FROM PUBLIC;
CREATE POLICY leased_worker ON parallel_life.memory_source_refs TO pl_worker
  USING (parallel_life.worker_owns(owner_id))
  WITH CHECK (parallel_life.worker_owns(owner_id));
