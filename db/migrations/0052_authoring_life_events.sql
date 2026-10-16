-- Reusable actor previews and optional director selection; existing worlds remain immutable.
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
  IF j->>'role'='user' AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(content->'phone'->'messages') m
    JOIN jsonb_array_elements(opening->'contacts') contact ON contact->>'actorKey'=m->>'actorKey'
    WHERE m->>'speaker'='player' AND m->>'origin'='history' AND j->'history'->>'key'=m->>'key'
    AND contact->>'actorId'=j->>'actorId' AND j->>'text'=m->>'text' AND (j->>'at')::timestamptz=(m->>'at')::timestamptz
  ) THEN RAISE EXCEPTION 'INVALID_PLAYER_HISTORY_SOURCE' USING ERRCODE='23514'; END IF;
  IF j->>'sourceEventId' IS DISTINCT FROM src OR j->>'role' NOT IN ('assistant','user') OR NOT (j->>'actorId'=ANY(actor_ids)) THEN RAISE EXCEPTION 'INVALID_RUNTIME' USING ERRCODE='22023'; END IF;
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

CREATE OR REPLACE FUNCTION parallel_life.publication_story_node_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p jsonb;n jsonb;r parallel_life.publication_story_receipts%ROWTYPE;e parallel_life.world_events%ROWTYPE; response parallel_life.world_events%ROWTYPE;expected_actor text;stage jsonb;deadline timestamptz;window_start timestamptz;event_story timestamptz;clock_now timestamptz;op text;prior_outcome text; BEGIN
 IF NEW.owner_id IS DISTINCT FROM current_setting('app.user_id',true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT document INTO p FROM parallel_life.publication_story_plans WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id;
 SELECT value INTO n FROM jsonb_array_elements(p->'nodes') WHERE value->>'key'=NEW.node_key;
 IF n IS NULL THEN RAISE EXCEPTION 'INVALID_STORY_NODE' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM parallel_life.publication_story_receipts WHERE id=NEW.latest_receipt_id AND world_id=NEW.world_id AND owner_id=NEW.owner_id AND node_key=NEW.node_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'STORY_RECEIPT_REQUIRED' USING ERRCODE='23514'; END IF;
 IF (NEW.status='claimed' AND r.kind NOT IN ('claim','retry')) OR (NEW.status='unknown' AND r.kind<>'unknown') OR (NEW.status='failed' AND r.kind<>'failure')
 OR (NEW.status='presented' AND r.kind<>'message_presented') OR (NEW.status='offered' AND r.kind NOT IN ('invitation_offered','response'))
 OR (NEW.status IN ('committed','declined') AND r.kind<>'response') OR (NEW.status='skipped' AND r.kind NOT IN ('owner_skip','exclusion'))
 OR (NEW.status='expired' AND r.kind NOT IN ('clock_expiry','response')) THEN RAISE EXCEPTION 'INVALID_STORY_RECEIPT' USING ERRCODE='23514'; END IF;
 SELECT a->>'id' INTO expected_actor FROM jsonb_array_elements(p->'actors') a WHERE a->>'key'=COALESCE(n->'intent'->>'actorKey',n->'intent'->'actorKeys'->>0);
 IF NEW.actor_id IS DISTINCT FROM expected_actor OR (n->'intent'->>'kind'='editorial_only' AND NEW.status IN ('claimed','unknown','presented','offered','committed')) THEN RAISE EXCEPTION 'INVALID_STORY_ACTOR' USING ERRCODE='23514'; END IF;
 SELECT value INTO stage FROM jsonb_array_elements(COALESCE(p->'timeline'->'stages','[]'::jsonb)) WHERE value->>'key'=n->'timeline'->>'stageKey';
 window_start=GREATEST((n->'timeline'->'window'->>'notBefore')::timestamptz,(stage->'window'->>'notBefore')::timestamptz);
 deadline=LEAST((n->'timeline'->'window'->>'expiresAt')::timestamptz,(stage->'window'->>'expiresAt')::timestamptz);
 clock_now=parallel_life.publication_story_clock(NEW.world_id);
 IF NEW.status='claimed' AND (NEW.story_at>clock_now+interval '1 millisecond' OR (window_start IS NOT NULL AND NEW.story_at<window_start) OR (deadline IS NOT NULL AND NEW.story_at>=deadline)) THEN RAISE EXCEPTION 'INVALID_STORY_CLOCK' USING ERRCODE='23514'; END IF;
 IF NEW.status='expired' AND r.kind='clock_expiry' AND (deadline IS NULL OR r.story_at<deadline OR r.story_at>clock_now+interval '1 millisecond') THEN RAISE EXCEPTION 'INVALID_STORY_EXPIRY' USING ERRCODE='23514'; END IF;
 IF NEW.source_event_id IS NOT NULL THEN
  SELECT ev.* INTO e FROM parallel_life.world_events ev JOIN parallel_life.commands c ON c.world_id=ev.world_id AND c.owner_id=ev.owner_id AND c.id=ev.command_id AND c.status='succeeded' AND c.result_event_id=ev.id
  WHERE ev.world_id=NEW.world_id AND ev.owner_id=NEW.owner_id AND ev.id=NEW.source_event_id AND ev.command_id=NEW.command_id::text AND ev.version=NEW.expected_version+1 AND ev.payload->>'type'='turn.resolved' AND ev.payload->'data'->>'actorId'=NEW.actor_id;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM parallel_life.world_messages m WHERE m.id=NEW.source_message_id AND m.world_id=NEW.world_id AND m.owner_id=NEW.owner_id AND m.actor_id=NEW.actor_id AND m.document->>'actorId'=NEW.actor_id AND m.document->>'role'='assistant' AND m.document->>'sourceEventId'=e.id AND length(trim(m.document->>'text'))>0) THEN RAISE EXCEPTION 'INVALID_STORY_EVENT' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.source_event_id IS NOT NULL AND NEW.status IN ('presented','offered','committed','declined') THEN
  SELECT COALESCE(e.payload->>'storyAt',c.result_state->>'time')::timestamptz INTO event_story FROM parallel_life.commands c WHERE c.world_id=NEW.world_id AND c.owner_id=NEW.owner_id AND c.id=NEW.command_id::text;
  IF event_story IS NULL OR (window_start IS NOT NULL AND event_story<window_start) OR (deadline IS NOT NULL AND event_story>=deadline) THEN RAISE EXCEPTION 'INVALID_PRESENTATION_WINDOW' USING ERRCODE='23514'; END IF;
 END IF;
 IF r.kind='exclusion' THEN
  SELECT outcome INTO prior_outcome FROM parallel_life.publication_story_nodes WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND node_key=r.data->>'sourceNodeKey';
  IF prior_outcome IS NULL OR NOT ((prior_outcome='committed' AND n->'mutuallyExclusiveNodeKeys' ? (r.data->>'sourceNodeKey')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(n->'timeline'->'excludeIfResolved','[]'::jsonb)) x WHERE x->>'nodeKey'=r.data->>'sourceNodeKey' AND x->'outcomes' ? prior_outcome)) THEN RAISE EXCEPTION 'ACTUAL_EXCLUSION_SOURCE_REQUIRED' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status IN ('presented','offered','committed','declined') AND NEW.source_event_id IS NULL THEN RAISE EXCEPTION 'ACTUAL_STORY_EVENT_REQUIRED' USING ERRCODE='23514'; END IF;
 IF NEW.status='presented' AND NOT ((n->'intent'->>'kind'='offer_message' AND NEW.outcome IS NOT DISTINCT FROM 'committed') OR (n->'intent'->>'kind'='director_event' AND NEW.outcome IS NULL)) THEN RAISE EXCEPTION 'INVALID_STORY_PRESENTATION' USING ERRCODE='23514'; END IF;
 IF NEW.invitation_id IS NOT NULL THEN
  IF n->'intent'->>'kind'<>'offer_invitation' OR jsonb_array_length(n->'intent'->'actorKeys')<>1 OR NOT EXISTS(SELECT 1 FROM parallel_life.world_appointments a WHERE a.id=NEW.invitation_id AND a.world_id=NEW.world_id AND a.owner_id=NEW.owner_id AND a.document->>'sourceEventId'=NEW.source_event_id AND a.document->'participantIds'=jsonb_build_array(NEW.actor_id) AND a.document->>'title'=n->'intent'->>'title' AND (a.document->>'at')::timestamptz>=(n->'intent'->>'earliestAt')::timestamptz) THEN RAISE EXCEPTION 'INVALID_STORY_INVITATION' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='offered' AND (NEW.invitation_id IS NULL OR NEW.outcome IS NOT NULL) THEN RAISE EXCEPTION 'OFFER_IS_NOT_COMPLETION' USING ERRCODE='23514'; END IF;
 IF NEW.response_event_id IS NOT NULL THEN
  SELECT ev.* INTO response FROM parallel_life.world_events ev JOIN parallel_life.commands c ON c.world_id=ev.world_id AND c.owner_id=ev.owner_id AND c.id=ev.command_id AND c.status='succeeded' AND c.result_event_id=ev.id
  WHERE ev.world_id=NEW.world_id AND ev.owner_id=NEW.owner_id AND ev.id=NEW.response_event_id AND ev.payload->>'type'='invitation.responded' AND ev.payload->'data'->>'id'=NEW.invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTUAL_INVITATION_RESPONSE_REQUIRED' USING ERRCODE='23514'; END IF;
  op=response.payload->'data'->>'operation';
  IF (NEW.status='committed' AND op NOT IN ('accept','attend')) OR (NEW.status='declined' AND op<>'cancel') OR (NEW.status='expired' AND r.kind='response' AND op<>'miss') OR (NEW.status='offered' AND r.kind='response' AND op<>'reschedule') THEN RAISE EXCEPTION 'INVALID_INVITATION_OUTCOME' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status IN ('committed','declined') AND NEW.response_event_id IS NULL THEN RAISE EXCEPTION 'ACTUAL_INVITATION_RESPONSE_REQUIRED' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('claimed','unknown','offered','failed') AND NEW.outcome IS NOT NULL THEN RAISE EXCEPTION 'UNRESOLVED_STORY_NODE' USING ERRCODE='23514'; END IF;
 IF NEW.status IN ('skipped','expired','declined','committed') AND NEW.outcome IS DISTINCT FROM NEW.status THEN RAISE EXCEPTION 'INVALID_STORY_OUTCOME' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;


