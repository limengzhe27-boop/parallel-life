-- Keep authored long-form character/world text intact. Playable-world and per-field
-- budgets are separate; JSONB renders with whitespace, so the DB allows headroom
-- over the 1 MiB UTF-8 application limit without becoming unbounded.
ALTER TABLE parallel_life.publication_draft_revisions
  DROP CONSTRAINT publication_draft_revisions_content_check,
  ADD CONSTRAINT publication_draft_revisions_content_check
    CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 1114112);

ALTER TABLE parallel_life.publication_versions
  DROP CONSTRAINT publication_versions_content_check,
  ADD CONSTRAINT publication_versions_content_check
    CHECK (jsonb_typeof(content) = 'object' AND octet_length(content::text) <= 1114112);

ALTER TABLE parallel_life.publication_receipts
  DROP CONSTRAINT publication_receipts_result_check,
  ADD CONSTRAINT publication_receipts_result_check
    CHECK (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 1179648);
