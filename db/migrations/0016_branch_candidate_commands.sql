-- 0016_branch_candidate_commands.sql: durable first-consent command for branch writeback
ALTER TABLE parallel_life.memory_command_receipts
  DROP CONSTRAINT memory_command_receipts_kind_check;
ALTER TABLE parallel_life.memory_command_receipts
  ADD CONSTRAINT memory_command_receipts_kind_check
  CHECK(kind IN ('interview_question','interview_question_block','memory_candidate','memory_branch_candidate'));
