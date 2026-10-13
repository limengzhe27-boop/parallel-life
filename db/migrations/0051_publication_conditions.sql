-- Named author conditions remain bound to the exact immutable publication source.
CREATE OR REPLACE FUNCTION parallel_life.publication_story_source(w text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b parallel_life.publication_world_bindings%ROWTYPE; d jsonb; initial jsonb; opening jsonb; BEGIN
 SELECT * INTO b FROM parallel_life.publication_world_bindings WHERE world_id=w AND owner_id=current_setting('app.user_id',true);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT r.content INTO d FROM parallel_life.publication_draft_revisions r WHERE r.work_id=b.work_id AND r.version=b.draft_version AND r.content_hash=b.content_hash;
 IF b.kind='published_work' AND NOT EXISTS(SELECT 1 FROM parallel_life.publication_versions v WHERE v.work_id=b.work_id AND v.version=b.publication_version AND v.draft_version=b.draft_version AND v.content_hash=b.content_hash AND v.content=d) THEN RAISE EXCEPTION 'INVALID_STORY_SOURCE' USING ERRCODE='23514'; END IF;
 SELECT s.state,wb.opening INTO initial,opening FROM parallel_life.world_initial_snapshots s JOIN parallel_life.world_builds wb ON wb.world_id=s.world_id AND wb.owner_id=s.owner_id AND wb.seed_id=b.seed_id WHERE s.world_id=w AND s.owner_id=b.owner_id;
 IF d IS NULL OR initial IS NULL OR opening->'origin' IS DISTINCT FROM jsonb_build_object('workId',b.work_id,'publicationVersion',COALESCE(b.publication_version,0),'draftVersion',b.draft_version,'contentHash',b.content_hash) THEN RAISE EXCEPTION 'INVALID_STORY_SOURCE' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('origin',opening->'origin','timeline',d->'timeline','nodes',d->'candidates','conditions',COALESCE(d->'conditions','[]'::jsonb),
 'actorKeys',(SELECT jsonb_agg(a->>'key') FROM jsonb_array_elements(d->'actors') a),
 'history',d->'history','knownFactKeys',d->'protagonist'->'knownFactKeys','initialKnowledge',d->'initialKnowledge',
 'contacts',(SELECT jsonb_agg(jsonb_build_object('actorKey',a->>'actorKey','actorId',a->>'actorId')) FROM jsonb_array_elements(opening->'contacts') a),
 'initialActorIds',(SELECT jsonb_agg(a->>'id') FROM jsonb_array_elements(initial->'actors') a),
 'initialFacts',initial->'facts','initialPlaceKeys',(SELECT jsonb_agg(a->>'id') FROM jsonb_array_elements(initial->'space'->'places') a),
 'places',(SELECT jsonb_agg(jsonb_build_object('key',a->>'key','name',a->>'name')) FROM jsonb_array_elements(d->'places') a),
 'genesisSource','publication-genesis:'||w);
END $$;
CREATE OR REPLACE FUNCTION parallel_life.publication_story_store_plan(w text,p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s jsonb;b parallel_life.publication_world_bindings%ROWTYPE;actors jsonb;places jsonb;h jsonb;rh jsonb;recipients jsonb;ids jsonb;expected_fact jsonb;cursor_index integer=0;count_expected integer; BEGIN
 s=parallel_life.publication_story_source(w);
 IF s IS NULL OR p->'origin' IS DISTINCT FROM s->'origin' OR p->'nodes' IS DISTINCT FROM s->'nodes' OR p->'timeline' IS DISTINCT FROM s->'timeline'
  OR COALESCE(p->'conditions','[]'::jsonb) IS DISTINCT FROM s->'conditions'
  OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR p-ARRAY['schemaVersion','origin','timeline','nodes','actors','places','history','conditions']<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_STORY_PLAN' USING ERRCODE='23514'; END IF;
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