CREATE TABLE parallel_life.publication_story_selections (
 id uuid PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, expected_version bigint NOT NULL CHECK(expected_version>=0),
 candidate_keys jsonb NOT NULL CHECK(jsonb_typeof(candidate_keys)='array' AND jsonb_array_length(candidate_keys) BETWEEN 1 AND 24),
 status text NOT NULL CHECK(status IN ('claimed','selected','deferred','unknown')), selected_node_key text,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.publication_story_plans(world_id,owner_id),
 CHECK((status='selected' AND selected_node_key IS NOT NULL) OR (status<>'selected' AND selected_node_key IS NULL))
);
CREATE INDEX publication_selection_world ON parallel_life.publication_story_selections(world_id,owner_id,created_at DESC);
ALTER TABLE parallel_life.publication_story_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.publication_story_selections FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_selection ON parallel_life.publication_story_selections TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
REVOKE ALL ON parallel_life.publication_story_selections FROM PUBLIC,pl_app,pl_worker,pl_publisher_login;

CREATE FUNCTION parallel_life.publication_story_selection_begin(w text,o text,v bigint,a uuid,keys jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE world_version bigint; plan jsonb; BEGIN
 IF o IS DISTINCT FROM current_setting('app.user_id',true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT version INTO world_version FROM parallel_life.worlds WHERE id=w AND owner_id=o FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF world_version<>v THEN RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE='P0001'; END IF;
 SELECT document INTO plan FROM parallel_life.publication_story_plans WHERE world_id=w AND owner_id=o;
 IF plan IS NULL OR jsonb_typeof(keys) IS DISTINCT FROM 'array' OR jsonb_array_length(keys) NOT BETWEEN 1 AND 24
 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(keys))<>jsonb_array_length(keys)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(keys) key WHERE jsonb_typeof(key)<>'string' OR NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(plan->'nodes') n WHERE n->>'key'=key#>>'{}' AND n->'intent'->>'kind'<>'editorial_only'))
 THEN RAISE EXCEPTION 'INVALID_SELECTION_POOL' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM parallel_life.publication_story_nodes WHERE world_id=w AND owner_id=o AND status IN ('claimed','unknown'))
 OR EXISTS(SELECT 1 FROM parallel_life.publication_story_selections WHERE world_id=w AND owner_id=o AND
 (created_at>clock_timestamp()-interval '10 minutes' OR (expected_version=v AND status IN ('claimed','unknown')))) THEN RETURN false; END IF;
 INSERT INTO parallel_life.publication_story_selections(id,world_id,owner_id,expected_version,candidate_keys,status) VALUES(a,w,o,v,keys,'claimed');
 RETURN true;
