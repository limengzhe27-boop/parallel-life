-- Internal service bridge only; no draft/runtime body is a public player DTO.
CREATE TABLE parallel_life.publication_world_bindings (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('published_work','trial')),
 requester text NOT NULL, owner_id text NOT NULL REFERENCES parallel_life.accounts(id),
 principal_id uuid REFERENCES parallel_life.publisher_principals(id),
 work_id uuid NOT NULL, publication_version bigint, draft_version bigint NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 seed_id uuid NOT NULL UNIQUE, world_id text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='trial' AND principal_id IS NOT NULL AND requester=principal_id::text AND publication_version IS NULL)
    OR (kind='published_work' AND principal_id IS NULL AND requester=owner_id AND publication_version>=1)),
 FOREIGN KEY(work_id,draft_version,content_hash) REFERENCES parallel_life.publication_draft_revisions(work_id,version,content_hash),
 FOREIGN KEY(work_id,publication_version) REFERENCES parallel_life.publication_versions(work_id,version),
 FOREIGN KEY(seed_id,owner_id) REFERENCES parallel_life.approved_seeds(id,owner_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id)
);
CREATE UNIQUE INDEX publication_player_binding ON parallel_life.publication_world_bindings(owner_id,work_id,publication_version) WHERE kind='published_work';
CREATE UNIQUE INDEX publication_trial_binding ON parallel_life.publication_world_bindings(principal_id,work_id,draft_version,content_hash) WHERE kind='trial';
CREATE TABLE parallel_life.publication_world_receipts (
 kind text NOT NULL CHECK(kind IN ('published_work','trial')), requester text NOT NULL, command_id uuid NOT NULL,
 request jsonb NOT NULL, binding_id uuid NOT NULL REFERENCES parallel_life.publication_world_bindings(id),
 result jsonb NOT NULL, PRIMARY KEY(kind,requester,command_id)
);
CREATE TABLE parallel_life.publication_world_admissions (
 ticket uuid PRIMARY KEY, transaction_id text NOT NULL, backend_pid integer NOT NULL,
 caller_role text NOT NULL, kind text NOT NULL, requester text NOT NULL, owner_id text NOT NULL,
 command_id uuid NOT NULL, request jsonb NOT NULL, origin jsonb NOT NULL,
 binding_id uuid NOT NULL, world_id text NOT NULL, seed_id uuid NOT NULL
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['publication_world_bindings','publication_world_receipts','publication_world_admissions'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON parallel_life.%I FROM PUBLIC,pl_app,pl_worker,pl_publisher',t);
 END LOOP;
END $$;
CREATE FUNCTION parallel_life.publication_bridge_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_PUBLICATION_BINDING' USING ERRCODE='23514'; END $$;
CREATE TRIGGER publication_binding_immutable BEFORE UPDATE OR DELETE ON parallel_life.publication_world_bindings FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_bridge_immutable();
CREATE TRIGGER publication_world_receipt_immutable BEFORE UPDATE OR DELETE ON parallel_life.publication_world_receipts FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_bridge_immutable();
CREATE FUNCTION parallel_life.publication_admission_consumed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM parallel_life.publication_world_admissions WHERE ticket=NEW.ticket) THEN
  RAISE EXCEPTION 'UNCONSUMED_PUBLICATION_ADMISSION' USING ERRCODE='23514';
 END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER publication_admission_consumed AFTER INSERT ON parallel_life.publication_world_admissions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_admission_consumed();

ALTER TABLE parallel_life.approved_seeds DROP CONSTRAINT seed_profile_source;
ALTER TABLE parallel_life.approved_seeds ADD CONSTRAINT seed_profile_source CHECK (
 profile_id IS NOT NULL OR COALESCE(document->'source'->>'kind' IN ('official_life','published_work','publication_trial'),false)
);
-- Keep the legacy 32 KiB budget; only the independently validated new opening shape gets 64 KiB.
ALTER TABLE parallel_life.world_builds DROP CONSTRAINT world_builds_opening_check;
ALTER TABLE parallel_life.world_builds ADD CONSTRAINT world_builds_opening_check CHECK (
 opening IS NULL OR (jsonb_typeof(opening)='object' AND (
  octet_length(opening::text)<32768 OR (COALESCE(opening->>'kind'='publication_opening' AND opening->'schemaVersion'='1'::jsonb,false) AND octet_length(opening::text)<65536)
 ))
);
CREATE FUNCTION parallel_life.publication_seed_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; s jsonb; BEGIN
 IF COALESCE(NEW.document->'source'->>'kind','') NOT IN ('published_work','publication_trial') THEN RETURN NULL; END IF;
 SELECT * INTO b FROM parallel_life.publication_world_bindings WHERE seed_id=NEW.id AND owner_id=NEW.owner_id;
 s=NEW.document->'source';
 IF NOT FOUND OR NEW.profile_id IS NOT NULL OR s IS DISTINCT FROM jsonb_build_object(
  'kind',CASE WHEN b.kind='trial' THEN 'publication_trial' ELSE 'published_work' END,
  'workId',b.work_id,'publicationVersion',COALESCE(b.publication_version,0),'draftVersion',b.draft_version,'contentHash',b.content_hash)
 THEN RAISE EXCEPTION 'PUBLICATION_SEED_BINDING_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER publication_seed_binding AFTER INSERT OR UPDATE ON parallel_life.approved_seeds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_seed_binding();

CREATE FUNCTION parallel_life.publication_binding_result(b parallel_life.publication_world_bindings,resumed boolean,replayed boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('worldId',b.world_id,'seedId',b.seed_id,'originKind',b.kind,'trialId',CASE WHEN b.kind='trial' THEN b.id ELSE NULL END,
 'origin',jsonb_build_object('workId',b.work_id,'publicationVersion',COALESCE(b.publication_version,0),'draftVersion',b.draft_version,'contentHash',b.content_hash),'resumed',resumed,'replayed',replayed)
$$;
CREATE FUNCTION parallel_life.publication_admit_internal(k text,w uuid,v bigint,h text,c uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE who text; own text; req jsonb; o jsonb; content jsonb; b parallel_life.publication_world_bindings%ROWTYPE;
 r parallel_life.publication_world_receipts%ROWTYPE; ticket uuid; wid text; sid uuid; bid uuid; work parallel_life.publication_works%ROWTYPE;
BEGIN
 IF c IS NULL OR w IS NULL OR v IS NULL OR v<0 OR v>9007199254740991 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF k='trial' THEN
  PERFORM parallel_life.publisher_lock_permission('review'); who=current_setting('publisher.principal_id',true);
  IF h IS NULL OR h !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 ELSE
  who=current_setting('app.user_id',true);
  IF who IS NULL OR who='' OR NOT EXISTS(SELECT 1 FROM parallel_life.accounts WHERE id=who) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF v<1 THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 END IF;
 req=jsonb_build_object('workId',w,'version',v,'contentHash',h);
 PERFORM pg_advisory_xact_lock(hashtextextended(k||':'||who,0));
 SELECT * INTO r FROM parallel_life.publication_world_receipts WHERE kind=k AND requester=who AND command_id=c;
 IF FOUND THEN
  IF r.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
  RETURN jsonb_build_object('result',r.result||jsonb_build_object('replayed',true));
 END IF;
 SELECT * INTO work FROM parallel_life.publication_works WHERE id=w FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF k='published_work' THEN
  IF NOT work.listed OR work.publication_version IS DISTINCT FROM v THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='P0001'; END IF;
  SELECT p.content,jsonb_build_object('workId',w,'publicationVersion',p.version,'draftVersion',p.draft_version,'contentHash',p.content_hash)
   INTO content,o FROM parallel_life.publication_versions p WHERE p.work_id=w AND p.version=v;
  SELECT * INTO b FROM parallel_life.publication_world_bindings WHERE kind=k AND owner_id=who AND work_id=w AND publication_version=v;
 ELSE
  IF work.draft_version IS DISTINCT FROM v THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='P0001'; END IF;
  SELECT d.content,jsonb_build_object('workId',w,'publicationVersion',0,'draftVersion',v,'contentHash',h)
   INTO content,o FROM parallel_life.publication_draft_revisions d WHERE d.work_id=w AND d.version=v AND d.content_hash=h;
  IF content IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='P0001'; END IF;
  SELECT * INTO b FROM parallel_life.publication_world_bindings WHERE kind=k AND principal_id=who::uuid AND work_id=w AND draft_version=v AND content_hash=h;
 END IF;
 IF b.id IS NOT NULL THEN
  INSERT INTO parallel_life.publication_world_receipts VALUES(k,who,c,req,b.id,parallel_life.publication_binding_result(b,true,false));
  RETURN jsonb_build_object('result',parallel_life.publication_binding_result(b,true,false));
 END IF;
 IF k='published_work' AND EXISTS(SELECT 1 FROM parallel_life.approved_seeds WHERE owner_id=who AND command_id=c) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
 ticket=gen_random_uuid();wid=gen_random_uuid()::text;sid=gen_random_uuid();bid=gen_random_uuid();
 own=CASE WHEN k='trial' THEN gen_random_uuid()::text ELSE who END;
 INSERT INTO parallel_life.publication_world_admissions VALUES(ticket,pg_current_xact_id()::text,pg_backend_pid(),session_user||':'||current_setting('role'),k,who,own,c,req,o,bid,wid,sid);
 RETURN jsonb_build_object('ticket',ticket,'content',content,'origin',o,'originKind',k,'worldId',wid,'ownerId',own,'seedId',sid);
END $$;
CREATE FUNCTION parallel_life.publication_admit_published(w uuid,v bigint,c uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT parallel_life.publication_admit_internal('published_work',w,v,NULL,c)
$$;
CREATE FUNCTION parallel_life.publication_admit_trial(w uuid,v bigint,h text,c uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT parallel_life.publication_admit_internal('trial',w,v,h,c)
$$;

CREATE FUNCTION parallel_life.publication_commit_internal(k text,t uuid,prepared jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a parallel_life.publication_world_admissions%ROWTYPE; world jsonb; seed jsonb; opening jsonb; expected_source jsonb;
 b parallel_life.publication_world_bindings%ROWTYPE; who text; content jsonb; j jsonb; actor_ids text[]; src text;
BEGIN
 IF k='trial' THEN PERFORM parallel_life.publisher_lock_permission('review');who=current_setting('publisher.principal_id',true);
 ELSE who=current_setting('app.user_id',true); END IF;
 SELECT * INTO a FROM parallel_life.publication_world_admissions WHERE ticket=t FOR UPDATE;
 IF NOT FOUND OR a.kind<>k OR a.requester IS DISTINCT FROM who OR a.transaction_id<>pg_current_xact_id()::text
   OR a.backend_pid<>pg_backend_pid() OR a.caller_role<>(session_user||':'||current_setting('role')) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF k='trial' THEN
  SELECT d.content INTO content FROM parallel_life.publication_works w JOIN parallel_life.publication_draft_revisions d ON d.work_id=w.id AND d.version=w.draft_version
   WHERE w.id=(a.origin->>'workId')::uuid AND d.version=(a.origin->>'draftVersion')::bigint AND d.content_hash=a.origin->>'contentHash' FOR SHARE OF w;
 ELSE
  SELECT v.content INTO content FROM parallel_life.publication_works w JOIN parallel_life.publication_versions v ON v.work_id=w.id AND v.version=w.publication_version
   WHERE w.id=(a.origin->>'workId')::uuid AND w.listed AND v.version=(a.origin->>'publicationVersion')::bigint AND v.content_hash=a.origin->>'contentHash' FOR SHARE OF w;
 END IF;
 IF content IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='P0001'; END IF;
 world=prepared->'world';seed=prepared->'seed';opening=prepared->'opening';src='publication-genesis:'||a.world_id;
 expected_source=jsonb_build_object('kind',CASE WHEN k='trial' THEN 'publication_trial' ELSE 'published_work' END)||a.origin;
 IF prepared IS NULL OR jsonb_typeof(prepared)<>'object' OR prepared - ARRAY['world','opening','seed']<>'{}'::jsonb
 OR world IS NULL OR jsonb_typeof(world)<>'object' OR octet_length(world::text)>=262144
 OR world->>'id' IS DISTINCT FROM a.world_id OR world->>'ownerId' IS DISTINCT FROM a.owner_id
 OR world->'version' IS DISTINCT FROM '0'::jsonb OR world->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR world->>'title' IS DISTINCT FROM content->'work'->>'title' OR world->>'time' IS DISTINCT FROM content->'world'->>'startAt'
 OR world - ARRAY['schemaVersion','id','ownerId','version','title','time','messageHistory','actors','actorTies','facts','messages','appointments','mediaRequests','space']<>'{}'::jsonb
 OR jsonb_typeof(world->'actors') IS DISTINCT FROM 'array' OR jsonb_array_length(world->'actors') NOT BETWEEN 2 AND 12
 OR jsonb_typeof(world->'facts') IS DISTINCT FROM 'array' OR jsonb_typeof(world->'messages') IS DISTINCT FROM 'array'
 OR jsonb_typeof(world->'appointments') IS DISTINCT FROM 'array' OR world->'mediaRequests' IS DISTINCT FROM '[]'::jsonb
 OR world->'actorTies' IS DISTINCT FROM '[]'::jsonb
 OR seed IS NULL OR jsonb_typeof(seed)<>'object' OR seed->>'id' IS DISTINCT FROM a.seed_id::text OR seed->'source' IS DISTINCT FROM expected_source
 OR seed - ARRAY['id','createdAt','source','identity','situation','setting','experienceNote']<>'{}'::jsonb
 OR seed->>'identity' IS DISTINCT FROM content->'protagonist'->>'identity' OR seed->>'situation' IS DISTINCT FROM content->'protagonist'->>'situation'
 OR seed->>'setting' IS DISTINCT FROM content->'world'->>'publicSetting' OR seed->>'experienceNote' IS DISTINCT FROM content->'work'->>'experienceNote'
 OR opening IS NULL OR jsonb_typeof(opening)<>'object' OR opening->>'kind' IS DISTINCT FROM 'publication_opening' OR opening->'origin' IS DISTINCT FROM a.origin
 OR opening - ARRAY['kind','schemaVersion','origin','originKind','identity','situation','setting','experienceNote','contacts','notes']<>'{}'::jsonb
 OR opening->>'originKind' IS DISTINCT FROM (CASE WHEN k='trial' THEN 'trial' ELSE 'published' END)
 OR opening->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR opening->>'identity' IS DISTINCT FROM seed->>'identity'
 OR opening->>'situation' IS DISTINCT FROM seed->>'situation' OR opening->>'setting' IS DISTINCT FROM seed->>'setting'
 OR opening->>'experienceNote' IS DISTINCT FROM seed->>'experienceNote'
 THEN RAISE EXCEPTION 'INVALID_RUNTIME' USING ERRCODE='22023'; END IF;
 SELECT array_agg(x->>'id') INTO actor_ids FROM jsonb_array_elements(world->'actors') x;
 IF cardinality(actor_ids)<>(SELECT count(DISTINCT id) FROM unnest(actor_ids) id) OR array_position(actor_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'INVALID_RUNTIME' USING ERRCODE='22023'; END IF;
 FOR j IN SELECT value FROM jsonb_array_elements(world->'messages') LOOP
  IF j->>'sourceEventId' IS DISTINCT FROM src OR j->>'role' IS DISTINCT FROM 'assistant' OR NOT (j->>'actorId'=ANY(actor_ids)) THEN RAISE EXCEPTION 'INVALID_RUNTIME' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR j IN SELECT value FROM jsonb_array_elements(world->'facts') LOOP
  IF j->>'sourceEventId' IS DISTINCT FROM src OR j->>'kind' IS DISTINCT FROM 'canonical'
   OR j->'visibility'->>'kind' NOT IN ('owner','actors') THEN RAISE EXCEPTION 'INVALID_RUNTIME' USING ERRCODE='22023'; END IF;
 END LOOP;
 FOR j IN SELECT value FROM jsonb_array_elements(world->'appointments') LOOP
  IF j->>'sourceEventId' IS DISTINCT FROM src OR j->>'status' IS DISTINCT FROM 'proposed' THEN RAISE EXCEPTION 'INVALID_RUNTIME' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF k='trial' THEN INSERT INTO parallel_life.accounts(id) VALUES(a.owner_id); END IF;
 INSERT INTO parallel_life.approved_seeds(id,owner_id,profile_id,command_id,request_hash,document)
  VALUES(a.seed_id,a.owner_id,NULL,a.command_id,a.origin->>'contentHash',seed);
 INSERT INTO parallel_life.worlds(id,owner_id,title,state) VALUES(a.world_id,a.owner_id,world->>'title',world||jsonb_build_object('messages','[]'::jsonb,'facts','[]'::jsonb,'appointments','[]'::jsonb));
 INSERT INTO parallel_life.world_initial_snapshots(world_id,owner_id,state,approved_seed) VALUES(a.world_id,a.owner_id,world,seed);
 INSERT INTO parallel_life.world_builds(seed_id,owner_id,world_id,opening) VALUES(a.seed_id,a.owner_id,a.world_id,opening);
 INSERT INTO parallel_life.world_clock(world_id,owner_id,story_now,paused) VALUES(a.world_id,a.owner_id,(world->>'time')::timestamptz,k='trial');
 INSERT INTO parallel_life.publication_world_bindings(id,kind,requester,owner_id,principal_id,work_id,publication_version,draft_version,content_hash,seed_id,world_id)
  VALUES(a.binding_id,k,a.requester,a.owner_id,CASE WHEN k='trial' THEN a.requester::uuid ELSE NULL END,(a.origin->>'workId')::uuid,
   CASE WHEN k='trial' THEN NULL ELSE (a.origin->>'publicationVersion')::bigint END,(a.origin->>'draftVersion')::bigint,a.origin->>'contentHash',a.seed_id,a.world_id) RETURNING * INTO b;
 INSERT INTO parallel_life.publication_world_receipts VALUES(k,who,a.command_id,a.request,b.id,parallel_life.publication_binding_result(b,false,false));
 DELETE FROM parallel_life.publication_world_admissions WHERE ticket=t;
 RETURN parallel_life.publication_binding_result(b,false,false);
END $$;
CREATE FUNCTION parallel_life.publication_commit_published(t uuid,p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT parallel_life.publication_commit_internal('published_work',t,p) $$;
CREATE FUNCTION parallel_life.publication_commit_trial(t uuid,p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT parallel_life.publication_commit_internal('trial',t,p) $$;
CREATE FUNCTION parallel_life.publication_get_trial(t uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; BEGIN
 PERFORM parallel_life.publisher_lock_permission('review');
 SELECT * INTO b FROM parallel_life.publication_world_bindings WHERE id=t AND kind='trial' AND principal_id::text=current_setting('publisher.principal_id',true);
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
 RETURN jsonb_build_object('trialId',b.id,'worldId',b.world_id,'seedId',b.seed_id,'origin',parallel_life.publication_binding_result(b,false,false)->'origin','createdAt',to_char(b.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END $$;
CREATE FUNCTION parallel_life.publication_trial_session(t uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; BEGIN
 PERFORM parallel_life.publisher_lock_permission('review');
 SELECT * INTO b FROM parallel_life.publication_world_bindings WHERE id=t AND kind='trial' AND principal_id::text=current_setting('publisher.principal_id',true);
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
 RETURN jsonb_build_object('ownerId',b.owner_id,'worldId',b.world_id,'seedId',b.seed_id,'origin',parallel_life.publication_binding_result(b,false,false)->'origin');
END $$;
CREATE FUNCTION parallel_life.publication_trial_evidence(w uuid,v bigint,h text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bid uuid; BEGIN
 PERFORM parallel_life.publisher_lock_permission('review');
 SELECT b.id INTO bid FROM parallel_life.publication_world_bindings b
 WHERE b.kind='trial' AND b.principal_id::text=current_setting('publisher.principal_id',true) AND b.work_id=w AND b.draft_version=v AND b.content_hash=h
 AND EXISTS(SELECT 1 FROM parallel_life.world_events e JOIN parallel_life.world_messages m ON m.world_id=e.world_id AND m.owner_id=e.owner_id AND m.document->>'sourceEventId'=e.id
 JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
 WHERE e.world_id=b.world_id AND e.owner_id=b.owner_id AND e.version>0 AND m.document->>'role'='assistant' AND length(trim(m.document->>'text'))>0);
 RETURN jsonb_build_object('verified',bid IS NOT NULL,'receiptId',bid);
END $$;
CREATE FUNCTION parallel_life.publication_player_catalog(cursor_id uuid,take_count integer) RETURNS TABLE(id uuid,version bigint,title text,hook text,identity_label text,experience_note text,description text,world_id text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 RETURN QUERY SELECT c.*,b.world_id FROM parallel_life.published_work_catalog(cursor_id,take_count) c
 LEFT JOIN parallel_life.publication_world_bindings b ON b.kind='published_work' AND b.owner_id=current_setting('app.user_id',true) AND b.work_id=c.id AND b.publication_version=c.version;
END $$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT oid::regprocedure AS fn FROM pg_proc WHERE pronamespace='parallel_life'::regnamespace AND proname IN (
 'publication_bridge_immutable','publication_admission_consumed','publication_seed_binding','publication_binding_result','publication_admit_internal','publication_admit_published','publication_admit_trial','publication_commit_internal','publication_commit_published','publication_commit_trial','publication_get_trial','publication_trial_session','publication_trial_evidence','publication_player_catalog') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,pl_app,pl_worker,pl_publisher',r.fn);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION parallel_life.publication_admit_published(uuid,bigint,uuid),parallel_life.publication_commit_published(uuid,jsonb),parallel_life.publication_player_catalog(uuid,integer) TO pl_app;
GRANT EXECUTE ON FUNCTION parallel_life.publication_admit_trial(uuid,bigint,text,uuid),parallel_life.publication_commit_trial(uuid,jsonb),parallel_life.publication_get_trial(uuid),parallel_life.publication_trial_session(uuid),parallel_life.publication_trial_evidence(uuid,bigint,text) TO pl_publisher;
