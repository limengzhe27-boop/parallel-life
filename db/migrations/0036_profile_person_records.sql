-- Existing JSON profiles remain readable. New person evidence must be literal user speech.
CREATE FUNCTION parallel_life.validate_person_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE person jsonb; evidence jsonb; source_id text;
BEGIN
 FOR person IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.document->'people','[]'::jsonb)) LOOP
  FOR source_id IN SELECT jsonb_array_elements_text(COALESCE(person->'sourceMessageIds','[]'::jsonb)) LOOP
   IF NOT EXISTS(SELECT 1 FROM parallel_life.interview_messages m WHERE m.id::text=source_id AND m.owner_id=NEW.owner_id AND m.role='user') THEN
    RAISE EXCEPTION 'INVALID_PERSON_SOURCE' USING ERRCODE='23514';
   END IF;
  END LOOP;
  FOR evidence IN SELECT value FROM jsonb_array_elements(COALESCE(person->'sourceQuotes','[]'::jsonb)) LOOP
   IF NOT EXISTS(SELECT 1 FROM parallel_life.interview_messages m WHERE m.id::text=evidence->>'messageId' AND m.interview_id::text=evidence->>'interviewId' AND m.owner_id=NEW.owner_id AND m.role='user' AND length(evidence->>'quote')>0 AND position(evidence->>'quote' in m.text)>0) THEN
    RAISE EXCEPTION 'INVALID_PERSON_QUOTE' USING ERRCODE='23514';
   END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER profile_person_evidence BEFORE INSERT OR UPDATE OF document ON parallel_life.profiles FOR EACH ROW EXECUTE FUNCTION parallel_life.validate_person_evidence();
REVOKE ALL ON FUNCTION parallel_life.validate_person_evidence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.validate_person_evidence() TO pl_app,pl_worker;
CREATE TABLE parallel_life.profile_edit_receipts (
 owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 command_id uuid NOT NULL, request_hash text NOT NULL,
 response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,command_id)
);
ALTER TABLE parallel_life.profile_edit_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.profile_edit_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON parallel_life.profile_edit_receipts TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
REVOKE ALL ON parallel_life.profile_edit_receipts FROM PUBLIC,pl_worker;
GRANT SELECT,INSERT ON parallel_life.profile_edit_receipts TO pl_app;
CREATE TRIGGER profile_edit_receipt_immutable BEFORE UPDATE ON parallel_life.profile_edit_receipts FOR EACH ROW EXECUTE FUNCTION parallel_life.immutable_snapshot();
