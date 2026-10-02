ALTER TABLE parallel_life.approved_seeds
 ADD COLUMN setting_draft_id uuid,
 ADD COLUMN setting_draft_version integer,
 ADD CONSTRAINT setting_trial_revision FOREIGN KEY(setting_draft_id,owner_id,setting_draft_version)
 REFERENCES parallel_life.setting_draft_revisions(draft_id,owner_id,version) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT setting_trial_reference CHECK (
  (setting_draft_id IS NULL AND setting_draft_version IS NULL AND (document->'source'->>'kind' IS DISTINCT FROM 'setting_draft'))
  OR (setting_draft_id IS NOT NULL AND setting_draft_version IS NOT NULL AND
   (document->'source'->>'kind'='setting_draft'
    AND document->'source'->>'draftId'=setting_draft_id::text
    AND (document->'source'->>'version')::int=setting_draft_version) IS TRUE)
 );
