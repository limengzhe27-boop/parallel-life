-- Allow published_work to admit runtime_epoch = 2 for new agent player worlds.
-- Existing player worlds and legacy starts remain runtime_epoch = 1.
CREATE OR REPLACE FUNCTION parallel_life.publication_admit_internal(k text,w uuid,v bigint,h text,c uuid,runtime_epoch integer) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE who text; own text; req jsonb; o jsonb; content jsonb; b parallel_life.publication_world_bindings%ROWTYPE;
 r parallel_life.publication_world_receipts%ROWTYPE; ticket uuid; wid text; sid uuid; bid uuid; work parallel_life.publication_works%ROWTYPE;
BEGIN
 IF runtime_epoch NOT IN (1,2) OR runtime_epoch IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
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
 IF runtime_epoch=2 THEN req=req||jsonb_build_object('engineEpoch',2); END IF;
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
  SELECT * INTO b FROM parallel_life.publication_world_bindings WHERE kind=k AND principal_id=who::uuid AND work_id=w AND draft_version=v AND content_hash=h AND engine_epoch=runtime_epoch;
 END IF;
 IF b.id IS NOT NULL THEN
  INSERT INTO parallel_life.publication_world_receipts VALUES(k,who,c,req,b.id,parallel_life.publication_binding_result(b,true,false));
  RETURN jsonb_build_object('result',parallel_life.publication_binding_result(b,true,false));
 END IF;
 IF k='published_work' AND EXISTS(SELECT 1 FROM parallel_life.approved_seeds WHERE owner_id=who AND command_id=c) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='P0001'; END IF;
 ticket=gen_random_uuid();wid=gen_random_uuid()::text;sid=gen_random_uuid();bid=gen_random_uuid();
 own=CASE WHEN k='trial' THEN gen_random_uuid()::text ELSE who END;
 INSERT INTO parallel_life.publication_world_admissions VALUES(ticket,pg_current_xact_id()::text,pg_backend_pid(),session_user||':'||current_setting('role'),k,who,own,c,req,o,bid,wid,sid,runtime_epoch);
 RETURN jsonb_build_object('ticket',ticket,'content',content,'origin',o,'originKind',k,'worldId',wid,'ownerId',own,'seedId',sid);
END $$;

CREATE OR REPLACE FUNCTION parallel_life.publication_admit_agent_published(w uuid,v bigint,c uuid) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT parallel_life.publication_admit_internal('published_work',w,v,NULL,c,2)
$$;

CREATE OR REPLACE FUNCTION parallel_life.publication_agent_world_source(w text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE;
BEGIN
 SELECT * INTO b FROM parallel_life.publication_world_bindings
 WHERE world_id=w AND owner_id=current_setting('app.user_id',true) AND engine_epoch=2;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
 RETURN jsonb_build_object('bindingId',b.id,'ownerId',b.owner_id,'worldId',b.world_id,'seedId',b.seed_id,'engineEpoch',2,
 'kind',b.kind,
 'origin',CASE WHEN b.kind='published_work' THEN
   jsonb_build_object('workId',b.work_id,'publicationVersion',b.publication_version,'draftVersion',b.draft_version,'contentHash',b.content_hash)
  ELSE
   jsonb_build_object('workId',b.work_id,'publicationVersion',0,'draftVersion',b.draft_version,'contentHash',b.content_hash)
  END);
END $$;

REVOKE ALL ON FUNCTION parallel_life.publication_admit_internal(text,uuid,bigint,text,uuid,integer),
 parallel_life.publication_admit_agent_published(uuid,bigint,uuid),
 parallel_life.publication_agent_world_source(text)
 FROM PUBLIC,pl_app,pl_worker,pl_publisher;

GRANT EXECUTE ON FUNCTION parallel_life.publication_admit_agent_published(uuid,bigint,uuid) TO pl_app;
GRANT EXECUTE ON FUNCTION parallel_life.publication_agent_world_source(text) TO pl_app;
