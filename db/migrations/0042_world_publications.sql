-- Independent staff workspace. No player worlds/profile/private drafts are changed.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pl_publisher') THEN
  CREATE ROLE pl_publisher NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pl_publisher' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
  RAISE EXCEPTION 'UNSAFE_PUBLISHER_ROLE';
 END IF;
END $$;
GRANT USAGE ON SCHEMA parallel_life TO pl_publisher;
CREATE TABLE parallel_life.publisher_principals (
 id uuid PRIMARY KEY, display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 80),
 can_edit boolean NOT NULL DEFAULT false, can_publish boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT false
);
CREATE FUNCTION parallel_life.publisher_has_permission(permission text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM parallel_life.publisher_principals WHERE id::text=current_setting('publisher.principal_id',true)
 AND active AND CASE permission WHEN 'view' THEN true WHEN 'edit' THEN can_edit WHEN 'publish' THEN can_publish WHEN 'review' THEN can_edit OR can_publish ELSE false END)
$$;
CREATE FUNCTION parallel_life.publisher_lock_permission(permission text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p parallel_life.publisher_principals;
BEGIN
 SELECT * INTO p FROM parallel_life.publisher_principals WHERE id::text=current_setting('publisher.principal_id',true) FOR SHARE;
 IF NOT FOUND OR NOT p.active OR NOT (CASE permission WHEN 'view' THEN true WHEN 'edit' THEN p.can_edit WHEN 'publish' THEN p.can_publish WHEN 'review' THEN p.can_edit OR p.can_publish ELSE false END) THEN
  RAISE EXCEPTION 'PUBLISHER_FORBIDDEN' USING ERRCODE='42501';
 END IF;
END $$;
CREATE TABLE parallel_life.publication_works (
 id uuid PRIMARY KEY, title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 80),
 created_by uuid NOT NULL REFERENCES parallel_life.publisher_principals(id),
 draft_version bigint NOT NULL DEFAULT 0 CHECK(draft_version BETWEEN 0 AND 9007199254740991),
 metadata_version bigint NOT NULL DEFAULT 0 CHECK(metadata_version BETWEEN 0 AND 9007199254740991),
 publication_version bigint CHECK(publication_version BETWEEN 1 AND 9007199254740991), listed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT listed OR publication_version IS NOT NULL)
);
CREATE TABLE parallel_life.publication_draft_revisions (
 work_id uuid NOT NULL REFERENCES parallel_life.publication_works(id), version bigint NOT NULL CHECK(version BETWEEN 0 AND 9007199254740991),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=98304),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'), created_by uuid NOT NULL REFERENCES parallel_life.publisher_principals(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(work_id,version), UNIQUE(work_id,version,content_hash)
);
ALTER TABLE parallel_life.publication_works ADD CONSTRAINT publication_current_draft FOREIGN KEY(id,draft_version)
 REFERENCES parallel_life.publication_draft_revisions(work_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE parallel_life.publication_checks (
 id uuid PRIMARY KEY, work_id uuid NOT NULL, draft_version bigint NOT NULL, content_hash text NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=32768),
 basis jsonb NOT NULL CHECK(jsonb_typeof(basis)='object' AND octet_length(basis::text)<=4096),
 created_by uuid NOT NULL REFERENCES parallel_life.publisher_principals(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(work_id,draft_version,content_hash) REFERENCES parallel_life.publication_draft_revisions(work_id,version,content_hash),
 UNIQUE(id,work_id,draft_version,content_hash)
);
CREATE TABLE parallel_life.publication_versions (
 work_id uuid NOT NULL, version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991), draft_version bigint NOT NULL,
 content_hash text NOT NULL, check_id uuid NOT NULL,
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND octet_length(content::text)<=98304),
 card jsonb NOT NULL CHECK(jsonb_typeof(card)='object' AND octet_length(card::text)<=8192
  AND card ?& ARRAY['title','hook','identityLabel','experienceNote','description']::text[]
  AND card - ARRAY['title','hook','identityLabel','experienceNote','description']::text[]='{}'::jsonb
  AND jsonb_typeof(card->'title')='string' AND length(card->>'title') BETWEEN 1 AND 80
  AND jsonb_typeof(card->'hook')='string' AND length(card->>'hook') BETWEEN 1 AND 180
  AND jsonb_typeof(card->'identityLabel')='string' AND length(card->>'identityLabel') BETWEEN 1 AND 300
  AND jsonb_typeof(card->'experienceNote')='string' AND length(card->>'experienceNote') BETWEEN 1 AND 300
  AND jsonb_typeof(card->'description')='string' AND length(card->>'description') BETWEEN 1 AND 1600),
 basis jsonb NOT NULL CHECK(jsonb_typeof(basis)='object' AND octet_length(basis::text)<=4096),
 created_by uuid NOT NULL REFERENCES parallel_life.publisher_principals(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(work_id,version), FOREIGN KEY(work_id,draft_version,content_hash) REFERENCES parallel_life.publication_draft_revisions(work_id,version,content_hash),
 FOREIGN KEY(check_id,work_id,draft_version,content_hash) REFERENCES parallel_life.publication_checks(id,work_id,draft_version,content_hash)
);
ALTER TABLE parallel_life.publication_works ADD CONSTRAINT publication_current_version FOREIGN KEY(id,publication_version)
 REFERENCES parallel_life.publication_versions(work_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE parallel_life.publication_receipts (
 principal_id uuid NOT NULL REFERENCES parallel_life.publisher_principals(id), command_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), operation text NOT NULL CHECK(operation IN ('create','save','check','publish','unpublish','restore')),
 work_id uuid NOT NULL REFERENCES parallel_life.publication_works(id), result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=131072),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(principal_id,command_id)
);
CREATE TABLE parallel_life.publisher_login_buckets (
 kind text NOT NULL CHECK(kind IN ('global','client','username')), bucket_hash text NOT NULL CHECK(bucket_hash ~ '^[a-f0-9]{64}$'),
 window_started_at timestamptz NOT NULL, attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 1000000), PRIMARY KEY(kind,bucket_hash)
);
CREATE INDEX publication_listed ON parallel_life.publication_works(id) WHERE listed;
CREATE INDEX publication_checks_revision ON parallel_life.publication_checks(work_id,draft_version,created_at);
CREATE INDEX publisher_login_expiry ON parallel_life.publisher_login_buckets(window_started_at);
CREATE FUNCTION parallel_life.publication_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'PUBLICATION_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE FUNCTION parallel_life.publication_work_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'PUBLICATION_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NEW.draft_version=OLD.draft_version+1 AND NEW.metadata_version=OLD.metadata_version AND NEW.publication_version IS NOT DISTINCT FROM OLD.publication_version AND NEW.listed=OLD.listed THEN
  PERFORM parallel_life.publisher_lock_permission('edit');
 ELSIF NEW.metadata_version=OLD.metadata_version+1 AND NEW.draft_version=OLD.draft_version AND NEW.title=OLD.title THEN
  PERFORM parallel_life.publisher_lock_permission('publish');
 ELSE RAISE EXCEPTION 'PUBLICATION_VERSION_CONFLICT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER publication_work_update BEFORE UPDATE ON parallel_life.publication_works FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_work_update();
