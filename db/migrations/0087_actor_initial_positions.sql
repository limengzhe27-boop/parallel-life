-- 0087_actor_initial_positions.sql
-- Allow world_authoritative_positions to persist initial genesis locations at source_version = 0.
-- Position source_event_id is NULL if and only if source_version = 0.
-- On world commit, write version 0 authoritative positions for player and actors.
-- Actors with author-declared initialPlaceKey start 'at' that place; others start 'unknown'.
-- Idempotent and rollback-safe; subsequent moves (>0) strictly overwrite version 0.

ALTER TABLE parallel_life.world_authoritative_positions ALTER COLUMN source_event_id DROP NOT NULL;
ALTER TABLE parallel_life.world_authoritative_positions DROP CONSTRAINT IF EXISTS world_authoritative_positions_source_version_check;
ALTER TABLE parallel_life.world_authoritative_positions ADD CONSTRAINT world_authoritative_positions_source_version_check CHECK(source_version >= 0);
ALTER TABLE parallel_life.world_authoritative_positions ADD CONSTRAINT world_authoritative_positions_source_event_check CHECK((source_version=0)=(source_event_id IS NULL));

CREATE OR REPLACE FUNCTION parallel_life.publication_commit_internal(k text,t uuid,prepared jsonb) RETURNS jsonb
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
 world=jsonb_set(world,'{time}',to_jsonb(parallel_life.publication_runtime_instant(world->>'time')));
 world=jsonb_set(world,'{messageHistory,startAt}',to_jsonb(parallel_life.publication_runtime_instant(world->'messageHistory'->>'startAt')));
 world=jsonb_set(world,'{messages}',COALESCE(
  (SELECT jsonb_agg(jsonb_set(value,'{at}',to_jsonb(parallel_life.publication_runtime_instant(value->>'at'))) ORDER BY ord)
   FROM jsonb_array_elements(world->'messages') WITH ORDINALITY AS x(value,ord)),'[]'::jsonb));
 world=jsonb_set(world,'{appointments}',COALESCE(
  (SELECT jsonb_agg(jsonb_set(value,'{at}',to_jsonb(parallel_life.publication_runtime_instant(value->>'at'))) ORDER BY ord)
   FROM jsonb_array_elements(world->'appointments') WITH ORDINALITY AS x(value,ord)),'[]'::jsonb));
 
 expected_source=jsonb_build_object('kind',CASE WHEN k='trial' THEN 'publication_trial' ELSE 'published_work' END)||a.origin;
 IF prepared IS NULL OR jsonb_typeof(prepared)<>'object' OR prepared - ARRAY['world','opening','seed']<>'{}'::jsonb
 OR world IS NULL OR jsonb_typeof(world)<>'object' OR octet_length(world::text)>=262144
 OR world->>'id' IS DISTINCT FROM a.world_id OR world->>'ownerId' IS DISTINCT FROM a.owner_id
 OR world->'version' IS DISTINCT FROM '0'::jsonb OR world->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR world->>'title' IS DISTINCT FROM content->'work'->>'title' OR world->>'time' IS DISTINCT FROM to_char((regexp_replace(content->'world'->>'startAt','([.][0-9]{3})[0-9]+Z$','\1Z'))::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 OR world - ARRAY['schemaVersion','id','ownerId','version','title','time','messageHistory','actors','actorTies','facts','messages','appointments','mediaRequests','space']<>'{}'::jsonb
 OR jsonb_typeof(world->'actors') IS DISTINCT FROM 'array' OR jsonb_array_length(world->'actors') NOT BETWEEN 1 AND 12
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
  IF j->>'role'='user' AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(content->'phone'->'messages') m
    JOIN jsonb_array_elements(opening->'contacts') contact ON contact->>'actorKey'=m->>'actorKey'
    WHERE m->>'speaker'='player' AND m->>'origin'='history' AND j->'history'->>'key'=m->>'key'
    AND contact->>'actorId'=j->>'actorId' AND j->>'text'=m->>'text' AND j->>'at'=to_char((regexp_replace(m->>'at','([.][0-9]{3})[0-9]+Z$','\1Z'))::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) THEN RAISE EXCEPTION 'INVALID_PLAYER_HISTORY_SOURCE' USING ERRCODE='23514'; END IF;
  IF j->>'sourceEventId' IS DISTINCT FROM src OR COALESCE(j->>'role','') NOT IN ('assistant','user') OR NOT COALESCE(j->>'actorId'=ANY(actor_ids),false) THEN RAISE EXCEPTION 'INVALID_RUNTIME' USING ERRCODE='22023'; END IF;
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
 INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document)
  VALUES(a.world_id,a.owner_id,'player',NULL,0,jsonb_build_object(
    'worldId',a.world_id,'subject',jsonb_build_object('kind','player'),'status','at',
    'placeId',content->'world'->>'startPlaceKey','sourceEventId',null,'worldVersion',0,'occurredAt',world->>'time'
  )) ON CONFLICT(world_id,subject_key) DO NOTHING;
 FOR j IN SELECT value FROM jsonb_array_elements(world->'actors') LOOP
  INSERT INTO parallel_life.world_authoritative_positions(world_id,owner_id,subject_key,source_event_id,source_version,document)
   VALUES(a.world_id,a.owner_id,'actor:'||(j->>'id'),NULL,0,jsonb_build_object(
     'worldId',a.world_id,'subject',jsonb_build_object('kind','actor','actorId',j->>'id'),
     'status',CASE WHEN j->>'initialPlaceId' IS NOT NULL THEN 'at' ELSE 'unknown' END,
     'placeId',CASE WHEN j->>'initialPlaceId' IS NOT NULL THEN j->'initialPlaceId' ELSE 'null'::jsonb END,
     'sourceEventId',null,'worldVersion',0,'occurredAt',world->>'time'
   )) ON CONFLICT(world_id,subject_key) DO NOTHING;
 END LOOP;
 INSERT INTO parallel_life.publication_world_bindings(id,kind,requester,owner_id,principal_id,work_id,publication_version,draft_version,content_hash,seed_id,world_id,engine_epoch)
  VALUES(a.binding_id,k,a.requester,a.owner_id,CASE WHEN k='trial' THEN a.requester::uuid ELSE NULL END,(a.origin->>'workId')::uuid,
   CASE WHEN k='trial' THEN NULL ELSE (a.origin->>'publicationVersion')::bigint END,(a.origin->>'draftVersion')::bigint,a.origin->>'contentHash',a.seed_id,a.world_id,a.engine_epoch) RETURNING * INTO b;
 INSERT INTO parallel_life.publication_world_receipts VALUES(k,who,a.command_id,a.request,b.id,parallel_life.publication_binding_result(b,false,false));
 DELETE FROM parallel_life.publication_world_admissions WHERE ticket=t;
 RETURN parallel_life.publication_binding_result(b,false,false);
END $$;
