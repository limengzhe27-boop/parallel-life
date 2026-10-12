-- Per-owner narrative provenance. Authored candidates are plans, never prewritten world events.
CREATE TABLE parallel_life.publication_story_plans (
 world_id text PRIMARY KEY, owner_id text NOT NULL, binding_id uuid NOT NULL REFERENCES parallel_life.publication_world_bindings(id),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<131072),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(world_id,owner_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id)
);
CREATE TABLE parallel_life.publication_story_nodes (
 world_id text NOT NULL,owner_id text NOT NULL,node_key text NOT NULL CHECK(node_key ~ '^[a-z][a-z0-9_]{0,31}$'),
 claim_id uuid NOT NULL UNIQUE,command_id uuid NOT NULL,actor_id text,expected_version integer NOT NULL CHECK(expected_version>=0),
 status text NOT NULL CHECK(status IN ('claimed','unknown','presented','offered','committed','declined','skipped','expired','failed')),
 outcome text CHECK(outcome IN ('committed','declined','skipped','expired')),story_at timestamptz NOT NULL,automatic boolean NOT NULL,
 source_event_id text,source_message_id text,invitation_id text,response_event_id text,terminal_at timestamptz,
 player_completed boolean NOT NULL DEFAULT false CHECK(NOT player_completed),latest_receipt_id uuid NOT NULL,
 PRIMARY KEY(world_id,node_key),UNIQUE(world_id,owner_id,node_key),UNIQUE(world_id,command_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.publication_story_plans(world_id,owner_id),
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id),
 FOREIGN KEY(world_id,response_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id)
);
CREATE TABLE parallel_life.publication_story_receipts (
 id uuid PRIMARY KEY,world_id text NOT NULL,owner_id text NOT NULL,node_key text NOT NULL,command_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('claim','retry','unknown','failure','message_presented','invitation_offered','response','owner_skip','clock_expiry','exclusion')),
 story_at timestamptz NOT NULL,source_event_id text,data jsonb NOT NULL CHECK(jsonb_typeof(data)='object' AND octet_length(data::text)<8192),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,world_id,owner_id),
 FOREIGN KEY(world_id,owner_id,node_key) REFERENCES parallel_life.publication_story_nodes(world_id,owner_id,node_key) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id)
);
ALTER TABLE parallel_life.publication_story_nodes ADD CONSTRAINT story_latest_receipt FOREIGN KEY(latest_receipt_id,world_id,owner_id)
 REFERENCES parallel_life.publication_story_receipts(id,world_id,owner_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX story_receipts_command ON parallel_life.publication_story_receipts(world_id,owner_id,command_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['publication_story_plans','publication_story_nodes','publication_story_receipts'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_story ON parallel_life.%I TO pl_app USING(owner_id=current_setting(''app.user_id'',true)) WITH CHECK(owner_id=current_setting(''app.user_id'',true))',t);
  EXECUTE format('REVOKE ALL ON parallel_life.%I FROM PUBLIC,pl_app,pl_publisher,pl_worker',t);
  EXECUTE format('GRANT SELECT ON parallel_life.%I TO pl_app',t);
 END LOOP;
END $$;
GRANT INSERT,UPDATE ON parallel_life.publication_story_nodes TO pl_app;
GRANT INSERT ON parallel_life.publication_story_receipts TO pl_app;

CREATE FUNCTION parallel_life.publication_story_clock(w text) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT GREATEST((x.state->>'time')::timestamptz,c.story_now+CASE WHEN c.paused THEN interval '0' ELSE GREATEST(EXTRACT(EPOCH FROM now()-c.last_tick_at),0)*c.speed*interval '1 second' END)
 FROM parallel_life.worlds x JOIN parallel_life.world_clock c ON c.world_id=x.id AND c.owner_id=x.owner_id
 WHERE x.id=w AND x.owner_id=current_setting('app.user_id',true)
$$;
CREATE FUNCTION parallel_life.publication_story_source(w text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; d jsonb; initial jsonb; opening jsonb; BEGIN
 SELECT * INTO b FROM parallel_life.publication_world_bindings WHERE world_id=w AND owner_id=current_setting('app.user_id',true);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT r.content INTO d FROM parallel_life.publication_draft_revisions r WHERE r.work_id=b.work_id AND r.version=b.draft_version AND r.content_hash=b.content_hash;
 IF b.kind='published_work' AND NOT EXISTS(SELECT 1 FROM parallel_life.publication_versions v WHERE v.work_id=b.work_id AND v.version=b.publication_version AND v.draft_version=b.draft_version AND v.content_hash=b.content_hash AND v.content=d) THEN RAISE EXCEPTION 'INVALID_STORY_SOURCE' USING ERRCODE='23514'; END IF;
 SELECT s.state,wb.opening INTO initial,opening FROM parallel_life.world_initial_snapshots s JOIN parallel_life.world_builds wb ON wb.world_id=s.world_id AND wb.owner_id=s.owner_id AND wb.seed_id=b.seed_id WHERE s.world_id=w AND s.owner_id=b.owner_id;
 IF d IS NULL OR initial IS NULL OR opening->'origin' IS DISTINCT FROM jsonb_build_object('workId',b.work_id,'publicationVersion',COALESCE(b.publication_version,0),'draftVersion',b.draft_version,'contentHash',b.content_hash) THEN RAISE EXCEPTION 'INVALID_STORY_SOURCE' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('origin',opening->'origin','timeline',d->'timeline','nodes',d->'candidates',
 'actorKeys',(SELECT jsonb_agg(a->>'key') FROM jsonb_array_elements(d->'actors') a),
 'history',d->'history','knownFactKeys',d->'protagonist'->'knownFactKeys','initialKnowledge',d->'initialKnowledge',
 'contacts',(SELECT jsonb_agg(jsonb_build_object('actorKey',a->>'actorKey','actorId',a->>'actorId')) FROM jsonb_array_elements(opening->'contacts') a),
 'initialActorIds',(SELECT jsonb_agg(a->>'id') FROM jsonb_array_elements(initial->'actors') a),
 'initialFacts',initial->'facts','initialPlaceKeys',(SELECT jsonb_agg(a->>'id') FROM jsonb_array_elements(initial->'space'->'places') a),
 'places',(SELECT jsonb_agg(jsonb_build_object('key',a->>'key','name',a->>'name')) FROM jsonb_array_elements(d->'places') a),
 'genesisSource','publication-genesis:'||w);
END $$;
CREATE FUNCTION parallel_life.publication_story_store_plan(w text,p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb;b parallel_life.publication_world_bindings%ROWTYPE;actors jsonb;places jsonb;h jsonb;rh jsonb;recipients jsonb;ids jsonb;expected_fact jsonb;cursor_index integer=0;count_expected integer; BEGIN
 s=parallel_life.publication_story_source(w);
 IF s IS NULL OR p->'origin' IS DISTINCT FROM s->'origin' OR p->'nodes' IS DISTINCT FROM s->'nodes' OR p->'timeline' IS DISTINCT FROM s->'timeline'
  OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR p-ARRAY['schemaVersion','origin','timeline','nodes','actors','places','history']<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_STORY_PLAN' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(jsonb_build_object('key',a.value->>'actorKey','id',a.value->>'actorId') ORDER BY a.ord) INTO actors FROM jsonb_array_elements(s->'contacts') WITH ORDINALITY a(value,ord);
 SELECT COALESCE(jsonb_agg(a.value ORDER BY a.ord),'[]'::jsonb) INTO places FROM jsonb_array_elements(s->'places') WITH ORDINALITY a(value,ord) WHERE s->'initialPlaceKeys' ? (a.value->>'key');
 IF p->'actors' IS DISTINCT FROM actors OR p->'places' IS DISTINCT FROM places OR jsonb_typeof(p->'history') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'history')<>jsonb_array_length(s->'history') THEN RAISE EXCEPTION 'INVALID_STORY_NAMESPACE' USING ERRCODE='23514'; END IF;
 IF (SELECT count(DISTINCT value->>'key') FROM jsonb_array_elements(p->'history'))<>jsonb_array_length(p->'history') THEN RAISE EXCEPTION 'DUPLICATE_STORY_HISTORY' USING ERRCODE='23514'; END IF;
 FOR h IN SELECT value FROM jsonb_array_elements(p->'history') LOOP
  SELECT value INTO rh FROM jsonb_array_elements(s->'history') WHERE value->>'key'=h->>'key';
  IF rh IS NULL THEN RAISE EXCEPTION 'INVALID_STORY_HISTORY_KEY' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(jsonb_agg(a.value->>'id' ORDER BY a.ord),'[]'::jsonb) INTO recipients FROM jsonb_array_elements(actors) WITH ORDINALITY a(value,ord)
  WHERE (rh->'visibility'->>'kind'='world' OR (rh->'visibility'->>'kind'='actors' AND rh->'visibility'->'actorKeys' ? (a.value->>'key')))
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(s->'initialKnowledge') k WHERE k->>'actorKey'=a.value->>'key' AND k->'factKeys' ? (h->>'key'));
  IF h->'allowedActorIds' IS DISTINCT FROM recipients THEN RAISE EXCEPTION 'INVALID_STORY_KNOWLEDGE' USING ERRCODE='23514'; END IF;
  ids='[]'::jsonb;count_expected=0;
  IF s->'knownFactKeys' ? (h->>'key') THEN
   expected_fact=s->'initialFacts'->cursor_index;cursor_index=cursor_index+1;count_expected=count_expected+1;
   IF expected_fact->>'text' IS DISTINCT FROM rh->>'text' OR expected_fact->>'kind' IS DISTINCT FROM 'canonical' OR expected_fact->>'sourceEventId' IS DISTINCT FROM s->>'genesisSource' OR expected_fact->'visibility' IS DISTINCT FROM jsonb_build_object('kind','owner') THEN RAISE EXCEPTION 'INVALID_INITIAL_HISTORY_SOURCE' USING ERRCODE='23514'; END IF;
   ids=ids||jsonb_build_array(expected_fact->>'id');
  END IF;
  IF jsonb_array_length(recipients)>0 THEN
   expected_fact=s->'initialFacts'->cursor_index;cursor_index=cursor_index+1;count_expected=count_expected+1;
   IF expected_fact->>'text' IS DISTINCT FROM rh->>'text' OR expected_fact->>'kind' IS DISTINCT FROM 'canonical' OR expected_fact->>'sourceEventId' IS DISTINCT FROM s->>'genesisSource' OR expected_fact->'visibility' IS DISTINCT FROM jsonb_build_object('kind','actors','actorIds',recipients) THEN RAISE EXCEPTION 'INVALID_INITIAL_HISTORY_SOURCE' USING ERRCODE='23514'; END IF;
   ids=ids||jsonb_build_array(expected_fact->>'id');
  END IF;
  IF h->'factIds' IS DISTINCT FROM ids THEN RAISE EXCEPTION 'INVALID_STORY_FACT_IDS' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF cursor_index<>jsonb_array_length(s->'initialFacts') THEN RAISE EXCEPTION 'UNMAPPED_STORY_HISTORY' USING ERRCODE='23514'; END IF;
 SELECT * INTO b FROM parallel_life.publication_world_bindings WHERE world_id=w AND owner_id=current_setting('app.user_id',true);
 INSERT INTO parallel_life.publication_story_plans(world_id,owner_id,binding_id,document) VALUES(w,b.owner_id,b.id,p);
END $$;
CREATE FUNCTION parallel_life.publication_story_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_STORY_PROVENANCE' USING ERRCODE='23514'; END $$;
CREATE TRIGGER story_plan_immutable BEFORE UPDATE OR DELETE ON parallel_life.publication_story_plans FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_story_immutable();
CREATE TRIGGER story_receipt_immutable BEFORE UPDATE OR DELETE ON parallel_life.publication_story_receipts FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_story_immutable();
CREATE FUNCTION parallel_life.publication_story_node_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF ROW(NEW.world_id,NEW.owner_id,NEW.node_key,NEW.claim_id,NEW.command_id,NEW.actor_id,NEW.expected_version,NEW.story_at,NEW.automatic) IS DISTINCT FROM ROW(OLD.world_id,OLD.owner_id,OLD.node_key,OLD.claim_id,OLD.command_id,OLD.actor_id,OLD.expected_version,OLD.story_at,OLD.automatic)
 OR (OLD.source_event_id IS NOT NULL AND ROW(NEW.source_event_id,NEW.source_message_id,NEW.invitation_id) IS DISTINCT FROM ROW(OLD.source_event_id,OLD.source_message_id,OLD.invitation_id))
 THEN RAISE EXCEPTION 'IMMUTABLE_STORY_CLAIM' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER story_claim_immutable BEFORE UPDATE ON parallel_life.publication_story_nodes FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_story_node_identity();
CREATE FUNCTION parallel_life.publication_story_node_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 IF NEW.status='presented' AND (n->'intent'->>'kind'<>'offer_message' OR NEW.outcome IS DISTINCT FROM 'committed') THEN RAISE EXCEPTION 'INVALID_STORY_PRESENTATION' USING ERRCODE='23514'; END IF;
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
CREATE CONSTRAINT TRIGGER story_node_source AFTER INSERT OR UPDATE ON parallel_life.publication_story_nodes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_story_node_source();
REVOKE ALL ON FUNCTION parallel_life.publication_story_source(text),parallel_life.publication_story_store_plan(text,jsonb),parallel_life.publication_story_clock(text),parallel_life.publication_story_immutable(),parallel_life.publication_story_node_identity(),parallel_life.publication_story_node_source() FROM PUBLIC,pl_worker,pl_publisher,pl_app;
GRANT EXECUTE ON FUNCTION parallel_life.publication_story_source(text),parallel_life.publication_story_store_plan(text,jsonb),parallel_life.publication_story_clock(text) TO pl_app;

-- A lease-scoped worker can read a current offered fragment, never plans or unpublished future nodes.
CREATE FUNCTION parallel_life.publication_story_offer_context(w text,o text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE caller text; BEGIN
 caller=CASE WHEN COALESCE(current_setting('role',true),'none')='none' THEN session_user ELSE current_setting('role',true) END;
 IF pg_has_role(caller,'pl_app','MEMBER') THEN
  IF o IS DISTINCT FROM current_setting('app.user_id',true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 ELSIF pg_has_role(caller,'pl_worker','MEMBER') THEN
  IF o IS DISTINCT FROM current_setting('app.user_id',true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM parallel_life.tasks t WHERE t.id::text=current_setting('app.task_id',true) AND t.lease_token::text=current_setting('app.lease_token',true) AND t.owner_id=o AND t.scope_kind='world' AND t.scope_id=w AND t.status='running' AND t.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('nodeKey',s.node_key,'editorialIntent',CASE WHEN scene_gate.allowed AND opportunity.allowed THEN n.value->>'editorialIntent' ELSE NULL END,'sceneEligible',scene_gate.allowed AND opportunity.allowed,'actorIds',jsonb_build_array(s.actor_id),'placeId',place.value->>'key','placeName',place.value->>'name','invitationId',s.invitation_id,'sourceEventId',s.source_event_id) ORDER BY s.node_key),'[]'::jsonb)
 FROM parallel_life.publication_story_nodes s
 JOIN parallel_life.publication_story_plans p ON p.world_id=s.world_id AND p.owner_id=s.owner_id
 JOIN parallel_life.publication_world_bindings b ON b.id=p.binding_id AND b.world_id=s.world_id AND b.owner_id=s.owner_id
 JOIN LATERAL jsonb_array_elements(p.document->'nodes') n(value) ON n.value->>'key'=s.node_key
 JOIN LATERAL jsonb_array_elements(p.document->'places') place(value) ON place.value->>'key'=n.value->'intent'->>'placeKey'
 JOIN parallel_life.world_events e ON e.world_id=s.world_id AND e.owner_id=s.owner_id AND e.id=s.source_event_id AND e.command_id=s.command_id::text AND e.payload->'data'->>'actorId'=s.actor_id
 JOIN parallel_life.commands c ON c.id=e.command_id AND c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.status='succeeded' AND c.result_event_id=e.id
 JOIN parallel_life.world_appointments a ON a.id=s.invitation_id AND a.world_id=s.world_id AND a.owner_id=s.owner_id AND a.document->>'sourceEventId'=e.id AND a.document->'participantIds'=jsonb_build_array(s.actor_id)
 LEFT JOIN LATERAL (SELECT LEAST((n.value->'timeline'->'window'->>'expiresAt')::timestamptz,(SELECT (stage->'window'->>'expiresAt')::timestamptz FROM jsonb_array_elements(COALESCE(p.document->'timeline'->'stages','[]'::jsonb)) stage WHERE stage->>'key'=n.value->'timeline'->>'stageKey')) AS expires_at) deadline ON true
 LEFT JOIN LATERAL (SELECT (deadline.expires_at IS NULL OR s.status='committed' OR parallel_life.publication_story_clock(w)<deadline.expires_at OR EXISTS(SELECT 1 FROM parallel_life.world_events r JOIN parallel_life.commands rc ON rc.id=r.command_id AND rc.world_id=r.world_id AND rc.owner_id=r.owner_id AND rc.status='succeeded' AND rc.result_event_id=r.id WHERE r.world_id=s.world_id AND r.owner_id=s.owner_id AND r.payload->>'type'='invitation.responded' AND r.payload->'data'->>'id'=s.invitation_id AND r.payload->'data'->>'operation' IN ('accept','attend') AND (r.payload->>'storyTime')::timestamptz<deadline.expires_at)) AS allowed) opportunity ON true
 LEFT JOIN LATERAL (SELECT (NOT EXISTS(SELECT 1 FROM parallel_life.scene_sessions ss WHERE ss.world_id=s.world_id AND ss.owner_id=s.owner_id) OR EXISTS(SELECT 1 FROM parallel_life.scene_sessions ss JOIN parallel_life.player_experiences pe ON pe.world_id=ss.world_id AND pe.owner_id=ss.owner_id AND pe.current_scene_id=ss.id WHERE ss.world_id=s.world_id AND ss.owner_id=s.owner_id AND ss.document->>'appointmentId'=s.invitation_id AND ss.document->>'status'='active')) AS allowed) scene_gate ON true
 LEFT JOIN LATERAL (SELECT r.payload->'data'->>'operation' AS operation FROM parallel_life.world_events r JOIN parallel_life.commands rc ON rc.id=r.command_id AND rc.world_id=r.world_id AND rc.owner_id=r.owner_id AND rc.status='succeeded' AND rc.result_event_id=r.id WHERE r.world_id=s.world_id AND r.owner_id=s.owner_id AND r.payload->>'type'='invitation.responded' AND r.payload->'data'->>'id'=s.invitation_id ORDER BY r.version DESC LIMIT 1) response ON true
 WHERE s.world_id=w AND s.owner_id=o AND s.status IN ('offered','committed') AND n.value->'intent'->>'kind'='offer_invitation'
 AND p.document->'origin'=jsonb_build_object('workId',b.work_id,'publicationVersion',COALESCE(b.publication_version,0),'draftVersion',b.draft_version,'contentHash',b.content_hash)
 AND COALESCE(response.operation,'') NOT IN ('cancel','miss'));
END $$;
REVOKE ALL ON FUNCTION parallel_life.publication_story_offer_context(text,text) FROM PUBLIC,pl_publisher,pl_app,pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.publication_story_offer_context(text,text) TO pl_app,pl_worker;
