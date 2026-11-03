-- Formal actor corrections append to the existing ledger; publication editions stay immutable.
CREATE FUNCTION parallel_life.actor_definition_hash(w text,a text,p text,r text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to('['||to_json(w)::text||','||to_json(a)::text||','||to_json(p)::text||','||COALESCE(to_json(r)::text,'null')||']','UTF8')),'hex')
$$;
CREATE FUNCTION parallel_life.actor_definition_source_matches(w text,o text,a text,ref text,v integer) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM parallel_life.world_initial_snapshots i CROSS JOIN LATERAL jsonb_array_elements(i.state->'actors') x
 WHERE i.world_id=w AND i.owner_id=o AND x->>'id'=a
 AND parallel_life.actor_definition_hash(w,a,x->>'persona',x->>'relationship')=ref)
 OR EXISTS(SELECT 1 FROM parallel_life.world_events e JOIN parallel_life.commands c
 ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded'
 AND c.result_event_id=e.id AND c.expected_version=e.version-1
 WHERE e.world_id=w AND e.owner_id=o AND e.version<=v AND e.payload->>'type'='actor.definition_revised'
 AND e.payload#>>'{data,actorId}'=a AND e.payload#>>'{data,definitionRef}'=ref)
$$;
REVOKE ALL ON FUNCTION parallel_life.actor_definition_hash(text,text,text,text),parallel_life.actor_definition_source_matches(text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.actor_definition_hash(text,text,text,text),parallel_life.actor_definition_source_matches(text,text,text,text,integer) TO pl_app;
CREATE FUNCTION parallel_life.guard_actor_definition_revision() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d jsonb; p jsonb; old_actor jsonb; old_persona jsonb; old_state jsonb; c parallel_life.commands%ROWTYPE; current_version integer;
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM parallel_life.worlds WHERE id=OLD.world_id AND owner_id=OLD.owner_id) THEN RETURN OLD; END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN
  IF OLD.payload->>'type'='actor.definition_revised' THEN RAISE EXCEPTION 'IMMUTABLE_ACTOR_DEFINITION_REVISION' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 END IF;
 IF NEW.payload->>'type' IS DISTINCT FROM 'actor.definition_revised' THEN RETURN NEW; END IF;
 d:=NEW.payload->'data';
 SELECT x,w.version INTO old_actor,current_version FROM parallel_life.worlds w
 CROSS JOIN LATERAL jsonb_array_elements(w.state->'actors') x
 WHERE w.id=NEW.world_id AND w.owner_id=NEW.owner_id AND x->>'id'=d->>'actorId';
 SELECT document INTO old_state FROM parallel_life.actor_agent_states WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND actor_id=d->>'actorId';
 SELECT * INTO c FROM parallel_life.commands WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND id=NEW.command_id;
 BEGIN old_persona:=(old_actor->>'persona')::jsonb; EXCEPTION WHEN OTHERS THEN old_persona:=jsonb_build_object('persona',old_actor->>'persona'); END;
 IF jsonb_typeof(old_persona) IS DISTINCT FROM 'object' THEN old_persona:=jsonb_build_object('persona',old_actor->>'persona'); END IF;
 p:=(d->>'persona')::jsonb;
 IF old_actor IS NULL OR old_state IS NULL OR current_version+1 IS DISTINCT FROM NEW.version
 OR NEW.payload->>'id' IS DISTINCT FROM NEW.id OR NEW.payload->>'worldId' IS DISTINCT FROM NEW.world_id
 OR NEW.payload->>'commandId' IS DISTINCT FROM NEW.command_id OR NEW.payload->'version' IS DISTINCT FROM to_jsonb(NEW.version)
 OR NEW.payload->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR c.status IS DISTINCT FROM 'running'
 OR c.expected_version IS DISTINCT FROM current_version
 OR c.request_payload->>'actorId' IS DISTINCT FROM d->>'actorId'
 OR c.request_payload->>'expectedDefinitionRef' IS DISTINCT FROM d->>'previousDefinitionRef'
 OR c.request_payload->'modules' IS DISTINCT FROM p->'modules'
 OR c.request_payload->>'reason' IS DISTINCT FROM d->>'reason'
 OR jsonb_typeof(d->'reason') IS DISTINCT FROM 'string' OR length(trim(d->>'reason')) NOT BETWEEN 1 AND 2000
 OR d->>'previousDefinitionRef' IS DISTINCT FROM old_state->>'definitionRef'
 OR d->>'previousDefinitionRef' IS DISTINCT FROM parallel_life.actor_definition_hash(NEW.world_id,d->>'actorId',old_actor->>'persona',old_actor->>'relationship')
 OR d->>'definitionRef' IS DISTINCT FROM parallel_life.actor_definition_hash(NEW.world_id,d->>'actorId',d->>'persona',old_actor->>'relationship')
 OR d->>'definitionRef' IS NOT DISTINCT FROM d->>'previousDefinitionRef'
 OR d->'actorRevisionBefore' IS DISTINCT FROM old_state->'revision'
 OR d->'actorRevisionAfter' IS DISTINCT FROM to_jsonb((old_state->>'revision')::integer+1)
 OR p-'modules' IS DISTINCT FROM old_persona-'modules'
 OR jsonb_typeof(p->'modules') IS DISTINCT FROM 'object' OR p->'modules'='{}'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_each(p->'modules') x WHERE x.key NOT IN ('lifeContext','traits','drives','behavior','relationships') OR jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}') NOT BETWEEN 1 AND 16384)
 THEN RAISE EXCEPTION 'INVALID_ACTOR_DEFINITION_REVISION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER actor_definition_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON parallel_life.world_events FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_actor_definition_revision();
