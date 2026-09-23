-- 0012_memory_command_receipts.sql: idempotent receipts for memory UI mutations
CREATE TABLE parallel_life.memory_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('interview_question','memory_candidate')),
  request_hash text NOT NULL CHECK(char_length(request_hash)=64),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, command_id)
);
CREATE INDEX memory_command_receipts_owner_created
  ON parallel_life.memory_command_receipts(owner_id, created_at DESC);

ALTER TABLE parallel_life.memory_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.memory_command_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.memory_command_receipts TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));
CREATE POLICY leased_worker ON parallel_life.memory_command_receipts TO pl_worker
  USING (parallel_life.worker_owns(owner_id))
  WITH CHECK (parallel_life.worker_owns(owner_id));
GRANT SELECT, INSERT ON parallel_life.memory_command_receipts TO pl_app, pl_worker;
REVOKE ALL ON parallel_life.memory_command_receipts FROM PUBLIC;