CREATE FUNCTION parallel_life.publication_version_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d jsonb; c jsonb; b jsonb;
BEGIN
 SELECT content INTO d FROM parallel_life.publication_draft_revisions WHERE work_id=NEW.work_id AND version=NEW.draft_version AND content_hash=NEW.content_hash;
 SELECT document,basis INTO c,b FROM parallel_life.publication_checks WHERE id=NEW.check_id AND work_id=NEW.work_id AND draft_version=NEW.draft_version AND content_hash=NEW.content_hash;
 IF d IS NULL OR NEW.content IS DISTINCT FROM d OR c->>'status' IS DISTINCT FROM 'ready' OR NEW.basis IS DISTINCT FROM b THEN
  RAISE EXCEPTION 'PUBLICATION_CHECK_MISMATCH' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER publication_version_insert BEFORE INSERT ON parallel_life.publication_versions FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_version_insert();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['publisher_principals','publication_works','publication_draft_revisions','publication_checks','publication_versions','publication_receipts','publisher_login_buckets'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON parallel_life.%I FROM PUBLIC,pl_app,pl_worker,pl_publisher',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['publication_draft_revisions','publication_checks','publication_versions','publication_receipts'] LOOP
  EXECUTE format('CREATE TRIGGER publication_immutable BEFORE UPDATE OR DELETE ON parallel_life.%I FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_immutable()',t);
  EXECUTE format('CREATE POLICY publication_read ON parallel_life.%I FOR SELECT TO pl_publisher USING(parallel_life.publisher_has_permission(''view''))',t);
 END LOOP;
END $$;
CREATE POLICY publisher_self ON parallel_life.publisher_principals FOR SELECT TO pl_publisher USING(id::text=current_setting('publisher.principal_id',true));
CREATE POLICY publication_read ON parallel_life.publication_works FOR SELECT TO pl_publisher USING(parallel_life.publisher_has_permission('view'));
CREATE POLICY publication_create ON parallel_life.publication_works FOR INSERT TO pl_publisher WITH CHECK(parallel_life.publisher_has_permission('edit') AND created_by::text=current_setting('publisher.principal_id',true));
CREATE POLICY publication_update ON parallel_life.publication_works FOR UPDATE TO pl_publisher USING(parallel_life.publisher_has_permission('edit') OR parallel_life.publisher_has_permission('publish')) WITH CHECK(parallel_life.publisher_has_permission('edit') OR parallel_life.publisher_has_permission('publish'));
CREATE POLICY publication_draft_insert ON parallel_life.publication_draft_revisions FOR INSERT TO pl_publisher WITH CHECK(parallel_life.publisher_has_permission('edit') AND created_by::text=current_setting('publisher.principal_id',true));
CREATE POLICY publication_check_insert ON parallel_life.publication_checks FOR INSERT TO pl_publisher WITH CHECK(parallel_life.publisher_has_permission('review') AND created_by::text=current_setting('publisher.principal_id',true));
CREATE POLICY publication_version_write ON parallel_life.publication_versions FOR INSERT TO pl_publisher WITH CHECK(parallel_life.publisher_has_permission('publish') AND created_by::text=current_setting('publisher.principal_id',true));
DROP POLICY publication_read ON parallel_life.publication_receipts;
CREATE POLICY receipt_read ON parallel_life.publication_receipts FOR SELECT TO pl_publisher USING(parallel_life.publisher_has_permission('view') AND principal_id::text=current_setting('publisher.principal_id',true));
CREATE POLICY receipt_write ON parallel_life.publication_receipts FOR INSERT TO pl_publisher WITH CHECK(parallel_life.publisher_has_permission('view') AND principal_id::text=current_setting('publisher.principal_id',true));
GRANT SELECT ON parallel_life.publisher_principals TO pl_publisher;
GRANT SELECT,INSERT ON parallel_life.publication_works,parallel_life.publication_draft_revisions,parallel_life.publication_checks,parallel_life.publication_versions,parallel_life.publication_receipts TO pl_publisher;
GRANT UPDATE(title,draft_version,metadata_version,publication_version,listed,updated_at) ON parallel_life.publication_works TO pl_publisher;
CREATE FUNCTION parallel_life.publisher_consume_login_limit(kind_value text, hash_value text) RETURNS TABLE(allowed boolean,retry_after_seconds integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE span interval; budget integer; instant timestamptz:=clock_timestamp(); row_value parallel_life.publisher_login_buckets;
BEGIN
 IF hash_value IS NULL OR kind_value IS NULL OR hash_value !~ '^[a-f0-9]{64}$' OR kind_value NOT IN ('global','client','username') THEN RAISE EXCEPTION 'INVALID_LOGIN_BUCKET' USING ERRCODE='22023'; END IF;
 span:=CASE WHEN kind_value='global' THEN interval '60 seconds' ELSE interval '900 seconds' END;
 budget:=CASE kind_value WHEN 'global' THEN 60 WHEN 'client' THEN 10 ELSE 6 END;
 INSERT INTO parallel_life.publisher_login_buckets(kind,bucket_hash,window_started_at,attempts) VALUES(kind_value,hash_value,instant,1)
 ON CONFLICT(kind,bucket_hash) DO UPDATE SET
 attempts=CASE WHEN parallel_life.publisher_login_buckets.window_started_at+span<=instant THEN 1 ELSE LEAST(parallel_life.publisher_login_buckets.attempts+1,1000000) END,
 window_started_at=CASE WHEN parallel_life.publisher_login_buckets.window_started_at+span<=instant THEN instant ELSE parallel_life.publisher_login_buckets.window_started_at END RETURNING * INTO row_value;
 RETURN QUERY SELECT row_value.attempts<=budget,CASE WHEN row_value.attempts<=budget THEN 0 ELSE GREATEST(1,ceil(extract(epoch FROM row_value.window_started_at+span-instant))::int) END;
END $$;
CREATE FUNCTION parallel_life.published_work_catalog(cursor_id uuid,take_count integer)
 RETURNS TABLE(id uuid,version bigint,title text,hook text,identity_label text,experience_note text,description text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF take_count IS NULL OR take_count NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_CATALOG_LIMIT' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT w.id,v.version,v.card->>'title',v.card->>'hook',v.card->>'identityLabel',v.card->>'experienceNote',v.card->>'description'
 FROM parallel_life.publication_works w JOIN parallel_life.publication_versions v ON v.work_id=w.id AND v.version=w.publication_version
 WHERE w.listed AND (cursor_id IS NULL OR w.id>cursor_id) ORDER BY w.id LIMIT take_count+1;
END $$;
REVOKE ALL ON FUNCTION parallel_life.publisher_has_permission(text),parallel_life.publisher_lock_permission(text),parallel_life.publication_immutable(),parallel_life.publication_work_update(),parallel_life.publication_version_insert(),parallel_life.publisher_consume_login_limit(text,text),parallel_life.published_work_catalog(uuid,integer) FROM PUBLIC,pl_app,pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.publisher_has_permission(text),parallel_life.publisher_lock_permission(text),parallel_life.publication_immutable(),parallel_life.publication_work_update(),parallel_life.publication_version_insert(),parallel_life.publisher_consume_login_limit(text,text) TO pl_publisher;
GRANT EXECUTE ON FUNCTION parallel_life.published_work_catalog(uuid,integer) TO pl_publisher,pl_app;
