-- Private, staff-bound AI proposals. Never publishes or changes a player's world.
CREATE TABLE parallel_life.publisher_preparations (
 principal_id uuid NOT NULL REFERENCES parallel_life.publisher_principals(id),
 command_id uuid NOT NULL,
 work_id uuid NOT NULL,
 draft_version bigint NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 material jsonb NOT NULL CHECK(jsonb_typeof(material)='object' AND octet_length(material::text)<=393216),
 status text NOT NULL CHECK(status IN ('running','succeeded','failed','unknown')),
 result jsonb CHECK(result IS NULL OR (jsonb_typeof(result)='object' AND octet_length(result::text)<=393216)),
 error_code text CHECK(error_code IN ('INVALID_RESPONSE','UPSTREAM_FAILED','TIMEOUT','UNAVAILABLE')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(principal_id,command_id),
 FOREIGN KEY(work_id,draft_version) REFERENCES parallel_life.publication_draft_revisions(work_id,version),
 CHECK((status='running' AND result IS NULL AND error_code IS NULL)
    OR (status='succeeded' AND result IS NOT NULL AND error_code IS NULL)
    OR (status IN ('failed','unknown') AND result IS NULL AND error_code IS NOT NULL))
);
CREATE INDEX publisher_preparations_latest ON parallel_life.publisher_preparations(principal_id,work_id,created_at DESC);
CREATE INDEX publisher_preparations_budget ON parallel_life.publisher_preparations(principal_id,created_at);
ALTER TABLE parallel_life.publisher_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.publisher_preparations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.publisher_preparations FROM PUBLIC,pl_app,pl_worker,pl_publisher;
GRANT SELECT,INSERT,UPDATE ON parallel_life.publisher_preparations TO pl_publisher;
CREATE POLICY publisher_preparation_read ON parallel_life.publisher_preparations FOR SELECT TO pl_publisher
 USING(principal_id::text=current_setting('publisher.principal_id',true) AND parallel_life.publisher_has_permission('view'));
CREATE POLICY publisher_preparation_insert ON parallel_life.publisher_preparations FOR INSERT TO pl_publisher
 WITH CHECK(principal_id::text=current_setting('publisher.principal_id',true) AND parallel_life.publisher_has_permission('edit'));
CREATE POLICY publisher_preparation_update ON parallel_life.publisher_preparations FOR UPDATE TO pl_publisher
 USING(principal_id::text=current_setting('publisher.principal_id',true) AND parallel_life.publisher_has_permission('edit'))
 WITH CHECK(principal_id::text=current_setting('publisher.principal_id',true) AND parallel_life.publisher_has_permission('edit'));
CREATE FUNCTION parallel_life.publisher_preparation_transition() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM parallel_life.publisher_lock_permission('edit');
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'running' THEN RAISE EXCEPTION 'PREPARATION_INVALID_INITIAL_STATE' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','result','error_code','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','result','error_code','updated_at'])
   OR OLD.status<>'running' OR NEW.status='running' THEN
   RAISE EXCEPTION 'PREPARATION_INVALID_TRANSITION' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER publisher_preparation_transition BEFORE INSERT OR UPDATE ON parallel_life.publisher_preparations
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publisher_preparation_transition();
REVOKE ALL ON FUNCTION parallel_life.publisher_preparation_transition() FROM PUBLIC;
