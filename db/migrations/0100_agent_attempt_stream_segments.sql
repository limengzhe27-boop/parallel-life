-- Incremental NPC message segment credentials and prefix-commit ledger for single-call streaming.
CREATE TABLE parallel_life.agent_attempt_stream_segments (
 world_id text NOT NULL,
 owner_id text NOT NULL,
 attempt_id text NOT NULL,
 command_id text NOT NULL,
 actor_id text NOT NULL,
 segment_index integer NOT NULL CHECK(segment_index>=0 AND segment_index<64),
 segment_id text NOT NULL,
 message_id text NOT NULL,
 unit_kind text NOT NULL CHECK(unit_kind IN ('independent_statement','dependent_statement')),
 text text NOT NULL CHECK(length(btrim(text))>0 AND length(text)<=12000),
 depends_on_action_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(depends_on_action_ids)='array'),
 requests_player_reply boolean NOT NULL DEFAULT false,
 question_for_responsibility_id text,
 status text NOT NULL CHECK(status IN ('persisted','committed','withheld_dependency','superseded_by_interrupt','aborted_error')),
 completion_status text NOT NULL DEFAULT 'streaming' CHECK(completion_status IN ('streaming','completed','partial_interrupted','superseded')),
 source_event_id text,
 source_version integer CHECK(source_version IS NULL OR source_version>0),
 user_message_id text,
 message_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,attempt_id,segment_index),
 UNIQUE(world_id,segment_id),
 UNIQUE(world_id,message_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,attempt_id,owner_id) REFERENCES parallel_life.agent_attempts(world_id,id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id) ON DELETE CASCADE,
 CHECK((status='committed')=(source_event_id IS NOT NULL AND source_version IS NOT NULL))
);
CREATE INDEX agent_attempt_stream_segments_command_idx
 ON parallel_life.agent_attempt_stream_segments(world_id,command_id,segment_index);
ALTER TABLE parallel_life.agent_attempt_stream_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_attempt_stream_segments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_attempt_stream_segments FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY agent_stream_segment_owner ON parallel_life.agent_attempt_stream_segments
 TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON parallel_life.agent_attempt_stream_segments TO pl_app;
