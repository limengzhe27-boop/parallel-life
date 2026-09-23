-- 0011_interview_question_state.sql: Single open question state machine with DB-level constraint
ALTER TABLE parallel_life.interview_messages
  ADD CONSTRAINT interview_messages_id_owner_unique UNIQUE(id,owner_id);

CREATE TABLE parallel_life.interview_questions (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
  interview_id uuid NOT NULL,
  text text NOT NULL CHECK(char_length(text) BETWEEN 1 AND 2000),
  target text NOT NULL CHECK(target IN ('identity', 'interest', 'personality', 'relationship', 'experience', 'wish')),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'answered', 'skipped', 'dismissed')),
  source_message_id uuid NOT NULL,
  answer_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 0 CHECK(version>=0),
  CHECK((status='open')=(closed_at IS NULL)),
  CHECK((status='answered')=(answer_message_id IS NOT NULL)),
  FOREIGN KEY (interview_id,owner_id) REFERENCES parallel_life.interviews(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY (source_message_id,owner_id) REFERENCES parallel_life.interview_messages(id,owner_id),
  FOREIGN KEY (answer_message_id,owner_id) REFERENCES parallel_life.interview_messages(id,owner_id)
);

CREATE FUNCTION parallel_life.validate_interview_question_messages() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,parallel_life AS $$
DECLARE source_interview uuid; source_role text; answer_interview uuid; answer_role text;
BEGIN
  SELECT interview_id,role INTO source_interview,source_role
    FROM parallel_life.interview_messages WHERE id=NEW.source_message_id AND owner_id=NEW.owner_id;
  IF source_interview IS NULL OR source_interview<>NEW.interview_id OR source_role<>'user' THEN
    RAISE EXCEPTION 'INVALID_INTERVIEW_QUESTION_SOURCE' USING ERRCODE='23514';
  END IF;
  IF NEW.answer_message_id IS NOT NULL THEN
    SELECT interview_id,role INTO answer_interview,answer_role
      FROM parallel_life.interview_messages WHERE id=NEW.answer_message_id AND owner_id=NEW.owner_id;
    IF answer_interview IS NULL OR answer_interview<>NEW.interview_id OR answer_role<>'user' THEN
      RAISE EXCEPTION 'INVALID_INTERVIEW_QUESTION_ANSWER' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER interview_question_message_check
  BEFORE INSERT OR UPDATE ON parallel_life.interview_questions
  FOR EACH ROW EXECUTE FUNCTION parallel_life.validate_interview_question_messages();

-- 强制约束：每个 owner 任意时刻最多只能有 1 个处于 open 状态的问题！
CREATE UNIQUE INDEX interview_single_open_question_per_owner
  ON parallel_life.interview_questions(owner_id, interview_id)
  WHERE status = 'open';

CREATE INDEX interview_questions_owner_status ON parallel_life.interview_questions(owner_id, status);

ALTER TABLE parallel_life.interview_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.interview_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.interview_questions TO pl_app
  USING(owner_id = current_setting('app.user_id', true))
  WITH CHECK(owner_id = current_setting('app.user_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_life.interview_questions TO pl_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_life.interview_questions TO pl_worker;
REVOKE ALL ON parallel_life.interview_questions FROM PUBLIC;
CREATE POLICY leased_worker ON parallel_life.interview_questions TO pl_worker
  USING (parallel_life.worker_owns(owner_id))
  WITH CHECK (parallel_life.worker_owns(owner_id));
