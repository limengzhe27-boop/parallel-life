-- 0021_missing_indexes.sql: the queries behind the phone and the worker had no
-- supporting indexes (PostgreSQL does not index foreign keys automatically), so
-- reads grew linearly with data and RLS filtering had to scan.
CREATE INDEX world_appointments_by_world ON parallel_life.world_appointments(world_id);
CREATE INDEX world_media_requests_by_world ON parallel_life.world_media_requests(world_id);
CREATE INDEX outbox_jobs_by_world_status ON parallel_life.outbox_jobs(world_id, status);
CREATE INDEX outbox_jobs_by_status ON parallel_life.outbox_jobs(status) WHERE status IN ('queued','running');
CREATE INDEX assets_by_owner_status ON parallel_life.assets(owner_id, status);
CREATE INDEX world_builds_by_owner ON parallel_life.world_builds(owner_id, created_at DESC);
-- Scope lookups (latest task for a seed/world/interview) were scanning tasks,
-- whose partial index only covers queued work.
CREATE INDEX tasks_by_owner_scope ON parallel_life.tasks(owner_id, scope_kind, scope_id, created_at DESC);
