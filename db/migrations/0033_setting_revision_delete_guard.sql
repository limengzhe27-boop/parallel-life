-- A whole private draft may be removed with its owner, but an individual old
-- revision must not be deleted while its parent still exists (even by admin).
CREATE FUNCTION parallel_life.guard_setting_revision_delete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM parallel_life.setting_drafts WHERE id=OLD.draft_id AND owner_id=OLD.owner_id) THEN
  RAISE EXCEPTION 'SETTING_REVISION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER setting_revision_delete_guard BEFORE DELETE ON parallel_life.setting_draft_revisions
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_setting_revision_delete();
REVOKE ALL ON FUNCTION parallel_life.guard_setting_revision_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.guard_setting_revision_delete() TO pl_app;
