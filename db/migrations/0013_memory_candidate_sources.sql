-- 0013_memory_candidate_sources.sql: every candidate source must be real and user-authored
CREATE FUNCTION parallel_life.validate_memory_candidate_messages() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,parallel_life AS $$
DECLARE source_id text;
BEGIN
  FOR source_id IN SELECT jsonb_array_elements_text(NEW.source_message_ids) LOOP
    IF NEW.source_type='interview' THEN
      IF NOT EXISTS (
        SELECT 1 FROM parallel_life.interview_messages
        WHERE id::text=source_id
          AND owner_id=NEW.owner_id
          AND interview_id::text=NEW.source_scope_id
          AND role='user'
      ) THEN
        RAISE EXCEPTION 'INVALID_MEMORY_INTERVIEW_SOURCE' USING ERRCODE='23514';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM parallel_life.world_messages
      WHERE id=source_id AND owner_id=NEW.owner_id AND world_id=NEW.source_scope_id
    ) THEN
      RAISE EXCEPTION 'INVALID_MEMORY_WORLD_SOURCE' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER memory_candidate_message_check
  BEFORE INSERT OR UPDATE ON parallel_life.memory_candidates
  FOR EACH ROW EXECUTE FUNCTION parallel_life.validate_memory_candidate_messages();
