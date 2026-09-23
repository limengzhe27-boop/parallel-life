-- 0014_memory_candidate_event_date.sql: preserve event dates while events remain candidates
ALTER TABLE parallel_life.memory_candidates
  ADD COLUMN event_date text
  CHECK(event_date IS NULL OR event_date ~ '^\d{4}(-\d{2}(-\d{2})?)?$');
