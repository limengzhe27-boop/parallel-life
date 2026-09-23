-- 0019_world_facts_document_limit.sql: a fact may be up to 4000 CJK characters,
-- which is ~12KB in UTF-8, so the original 8000-octet document limit was too
-- tight and rejected legitimate beliefs.
ALTER TABLE parallel_life.world_facts DROP CONSTRAINT world_facts_document_check;
ALTER TABLE parallel_life.world_facts
  ADD CONSTRAINT world_facts_document_check
  CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) < 32768);