REVOKE ALL ON FUNCTION parallel_life.guard_actor_definition_revision() FROM PUBLIC;

-- Keep the owner-read nullable contract; leased workers retain scene/actor guards.
CREATE OR REPLACE FUNCTION parallel_life.publication_actor_life_modules(w text,a text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o text; caller text; result jsonb;
BEGIN
 caller:=CASE WHEN COALESCE(current_setting('role',true),'none')='none' THEN session_user ELSE current_setting('role',true) END;
 IF pg_has_role(caller,'pl_app','MEMBER') THEN
  SELECT owner_id INTO o FROM parallel_life.worlds WHERE id=w AND owner_id=current_setting('app.user_id',true);
  IF o IS NULL THEN RETURN NULL; END IF;
 ELSE
  o:=parallel_life.publication_scene_goal_owner(w);
 END IF;
 IF pg_has_role(caller,'pl_worker','MEMBER') AND NOT parallel_life.publication_scene_goal_actor(w,o,a)
 THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT (e.payload#>>'{data,persona}')::jsonb->'modules' INTO result
 FROM parallel_life.world_events e
 JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
  AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=e.version-1
 WHERE e.world_id=w AND e.owner_id=o AND e.payload->>'type'='actor.definition_revised'
  AND e.payload#>>'{data,actorId}'=a ORDER BY e.version DESC LIMIT 1;
 IF result IS NOT NULL THEN RETURN result; END IF;
 SELECT actor->'lifeModules' INTO result FROM parallel_life.publication_world_bindings b
 JOIN LATERAL (
  SELECT d.content FROM parallel_life.publication_draft_revisions d
   WHERE b.kind='trial' AND d.work_id=b.work_id AND d.version=b.draft_version AND d.content_hash=b.content_hash
  UNION ALL
  SELECT v.content FROM parallel_life.publication_versions v
   WHERE b.kind='published_work' AND v.work_id=b.work_id AND v.version=b.publication_version
    AND v.draft_version=b.draft_version AND v.content_hash=b.content_hash
 ) saved ON true
 JOIN parallel_life.world_builds wb ON wb.world_id=b.world_id AND wb.owner_id=b.owner_id AND wb.seed_id=b.seed_id
 JOIN LATERAL jsonb_array_elements(wb.opening->'contacts') contact ON contact->>'actorId'=a
 JOIN LATERAL jsonb_array_elements(saved.content->'actors') actor ON actor->>'key'=contact->>'actorKey'
 WHERE b.world_id=w AND b.owner_id=o;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION parallel_life.guard_agent_episode_request() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE opportunity jsonb; body jsonb; intent jsonb; definition_ref text; BEGIN
 IF TG_OP='INSERT' THEN
  SELECT o INTO opportunity FROM parallel_life.director_decisions d
   JOIN parallel_life.director_runtime_attempts a ON a.id=d.attempt_id AND a.world_id=d.world_id AND a.owner_id=d.owner_id
   JOIN parallel_life.shared_episodes ep ON ep.world_id=d.world_id AND ep.owner_id=d.owner_id AND ep.id=NEW.episode_id AND ep.origin_decision_id=d.id,
   LATERAL jsonb_array_elements(d.document->'opportunities') o
   WHERE d.world_id=NEW.world_id AND d.owner_id=NEW.owner_id AND d.id=NEW.origin_decision_id
    AND d.engine_epoch=NEW.engine_epoch AND d.world_version=NEW.created_at_version
    AND a.status='committed' AND a.decision_id=d.id AND o->>'id'=NEW.episode_id;
  IF opportunity IS NULL OR NOT(opportunity->'participantActorIds' ? NEW.actor_id)
    OR opportunity->>'activity' IS DISTINCT FROM NEW.activity OR NEW.status<>'pending'
    OR NEW.input_receipt_id IS NOT NULL OR NEW.receipt_id IS NOT NULL
  THEN RAISE EXCEPTION 'INVALID_EPISODE_REQUEST_ORIGIN' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.world_id,NEW.owner_id,NEW.id,NEW.actor_id,NEW.episode_id,NEW.origin_decision_id,NEW.engine_epoch,NEW.created_at_version,NEW.activity,NEW.created_at)
   IS DISTINCT FROM (OLD.world_id,OLD.owner_id,OLD.id,OLD.actor_id,OLD.episode_id,OLD.origin_decision_id,OLD.engine_epoch,OLD.created_at_version,OLD.activity,OLD.created_at)
   OR OLD.status='consumed' OR (OLD.input_receipt_id IS NOT NULL AND NEW.input_receipt_id IS DISTINCT FROM OLD.input_receipt_id)
  THEN RAISE EXCEPTION 'IMMUTABLE_EPISODE_REQUEST_BASIS' USING ERRCODE='23514'; END IF;
  IF NEW.input_receipt_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM parallel_life.agent_attempts a
     JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
     JOIN parallel_life.worlds w ON w.id=e.world_id AND w.owner_id=e.owner_id AND w.version=e.version
     WHERE a.world_id=NEW.world_id AND a.owner_id=NEW.owner_id AND a.actor_id=NEW.actor_id
      AND a.id=current_setting('app.agent_commit_attempt_id',true) AND a.status='committed'
      AND a.engine_epoch=NEW.engine_epoch AND a.input_receipt_id=NEW.input_receipt_id
      AND e.version>a.expected_world_version
      AND e.command_id=a.command_id
      AND EXISTS(SELECT 1 FROM parallel_life.commands c
        WHERE c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
          AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version=e.version-1))
   THEN RAISE EXCEPTION 'EPISODE_INPUT_REQUIRES_ACTUAL_COMMIT' USING ERRCODE='23514'; END IF;
   SELECT r.document INTO body FROM parallel_life.agent_input_receipts r WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.id=NEW.input_receipt_id;
   IF body->>'origin'='player' THEN
    IF body->>'channel' IS DISTINCT FROM 'private' OR body->>'recipientActorId' IS DISTINCT FROM NEW.actor_id
     OR body->>'threadId' IS DISTINCT FROM NEW.actor_id OR NOT EXISTS(
      SELECT 1 FROM parallel_life.agent_episode_attempt_bindings b
      JOIN parallel_life.agent_attempts a ON a.world_id=b.world_id AND a.owner_id=b.owner_id AND a.id=b.attempt_id
      WHERE b.world_id=NEW.world_id AND b.owner_id=NEW.owner_id AND b.request_id=NEW.id AND b.actor_id=NEW.actor_id
       AND b.episode_id=NEW.episode_id AND b.engine_epoch=NEW.engine_epoch AND b.input_receipt_id=NEW.input_receipt_id
       AND a.id=current_setting('app.agent_commit_attempt_id',true) AND a.status='committed'
       AND a.response->'snapshot'->'episodeManifest'=b.document
       AND a.response->'snapshot'->'input'->>'text'=body->>'text'
       AND a.response->'snapshot'->'input'->>'origin'='player'
       AND EXISTS(SELECT 1 FROM parallel_life.agent_episode_receipts er WHERE er.world_id=b.world_id
        AND er.owner_id=b.owner_id AND er.attempt_id=a.id AND er.request_id=b.request_id AND er.choice<>'unassessed'))
    THEN RAISE EXCEPTION 'INVALID_PLAYER_EPISODE_BINDING' USING ERRCODE='23514'; END IF;
   ELSE
   intent := (body->>'text')::jsonb;
   SELECT document->>'definitionRef' INTO definition_ref FROM parallel_life.actor_agent_states
    WHERE world_id=NEW.world_id AND owner_id=NEW.owner_id AND actor_id=NEW.actor_id;
   IF body IS NULL OR body->>'origin' IS DISTINCT FROM 'coordination' OR body->>'channel' IS DISTINCT FROM 'private'
    OR body->>'recipientActorId' IS DISTINCT FROM NEW.actor_id OR body->>'threadId' IS DISTINCT FROM NEW.actor_id
    OR jsonb_typeof(intent) IS DISTINCT FROM 'object'
    OR NOT(intent ?& ARRAY['type','requestId','revision','activity','placeOptionIds','basisSourceIds'])
    OR intent-ARRAY['type','requestId','revision','activity','placeOptionIds','basisSourceIds'] IS DISTINCT FROM '{}'::jsonb
    OR intent->>'type' IS DISTINCT FROM 'npc_episode_consideration'
    OR intent->>'requestId' IS DISTINCT FROM NEW.id
    OR intent->>'activity' IS DISTINCT FROM NEW.activity
    OR intent->'revision' IS DISTINCT FROM '0'::jsonb
    -- Initial consideration grants no global venue or director-only source.
    -- Existing memories and known places are assembled independently by the NPC snapshot.
    OR intent->'placeOptionIds' IS DISTINCT FROM '[]'::jsonb
    OR definition_ref IS NULL OR (intent->'basisSourceIds' IS DISTINCT FROM jsonb_build_array('definition:'||definition_ref)
      AND (jsonb_array_length(intent->'basisSourceIds') IS DISTINCT FROM 1 OR (intent#>>'{basisSourceIds,0}') !~ '^definition:[a-f0-9]{64}$' OR NOT parallel_life.actor_definition_source_matches(NEW.world_id,NEW.owner_id,NEW.actor_id,substring(intent#>>'{basisSourceIds,0}' from 12),(body->>'expectedWorldVersion')::integer)))
   THEN RAISE EXCEPTION 'INVALID_EPISODE_REQUEST_INPUT' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
  IF NEW.status='consumed' AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_receipts r
   WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.id=NEW.receipt_id AND r.request_id=NEW.id
    AND r.actor_id=NEW.actor_id AND r.input_receipt_id=NEW.input_receipt_id)
  THEN RAISE EXCEPTION 'INVALID_EPISODE_REQUEST_CONSUMPTION' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
