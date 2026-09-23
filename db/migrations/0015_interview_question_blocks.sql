-- 0015_interview_question_blocks.sql: explicit topic opt-outs for future interview questions
ALTER TABLE parallel_life.memory_command_receipts
  DROP CONSTRAINT memory_command_receipts_kind_check;
ALTER TABLE parallel_life.memory_command_receipts
  ADD CONSTRAINT memory_command_receipts_kind_check
  CHECK(kind IN ('interview_question','interview_question_block','memory_candidate'));

CREATE TABLE parallel_life.interview_question_blocks (
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
  interview_id uuid NOT NULL,
  target text NOT NULL CHECK(target IN ('identity','interest','personality','relationship','experience','wish')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,interview_id,target),
  FOREIGN KEY(interview_id,owner_id) REFERENCES parallel_life.interviews(id,owner_id) ON DELETE CASCADE
);

ALTER TABLE parallel_life.interview_question_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.interview_question_blocks FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.interview_question_blocks TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));
CREATE POLICY leased_worker ON parallel_life.interview_question_blocks TO pl_worker
  USING (parallel_life.worker_owns(owner_id))
  WITH CHECK (parallel_life.worker_owns(owner_id));
GRANT SELECT, INSERT ON parallel_life.interview_question_blocks TO pl_app, pl_worker;
REVOKE ALL ON parallel_life.interview_question_blocks FROM PUBLIC;
