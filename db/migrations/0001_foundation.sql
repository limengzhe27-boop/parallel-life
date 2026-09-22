-- Fresh dedicated database only. Applied by scripts/migrate.mjs within a transaction.
CREATE SCHEMA parallel_life;
REVOKE ALL ON SCHEMA parallel_life FROM PUBLIC;
CREATE TABLE parallel_life.accounts (
 id text PRIMARY KEY, kind text NOT NULL DEFAULT 'guest' CHECK(kind IN ('guest','account')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE parallel_life.profiles (
 id uuid PRIMARY KEY, owner_id text UNIQUE NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<262144),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,owner_id)
);
CREATE TABLE parallel_life.interviews (
 id uuid PRIMARY KEY, owner_id text UNIQUE NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,owner_id)
);
CREATE TABLE parallel_life.tasks (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 scope_kind text NOT NULL CHECK(scope_kind IN ('interview','profile','world-build','world','media')), scope_id text NOT NULL,
 command_id uuid NOT NULL, request_hash text NOT NULL, input jsonb NOT NULL CHECK(octet_length(input::text)<131072),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','conflict','unknown','cancelled')),
 lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 error_code text, result_version integer CHECK(result_version>=0), model text, prompt_version text, duration_ms integer,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,command_id), UNIQUE(id,owner_id),
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE UNIQUE INDEX one_active_task ON parallel_life.tasks(owner_id,scope_kind,scope_id) WHERE status IN ('queued','running');
CREATE INDEX pending_tasks ON parallel_life.tasks(created_at) WHERE status='queued';
CREATE TABLE parallel_life.interview_messages (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 interview_id uuid NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 role text NOT NULL CHECK(role IN ('user','assistant')), text text NOT NULL CHECK(length(text) BETWEEN 1 AND 8000),
 task_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(interview_id,owner_id) REFERENCES parallel_life.interviews(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(task_id,owner_id) REFERENCES parallel_life.tasks(id,owner_id), UNIQUE(task_id,role)
);
CREATE INDEX interview_message_order ON parallel_life.interview_messages(interview_id,ordinal);
CREATE TABLE parallel_life.worlds (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE,
 title text NOT NULL, version integer NOT NULL DEFAULT 0 CHECK(version>=0), asset_revision integer NOT NULL DEFAULT 0 CHECK(asset_revision>=0),
 state jsonb NOT NULL CHECK(jsonb_typeof(state)='object' AND octet_length(state::text)<262144),
 parent_world_id text, fork_version integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,owner_id), FOREIGN KEY(parent_world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id),
 CHECK((parent_world_id IS NULL AND fork_version IS NULL) OR (parent_world_id IS NOT NULL AND fork_version IS NOT NULL AND fork_version>=0)),
 CHECK(parent_world_id IS DISTINCT FROM id)
);
CREATE FUNCTION parallel_life.check_fork() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,parallel_life AS $$
BEGIN
 IF NEW.parent_world_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM parallel_life.worlds WHERE id=NEW.parent_world_id AND owner_id=NEW.owner_id AND version>=NEW.fork_version) THEN RAISE EXCEPTION 'INVALID_FORK' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER world_fork_check BEFORE INSERT OR UPDATE ON parallel_life.worlds FOR EACH ROW EXECUTE FUNCTION parallel_life.check_fork();
CREATE TABLE parallel_life.world_initial_snapshots (
 world_id text PRIMARY KEY, owner_id text NOT NULL, version integer NOT NULL DEFAULT 0 CHECK(version=0), state jsonb NOT NULL, approved_seed jsonb NOT NULL,
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE FUNCTION parallel_life.immutable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_SNAPSHOT' USING ERRCODE='23514'; END $$;
CREATE TRIGGER initial_snapshot_immutable BEFORE UPDATE ON parallel_life.world_initial_snapshots FOR EACH ROW EXECUTE FUNCTION parallel_life.immutable_snapshot();
CREATE TABLE parallel_life.commands (
 id text NOT NULL, world_id text NOT NULL, owner_id text NOT NULL, expected_version integer NOT NULL CHECK(expected_version>=0), request_hash text NOT NULL,
 request_payload jsonb NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','succeeded','failed','conflict','unknown','cancelled')),
 result_event_id text, result_state jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(world_id,id), UNIQUE(world_id,id,owner_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 CHECK((status='succeeded')=(result_event_id IS NOT NULL)), CHECK((status='succeeded')=(result_state IS NOT NULL))
);
CREATE TABLE parallel_life.world_events (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, version integer NOT NULL CHECK(version>0), command_id text NOT NULL,
 payload jsonb NOT NULL, occurred_at timestamptz NOT NULL,
 UNIQUE(world_id,version), UNIQUE(world_id,command_id), UNIQUE(world_id,command_id,id), UNIQUE(world_id,id,owner_id),
 FOREIGN KEY(world_id,command_id,owner_id) REFERENCES parallel_life.commands(world_id,id,owner_id) ON DELETE CASCADE
);
ALTER TABLE parallel_life.commands ADD CONSTRAINT command_same_event FOREIGN KEY(world_id,id,result_event_id) REFERENCES parallel_life.world_events(world_id,command_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE parallel_life.world_messages (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, actor_id text NOT NULL, document jsonb NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX world_messages_order ON parallel_life.world_messages(world_id,ordinal);
CREATE TABLE parallel_life.world_appointments (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, document jsonb NOT NULL,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','confirmed','cancelled')),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE parallel_life.world_media_requests (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, document jsonb NOT NULL,
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE
);
CREATE TABLE parallel_life.outbox_jobs (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, event_id text NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','submitted','succeeded','failed','unknown')),
 provider_task_id text, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(world_id,event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id) ON DELETE CASCADE
);
CREATE TABLE parallel_life.assets (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES parallel_life.accounts(id) ON DELETE CASCADE, world_id text,
 storage_key text UNIQUE NOT NULL, mime_type text NOT NULL, byte_length integer NOT NULL CHECK(byte_length>0 AND byte_length<=15728640),
 width integer NOT NULL CHECK(width>0), height integer NOT NULL CHECK(height>0), origin text NOT NULL CHECK(origin IN ('upload','generated')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), status text NOT NULL DEFAULT 'ready' CHECK(status IN ('processing','ready','failed','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id), UNIQUE(id,owner_id)
);
-- A future worker migration adds a narrowly scoped leased-task policy, never BYPASSRLS.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['accounts','profiles','interviews','tasks','interview_messages','worlds','world_initial_snapshots','commands','world_events','world_messages','world_appointments','world_media_requests','outbox_jobs','assets'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_access ON parallel_life.%I TO pl_app USING (%I = current_setting(''app.user_id'',true)) WITH CHECK (%I = current_setting(''app.user_id'',true))',t,CASE WHEN t='accounts' THEN 'id' ELSE 'owner_id' END,CASE WHEN t='accounts' THEN 'id' ELSE 'owner_id' END);
 END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA parallel_life FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA parallel_life FROM PUBLIC;
GRANT USAGE ON SCHEMA parallel_life TO pl_app,pl_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA parallel_life TO pl_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA parallel_life TO pl_app;
REVOKE UPDATE ON parallel_life.world_initial_snapshots FROM pl_app;
