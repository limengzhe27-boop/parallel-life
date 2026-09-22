-- PostgreSQL baseline. NOT applied automatically; use a new, dedicated database.
-- Migration owner != runtime role. Runtime permissions are granted explicitly on deploy.
BEGIN;
CREATE SCHEMA IF NOT EXISTS parallel_life;
REVOKE ALL ON SCHEMA parallel_life FROM PUBLIC;

CREATE TABLE parallel_life.accounts (
  id text PRIMARY KEY,
  auth_subject text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE parallel_life.profiles (
  owner_id text PRIMARY KEY REFERENCES parallel_life.accounts(id),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  schema_version integer NOT NULL DEFAULT 1,
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE parallel_life.worlds (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id),
  title text NOT NULL,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  schema_version integer NOT NULL DEFAULT 1,
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  parent_world_id text REFERENCES parallel_life.worlds(id),
  fork_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((parent_world_id IS NULL AND fork_version IS NULL) OR (parent_world_id IS NOT NULL AND fork_version >= 0)),
  CHECK (parent_world_id IS DISTINCT FROM id)
);
CREATE INDEX worlds_owner_idx ON parallel_life.worlds(owner_id, updated_at DESC);
CREATE TABLE parallel_life.world_events (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES parallel_life.worlds(id),
  version integer NOT NULL CHECK (version > 0),
  command_id text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (world_id, version),
  UNIQUE (world_id, command_id),
  UNIQUE (world_id, id)
);
CREATE TABLE parallel_life.commands (
  id text NOT NULL,
  world_id text NOT NULL REFERENCES parallel_life.worlds(id),
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id),
  expected_version integer NOT NULL CHECK (expected_version >= 0),
  request_hash text NOT NULL,
  request_payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'conflict', 'unknown')),
  result_event_id text,
  error_code text,
  lease_until timestamptz,
  lease_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, id),
  FOREIGN KEY (world_id, result_event_id) REFERENCES parallel_life.world_events(world_id, id),
  CHECK ((status = 'succeeded') = (result_event_id IS NOT NULL))
);
CREATE TABLE parallel_life.outbox_jobs (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES parallel_life.worlds(id),
  event_id text NOT NULL,
  job_type text NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'submitted', 'succeeded', 'failed', 'unknown')),
  provider_task_id text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (world_id, event_id) REFERENCES parallel_life.world_events(world_id, id)
);
CREATE INDEX outbox_pending_idx ON parallel_life.outbox_jobs(status, available_at);
CREATE TABLE parallel_life.assets (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES parallel_life.accounts(id),
  world_id text REFERENCES parallel_life.worlds(id),
  storage_key text UNIQUE NOT NULL,
  mime_type text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  origin text NOT NULL CHECK (origin IN ('upload', 'generated')),
  reference_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Defense in depth: each transaction sets SET LOCAL app.user_id from a verified session.
-- Never take this identity from request JSON or let a browser connect using the runtime role.
ALTER TABLE parallel_life.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY own_account ON parallel_life.accounts USING (id = current_setting('app.user_id', true)) WITH CHECK (id = current_setting('app.user_id', true));
ALTER TABLE parallel_life.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON parallel_life.profiles USING (owner_id = current_setting('app.user_id', true)) WITH CHECK (owner_id = current_setting('app.user_id', true));
ALTER TABLE parallel_life.worlds ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.worlds FORCE ROW LEVEL SECURITY;
CREATE POLICY own_world ON parallel_life.worlds USING (owner_id = current_setting('app.user_id', true)) WITH CHECK (owner_id = current_setting('app.user_id', true));
ALTER TABLE parallel_life.world_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.world_events FORCE ROW LEVEL SECURITY;
CREATE POLICY own_event ON parallel_life.world_events USING (EXISTS (SELECT 1 FROM parallel_life.worlds w WHERE w.id = world_id AND w.owner_id = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM parallel_life.worlds w WHERE w.id = world_id AND w.owner_id = current_setting('app.user_id', true)));
ALTER TABLE parallel_life.commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.commands FORCE ROW LEVEL SECURITY;
CREATE POLICY own_command ON parallel_life.commands USING (owner_id = current_setting('app.user_id', true) AND EXISTS (SELECT 1 FROM parallel_life.worlds w WHERE w.id = world_id AND w.owner_id = current_setting('app.user_id', true))) WITH CHECK (owner_id = current_setting('app.user_id', true) AND EXISTS (SELECT 1 FROM parallel_life.worlds w WHERE w.id = world_id AND w.owner_id = current_setting('app.user_id', true)));
ALTER TABLE parallel_life.outbox_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.outbox_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY own_job ON parallel_life.outbox_jobs USING (EXISTS (SELECT 1 FROM parallel_life.worlds w WHERE w.id = world_id AND w.owner_id = current_setting('app.user_id', true))) WITH CHECK (EXISTS (SELECT 1 FROM parallel_life.worlds w WHERE w.id = world_id AND w.owner_id = current_setting('app.user_id', true)));
ALTER TABLE parallel_life.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.assets FORCE ROW LEVEL SECURITY;
CREATE POLICY own_asset ON parallel_life.assets USING (owner_id = current_setting('app.user_id', true) AND (world_id IS NULL OR EXISTS (SELECT 1 FROM parallel_life.worlds w WHERE w.id = world_id AND w.owner_id = current_setting('app.user_id', true)))) WITH CHECK (owner_id = current_setting('app.user_id', true) AND (world_id IS NULL OR EXISTS (SELECT 1 FROM parallel_life.worlds w WHERE w.id = world_id AND w.owner_id = current_setting('app.user_id', true))));
REVOKE ALL ON ALL TABLES IN SCHEMA parallel_life FROM PUBLIC;
COMMIT;
