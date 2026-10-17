-- 0089_account_auth.sql: Official accounts, credentials, and safe guest data merging.

CREATE TABLE parallel_life.account_credentials (
  account_id text PRIMARY KEY REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
  identifier text UNIQUE NOT NULL CHECK(length(identifier) BETWEEN 3 AND 64),
  password_hash text NOT NULL CHECK(length(password_hash) > 10),
  salt text NOT NULL CHECK(length(salt) > 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX account_credentials_identifier_idx ON parallel_life.account_credentials(identifier);

ALTER TABLE parallel_life.account_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.account_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY app_account_credentials ON parallel_life.account_credentials
  FOR ALL TO pl_app
  USING (true)
  WITH CHECK (true);

CREATE POLICY worker_account_credentials ON parallel_life.account_credentials
  FOR ALL TO pl_worker
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON parallel_life.account_credentials TO pl_app, pl_worker;

CREATE OR REPLACE FUNCTION parallel_life.register_account_credentials(
  p_account_id text,
  p_identifier text,
  p_password_hash text,
  p_salt text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,parallel_life AS $$
DECLARE
  v_norm_id text;
BEGIN
  IF p_account_id IS NULL OR p_identifier IS NULL OR p_password_hash IS NULL OR p_salt IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  v_norm_id := lower(trim(p_identifier));
  IF length(v_norm_id) < 3 OR length(v_norm_id) > 64 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
  END IF;

  -- Ensure accounts entry exists and is kind = 'account'
  INSERT INTO parallel_life.accounts(id, kind)
  VALUES (p_account_id, 'account')
  ON CONFLICT (id) DO UPDATE SET kind = 'account';

  -- Insert credentials
  INSERT INTO parallel_life.account_credentials(account_id, identifier, password_hash, salt)
  VALUES (p_account_id, v_norm_id, p_password_hash, p_salt);

  RETURN jsonb_build_object(
    'accountId', p_account_id,
    'identifier', v_norm_id,
    'kind', 'account'
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'CONFLICT' USING ERRCODE='P0001';
END $$;

CREATE OR REPLACE FUNCTION parallel_life.lookup_account_credential(
  p_identifier text
) RETURNS TABLE(
  account_id text,
  identifier text,
  password_hash text,
  salt text,
  kind text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,parallel_life AS $$
  SELECT c.account_id, c.identifier, c.password_hash, c.salt, a.kind
  FROM parallel_life.account_credentials c
  JOIN parallel_life.accounts a ON a.id = c.account_id
  WHERE c.identifier = lower(trim(p_identifier));
$$;

CREATE OR REPLACE FUNCTION parallel_life.merge_guest_into_account(
  p_guest_id text,
  p_target_account_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,parallel_life AS $$
DECLARE
  v_guest_exists boolean;
  v_target_exists boolean;
  v_guest_profile jsonb;
  v_target_profile jsonb;
  v_merged_doc jsonb;
  v_fact jsonb;
  v_person jsonb;
  v_tbl text;
BEGIN
  IF p_guest_id IS NULL OR p_target_account_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023';
  END IF;

  IF p_guest_id = p_target_account_id THEN
    RETURN jsonb_build_object('merged', false, 'reason', 'same_account');
  END IF;

  SELECT (kind = 'guest') INTO v_guest_exists
  FROM parallel_life.accounts
  WHERE id = p_guest_id;

  IF NOT coalesce(v_guest_exists, false) THEN
    RAISE EXCEPTION 'INVALID_STATE' USING ERRCODE='P0001';
  END IF;

  SELECT EXISTS(SELECT 1 FROM parallel_life.accounts WHERE id = p_target_account_id)
  INTO v_target_exists;

  IF NOT v_target_exists THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001';
  END IF;

  -- 1. Deduplicate & merge special single-row or constraint-bound tables
  -- Profiles
  SELECT document INTO v_guest_profile FROM parallel_life.profiles WHERE owner_id = p_guest_id;
  SELECT document INTO v_target_profile FROM parallel_life.profiles WHERE owner_id = p_target_account_id;

  IF v_guest_profile IS NOT NULL THEN
    IF v_target_profile IS NULL THEN
      UPDATE parallel_life.profiles SET owner_id = p_target_account_id WHERE owner_id = p_guest_id;
    ELSE
      v_merged_doc := v_target_profile;
      FOR v_fact IN SELECT jsonb_array_elements(coalesce(v_guest_profile->'facts', '[]'::jsonb))
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(v_target_profile->'facts', '[]'::jsonb)) x
          WHERE x->>'id' = v_fact->>'id'
        ) THEN
          v_merged_doc := jsonb_set(
            v_merged_doc,
            '{facts}',
            coalesce(v_merged_doc->'facts', '[]'::jsonb) || jsonb_build_array(v_fact)
          );
        END IF;
      END LOOP;

      FOR v_person IN SELECT jsonb_array_elements(coalesce(v_guest_profile->'people', '[]'::jsonb))
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(v_target_profile->'people', '[]'::jsonb)) x
          WHERE x->>'id' = v_person->>'id'
        ) THEN
          v_merged_doc := jsonb_set(
            v_merged_doc,
            '{people}',
            coalesce(v_merged_doc->'people', '[]'::jsonb) || jsonb_build_array(v_person)
          );
        END IF;
      END LOOP;

      UPDATE parallel_life.profiles
      SET document = v_merged_doc, updated_at = now()
      WHERE owner_id = p_target_account_id;

      DELETE FROM parallel_life.profiles WHERE owner_id = p_guest_id;
    END IF;
  END IF;

  -- Interviews
  IF EXISTS (SELECT 1 FROM parallel_life.interviews WHERE owner_id = p_target_account_id) THEN
    DELETE FROM parallel_life.interviews WHERE owner_id = p_guest_id;
  ELSE
    UPDATE parallel_life.interviews SET owner_id = p_target_account_id WHERE owner_id = p_guest_id;
  END IF;

  -- Discoveries
  IF EXISTS (SELECT 1 FROM parallel_life.discoveries WHERE owner_id = p_target_account_id) THEN
    DELETE FROM parallel_life.discoveries WHERE owner_id = p_guest_id;
  ELSE
    UPDATE parallel_life.discoveries SET owner_id = p_target_account_id WHERE owner_id = p_guest_id;
  END IF;

  -- Ephemeral / unneeded tables for guest
  DELETE FROM parallel_life.rate_limits WHERE owner_id = p_guest_id;
  DELETE FROM parallel_life.agent_task_recoveries WHERE owner_id = p_guest_id;
  DELETE FROM parallel_life.agent_zero_send_task_requeues WHERE owner_id = p_guest_id;

  -- 2. Dynamically transfer all remaining tables where owner_id = p_guest_id
  PERFORM set_config('session_replication_role', 'replica', true);

  FOR v_tbl IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'parallel_life'
      AND column_name = 'owner_id'
      AND table_name NOT IN (
        'profiles', 'interviews', 'discoveries', 'rate_limits',
        'agent_task_recoveries', 'agent_zero_send_task_requeues',
        'account_credentials', 'accounts'
      )
  LOOP
    BEGIN
      EXECUTE format('UPDATE parallel_life.%I SET owner_id = $1 WHERE owner_id = $2', v_tbl)
      USING p_target_account_id, p_guest_id;
    EXCEPTION WHEN unique_violation THEN
      -- If unique constraint conflicts with target, clean up guest duplicate row
      EXECUTE format('DELETE FROM parallel_life.%I WHERE owner_id = $1', v_tbl)
      USING p_guest_id;
    END;
  END LOOP;

  -- Keep state JSON documents in sync with the transferred owner_id on worlds
  UPDATE parallel_life.worlds
  SET state = jsonb_set(state, '{ownerId}', to_jsonb(p_target_account_id))
  WHERE owner_id = p_target_account_id AND state ? 'ownerId';

  PERFORM set_config('session_replication_role', 'origin', true);

  -- 3. Delete the guest account (cascades any leftover empty references)
  DELETE FROM parallel_life.accounts WHERE id = p_guest_id;

  RETURN jsonb_build_object(
    'merged', true,
    'guestId', p_guest_id,
    'targetAccountId', p_target_account_id
  );
END $$;

REVOKE ALL ON FUNCTION parallel_life.register_account_credentials(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION parallel_life.lookup_account_credential(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION parallel_life.merge_guest_into_account(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION parallel_life.register_account_credentials(text, text, text, text) TO pl_app, pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.lookup_account_credential(text) TO pl_app, pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.merge_guest_into_account(text, text) TO pl_app, pl_worker;
