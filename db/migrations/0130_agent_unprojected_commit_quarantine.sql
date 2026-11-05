-- A committed turn can advance actor state while its speech never reaches the
-- player because no world_messages row was projected. Such a turn is real
-- immutable history, but it cannot authenticate an own-agenda anchor or count
-- as a presentation. Record the exact affected attempts once, without deleting
-- or rewriting events, receipts, attempts or messages. The runtime still fails
-- closed for any unquarantined projection mismatch, so a new gap is surfaced.
CREATE TABLE parallel_life.agent_runtime_evidence_quarantine (
  world_id text NOT NULL,
  owner_id text NOT NULL,
  attempt_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('unprojected_committed_turn')),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, owner_id, attempt_id),
  FOREIGN KEY (world_id, owner_id) REFERENCES parallel_life.worlds(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (world_id, owner_id, attempt_id)
    REFERENCES parallel_life.agent_attempts(world_id, owner_id, id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.agent_runtime_evidence_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_runtime_evidence_quarantine FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_runtime_evidence_quarantine
  FROM PUBLIC, pl_worker, pl_publisher, pl_publisher_login;
CREATE POLICY agent_evidence_quarantine_owner
  ON parallel_life.agent_runtime_evidence_quarantine TO pl_app
  USING (owner_id = current_setting('app.user_id', true));
GRANT SELECT ON parallel_life.agent_runtime_evidence_quarantine TO pl_app;
CREATE TRIGGER agent_evidence_quarantine_immutable
  BEFORE UPDATE OR DELETE ON parallel_life.agent_runtime_evidence_quarantine
  FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();

-- Snapshot the existing mismatches exactly once. A future mismatch remains
-- visible to the fail-closed validator until an operator records another
-- audited quarantine row.
INSERT INTO parallel_life.agent_runtime_evidence_quarantine(
  world_id, owner_id, attempt_id, reason, evidence
)
SELECT a.world_id, a.owner_id, a.id, 'unprojected_committed_turn',
  jsonb_build_object(
    'eventId', a.event_id,
    'eventVersion', e.version,
    'statementCount', jsonb_array_length(e.payload#>'{data,agentRuntime,proposal,statements}'),
    'projectionCount', (
      SELECT count(*)
      FROM jsonb_array_elements(e.payload#>'{data,effects}') effect
      JOIN parallel_life.world_messages m
        ON m.world_id = e.world_id AND m.owner_id = e.owner_id
       AND m.id::text = effect->>'id'
      WHERE effect->>'type' = 'message.received'
        AND effect->>'actorId' = a.actor_id
        AND m.actor_id = a.actor_id
        AND m.document->>'sourceEventId' = e.id::text
        AND parallel_life.retire_text_sticker(effect)->>'text'
          = parallel_life.retire_text_sticker(m.document)->>'text'
    )
  )
FROM parallel_life.agent_attempts a
JOIN parallel_life.agent_input_receipts i
  ON i.world_id = a.world_id AND i.owner_id = a.owner_id AND i.id = a.input_receipt_id
JOIN parallel_life.world_events e
  ON e.world_id = a.world_id AND e.owner_id = a.owner_id AND e.id = a.event_id
WHERE a.status = 'committed'
  AND a.engine_epoch >= 2
  AND i.document->>'channel' = 'private'
  AND e.payload->>'type' = 'turn.resolved'
  AND jsonb_typeof(e.payload#>'{data,agentRuntime,proposal,statements}') = 'array'
  AND jsonb_array_length(e.payload#>'{data,agentRuntime,proposal,statements}') > 0
  AND (
    SELECT count(*)
    FROM jsonb_array_elements(e.payload#>'{data,effects}') effect
    JOIN parallel_life.world_messages m
      ON m.world_id = e.world_id AND m.owner_id = e.owner_id
     AND m.id::text = effect->>'id'
    WHERE effect->>'type' = 'message.received'
      AND effect->>'actorId' = a.actor_id
      AND m.actor_id = a.actor_id
      AND m.document->>'sourceEventId' = e.id::text
      AND parallel_life.retire_text_sticker(effect)->>'text'
        = parallel_life.retire_text_sticker(m.document)->>'text'
  ) <> jsonb_array_length(e.payload#>'{data,agentRuntime,proposal,statements}')
ON CONFLICT DO NOTHING;
