-- Existing worlds must not be reset by the plan backfill. Their plan starts at world
-- creation, so every episode that already existed remains experience. The original
-- archive receives an explicit new-run cutover below; new worlds get now() on insert.
ALTER TABLE parallel_life.publication_story_plans DISABLE TRIGGER story_plan_immutable;
UPDATE parallel_life.publication_story_plans p
SET runtime_cutover_at=w.created_at
FROM parallel_life.worlds w
WHERE p.world_id=w.id AND p.owner_id=w.owner_id
  AND p.world_id <> '2fb97a4a-7282-4d75-8a5c-67faf44a3188'
  AND p.runtime_cutover_at > w.created_at;
ALTER TABLE parallel_life.publication_story_plans ENABLE TRIGGER story_plan_immutable;

-- The original archive starts a clean authored run while every old episode and receipt
-- remains immutable history. This is a one-time, explicitly scoped cutover.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT b.world_id,b.owner_id
    FROM parallel_life.publication_world_bindings b
    JOIN parallel_life.agent_runtime_worlds a
      ON a.world_id=b.world_id AND a.owner_id=b.owner_id AND a.engine_epoch>=2
    WHERE b.world_id='2fb97a4a-7282-4d75-8a5c-67faf44a3188'
  LOOP
    PERFORM parallel_life.ensure_agent_story_plan(r.world_id,r.owner_id);
  END LOOP;
END $$;