END $$;
CREATE FUNCTION parallel_life.publication_story_selection_finish(w text,o text,a uuid,s text,n text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt parallel_life.publication_story_selections%ROWTYPE; BEGIN
 IF o IS DISTINCT FROM current_setting('app.user_id',true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO attempt FROM parallel_life.publication_story_selections WHERE id=a AND world_id=w AND owner_id=o FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
 IF s NOT IN ('selected','deferred','unknown') OR (s='selected' AND (n IS NULL OR NOT attempt.candidate_keys ? n)) OR (s<>'selected' AND n IS NOT NULL)
 THEN RAISE EXCEPTION 'INVALID_SELECTION_RESULT' USING ERRCODE='23514'; END IF;
 IF attempt.status<>'claimed' THEN
  IF attempt.status=s AND attempt.selected_node_key IS NOT DISTINCT FROM n THEN RETURN; END IF;
  RAISE EXCEPTION 'IMMUTABLE_SELECTION_RESULT' USING ERRCODE='23514';
 END IF;
 UPDATE parallel_life.publication_story_selections SET status=s,selected_node_key=n,finished_at=clock_timestamp() WHERE id=a;
END $$;
REVOKE ALL ON FUNCTION parallel_life.publication_story_selection_begin(text,text,bigint,uuid,jsonb),parallel_life.publication_story_selection_finish(text,text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.publication_story_selection_begin(text,text,bigint,uuid,jsonb),parallel_life.publication_story_selection_finish(text,text,uuid,text,text) TO pl_app;

-- Each player reads the edition bound to their own world, including downlisted editions.
CREATE FUNCTION parallel_life.publication_social_opening(w text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE content jsonb; opening jsonb; BEGIN
 SELECT r.content,wb.opening INTO content,opening FROM parallel_life.publication_world_bindings b
 JOIN parallel_life.publication_draft_revisions r ON r.work_id=b.work_id AND r.version=b.draft_version AND r.content_hash=b.content_hash
 JOIN parallel_life.world_builds wb ON wb.world_id=b.world_id AND wb.owner_id=b.owner_id AND wb.seed_id=b.seed_id
 WHERE b.world_id=w AND b.owner_id=current_setting('app.user_id',true);
 IF content IS NULL THEN RETURN jsonb_build_object('moments','[]'::jsonb); END IF;
 RETURN jsonb_build_object('moments',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',m->>'key','actorId',contact->>'actorId','name',actor->>'name','text',m->>'text','at',m->>'at') ORDER BY (m->>'at')::timestamptz DESC,m->>'key')
 FROM jsonb_array_elements(COALESCE(content->'phone'->'moments','[]'::jsonb)) m
 JOIN jsonb_array_elements(content->'actors') actor ON actor->>'key'=m->>'actorKey' AND actor->'knownAtStart'='true'::jsonb
 JOIN jsonb_array_elements(opening->'contacts') contact ON contact->>'actorKey'=m->>'actorKey'
 WHERE (m->>'at')::timestamptz<=(content->'world'->>'startAt')::timestamptz),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION parallel_life.publication_social_opening(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.publication_social_opening(text) TO pl_app;
