-- 0023_memory_task_kind.sql: the memory handler was registered but no job could ever
-- be queued for it, because the task queue only allowed five scope kinds.
ALTER TABLE parallel_life.tasks DROP CONSTRAINT tasks_scope_kind_check;
ALTER TABLE parallel_life.tasks
  ADD CONSTRAINT tasks_scope_kind_check
  CHECK(scope_kind IN ('interview','profile','world-build','world','media','memory'));

-- The interview task runs as pl_worker and now writes memories, so the worker needs
-- EXECUTE on the helper the source_ids CHECK depends on. Without it every interview
-- commit fails with "permission denied for function is_jsonb_string_array".
GRANT EXECUTE ON FUNCTION parallel_life.is_jsonb_string_array(jsonb) TO pl_worker;
