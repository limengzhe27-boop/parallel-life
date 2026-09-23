-- 0018_world_facts.sql: world facts move to their own projection so a long life
-- cannot push the world snapshot past its 256KB hard limit. Every fact ever
-- established stays queryable here; the in-memory state keeps a bounded window.
CREATE TABLE parallel_life.world_facts (
  id text PRIMARY KEY,
  world_id text NOT NULL,
  owner_id text NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal >= 0),
  document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX world_facts_by_world ON parallel_life.world_facts(world_id, ordinal);

ALTER TABLE parallel_life.world_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.world_facts TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));
CREATE POLICY leased_worker ON parallel_life.world_facts TO pl_worker
  USING(parallel_life.worker_owns(owner_id)) WITH CHECK(parallel_life.worker_owns(owner_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON parallel_life.world_facts TO pl_app;
GRANT SELECT,INSERT,UPDATE ON parallel_life.world_facts TO pl_worker;
REVOKE ALL ON parallel_life.world_facts FROM PUBLIC;

-- Backfill existing worlds so no fact depends on the snapshot any more.
INSERT INTO parallel_life.world_facts(id, world_id, owner_id, ordinal, document)
SELECT fact->>'id', world.id, world.owner_id, (position.ordinality - 1)::int, fact
FROM parallel_life.worlds world,
     jsonb_array_elements(COALESCE(world.state->'facts', '[]'::jsonb)) WITH ORDINALITY AS position(fact, ordinality)
WHERE fact->>'id' IS NOT NULL
ON CONFLICT (id) DO NOTHING;
