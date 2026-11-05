-- A hidden tab can pause a continuous life after a long absence. This is a
-- reversible idle pause, distinct from an explicit manual pause; returning
-- clears only the idle reason and never rewrites earlier story time.
ALTER TABLE parallel_life.world_clock
  DROP CONSTRAINT world_clock_pause_reason_check,
  ADD CONSTRAINT world_clock_pause_reason_check
    CHECK (pause_reason IN ('legacy','manual','idle'));
