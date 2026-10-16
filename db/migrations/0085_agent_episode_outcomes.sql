-- Explicit bounded event outcomes; no completion from messages, plans, travel or model assertions.
CREATE TABLE parallel_life.agent_episode_outcomes (
 world_id text NOT NULL,owner_id text NOT NULL,id text NOT NULL,episode_id text NOT NULL,
 engine_epoch integer NOT NULL CHECK(engine_epoch>=2),node_key text NOT NULL,
 source_origin jsonb NOT NULL,node_document jsonb NOT NULL,policy jsonb NOT NULL,
 evidence_ids jsonb NOT NULL,source_event_id text NOT NULL,world_version integer NOT NULL CHECK(world_version>0),
 story_at text NOT NULL,scope text NOT NULL CHECK(scope='invitation_response'),outcome text NOT NULL CHECK(outcome='committed'),
 PRIMARY KEY(world_id,id),UNIQUE(world_id,engine_epoch,episode_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,episode_id) REFERENCES parallel_life.shared_episodes(world_id,id),
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id),
 CHECK(jsonb_typeof(evidence_ids)='array' AND jsonb_array_length(evidence_ids)>0 AND jsonb_array_length(evidence_ids)<=8
   AND jsonb_typeof(node_document)='object' AND octet_length(node_document::text)<=131072)
);
ALTER TABLE parallel_life.agent_episode_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_episode_outcomes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_episode_outcomes FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY episode_outcome_owner ON parallel_life.agent_episode_outcomes TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT ON parallel_life.agent_episode_outcomes TO pl_app;
CREATE FUNCTION parallel_life.guard_agent_episode_outcome() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE src jsonb; node jsonb; crit jsonb; hit boolean; passed integer:=0; total integer:=0; BEGIN
 SELECT parallel_life.publication_story_source(NEW.world_id) INTO src;
 SELECT n INTO node FROM jsonb_array_elements(src->'nodes') n WHERE n->>'key'=NEW.node_key;
 IF src IS NULL OR node IS NULL OR node IS DISTINCT FROM NEW.node_document OR src->'origin' IS DISTINCT FROM NEW.source_origin
  OR node->'direction'->'progress'->'completion' IS DISTINCT FROM NEW.policy
  OR NEW.policy->>'scope' IS DISTINCT FROM 'invitation_response'
  OR NEW.policy->>'mode' NOT IN ('all','any')
  OR jsonb_typeof(NEW.policy->'criteria') IS DISTINCT FROM 'array'
  OR jsonb_array_length(NEW.policy->'criteria')<1 OR jsonb_array_length(NEW.policy->'criteria')>8
  OR NOT EXISTS(SELECT 1 FROM parallel_life.shared_episodes ep
   JOIN parallel_life.director_decisions d ON d.world_id=ep.world_id AND d.owner_id=ep.owner_id AND d.id=ep.origin_decision_id,
    LATERAL jsonb_array_elements(d.document->'opportunities') o
   WHERE ep.world_id=NEW.world_id AND ep.owner_id=NEW.owner_id AND ep.id=NEW.episode_id
    AND o->>'id'=ep.id AND o->>'authoredEventKey'=NEW.node_key AND d.engine_epoch=NEW.engine_epoch)
  OR NOT EXISTS(SELECT 1 FROM parallel_life.world_events e JOIN parallel_life.commands c
    ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
    JOIN parallel_life.worlds w ON w.id=e.world_id AND w.owner_id=e.owner_id AND w.version=e.version
    JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=w.id AND rw.owner_id=w.owner_id AND rw.engine_epoch=NEW.engine_epoch
   WHERE e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id AND e.id=NEW.source_event_id AND e.version=NEW.world_version
    AND COALESCE(e.payload->>'storyAt',e.payload->>'storyTime')=NEW.story_at)
 THEN RAISE EXCEPTION 'EPISODE_OUTCOME_AUTHORITY_REQUIRED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(NEW.evidence_ids) id
  WHERE NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_evidence e
   WHERE e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id AND e.episode_id=NEW.episode_id AND e.engine_epoch=NEW.engine_epoch
    AND e.id=id AND e.world_version<=NEW.world_version AND e.subject_kind='appointment' AND e.kind IN ('invitation_accepted','invitation_declined')))
 OR NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_evidence e WHERE e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id
    AND e.episode_id=NEW.episode_id AND e.id IN (SELECT jsonb_array_elements_text(NEW.evidence_ids)) AND e.source_event_id=NEW.source_event_id)
 THEN RAISE EXCEPTION 'EPISODE_OUTCOME_EVIDENCE_REQUIRED' USING ERRCODE='23514'; END IF;
 FOR crit IN SELECT * FROM jsonb_array_elements(NEW.policy->'criteria') LOOP
  total:=total+1;
  IF crit->>'kind' IS DISTINCT FROM 'invitation_response' OR crit->>'response' NOT IN ('accepted','declined')
   THEN RAISE EXCEPTION 'EPISODE_OUTCOME_UNSUPPORTED_POLICY' USING ERRCODE='23514'; END IF;
  SELECT EXISTS(SELECT 1 FROM parallel_life.agent_episode_evidence e WHERE e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id
   AND e.episode_id=NEW.episode_id AND e.engine_epoch=NEW.engine_epoch AND e.id IN (SELECT jsonb_array_elements_text(NEW.evidence_ids))
   AND e.kind=CASE WHEN crit->>'response'='accepted' THEN 'invitation_accepted' ELSE 'invitation_declined' END) INTO hit;
  IF hit THEN passed:=passed+1; END IF;
 END LOOP;
 IF (NEW.policy->>'mode'='all' AND passed<>total) OR passed=0
  THEN RAISE EXCEPTION 'EPISODE_OUTCOME_CRITERIA_NOT_MET' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER episode_outcome_guard BEFORE INSERT ON parallel_life.agent_episode_outcomes
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_agent_episode_outcome();
CREATE TRIGGER episode_outcome_immutable BEFORE UPDATE ON parallel_life.agent_episode_outcomes
 FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();
REVOKE ALL ON FUNCTION parallel_life.guard_agent_episode_outcome() FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;

ALTER TABLE parallel_life.shared_episodes DROP CONSTRAINT shared_episodes_check;
ALTER TABLE parallel_life.shared_episodes ADD CONSTRAINT shared_episodes_check CHECK(
 jsonb_typeof(document)='object' AND octet_length(document::text)<=65536
 AND document ?& ARRAY['schemaVersion','worldId','id','revision','origin','status','title','description','participantActorIds','placeIds','sourceEventIds','resultIds','unresolvedResponsibilityIds']
 AND document - ARRAY['schemaVersion','worldId','id','revision','origin','status','title','description','participantActorIds','placeIds','sourceEventIds','resultIds','unresolvedResponsibilityIds','endReason']='{}'::jsonb
 AND document->'schemaVersion'='1'::jsonb AND (document->>'worldId') IS NOT DISTINCT FROM world_id
 AND (document->>'id') IS NOT DISTINCT FROM id AND jsonb_typeof(document->'revision')='number'
 AND (document->>'revision')::integer>=0
 AND document->>'status' IN ('proposed','active','resolved') AND document->'origin'=jsonb_build_object('kind','director','sourceId',origin_decision_id)
 AND jsonb_typeof(document->'title')='string' AND jsonb_typeof(document->'description')='string'
 AND jsonb_typeof(document->'participantActorIds')='array' AND jsonb_array_length(document->'participantActorIds')>0
 AND jsonb_typeof(document->'placeIds')='array' AND jsonb_typeof(document->'sourceEventIds')='array'
 AND jsonb_typeof(document->'resultIds')='array' AND document->'unresolvedResponsibilityIds'='[]'::jsonb
 AND ((document->>'status'='resolved' AND jsonb_array_length(document->'resultIds')=1 AND document->>'endReason'='author_completion_criteria_met' AND jsonb_array_length(document->'sourceEventIds')>0) OR (document->>'status' IN ('proposed','active') AND document->'resultIds'='[]'::jsonb AND NOT(document?'endReason') AND ((document->>'status'='proposed' AND document->'revision'='0'::jsonb AND document->'sourceEventIds'='[]'::jsonb)
  OR (document->>'status'='active' AND (document->>'revision')::integer>0 AND jsonb_array_length(document->'sourceEventIds')>0))))
);

CREATE OR REPLACE FUNCTION parallel_life.guard_agent_episode_progress() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source_id text; receipt parallel_life.agent_episode_outcomes%ROWTYPE; BEGIN
 IF TG_OP='UPDATE' AND NEW.document->>'status'='resolved' THEN
  SELECT r.* INTO receipt FROM parallel_life.agent_episode_outcomes r
   JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=r.world_id AND rw.owner_id=r.owner_id AND rw.engine_epoch=r.engine_epoch
   WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.episode_id=NEW.id
    AND NEW.document->'resultIds'=jsonb_build_array(r.id);
  IF receipt.id IS NULL OR OLD.document->>'status' NOT IN ('proposed','active')
   OR (NEW.world_id,NEW.owner_id,NEW.id,NEW.origin_decision_id,NEW.created_at) IS DISTINCT FROM (OLD.world_id,OLD.owner_id,OLD.id,OLD.origin_decision_id,OLD.created_at)
   OR (NEW.document-ARRAY['revision','status','sourceEventIds','resultIds','endReason']) IS DISTINCT FROM (OLD.document-ARRAY['revision','status','sourceEventIds','resultIds','endReason'])
   OR (NEW.document->>'revision')::integer<>(OLD.document->>'revision')::integer+1
   OR NEW.document->>'endReason' IS DISTINCT FROM 'author_completion_criteria_met'
   OR NEW.document->'sourceEventIds' IS DISTINCT FROM (CASE WHEN OLD.document->'sourceEventIds' ? receipt.source_event_id THEN OLD.document->'sourceEventIds' ELSE (OLD.document->'sourceEventIds')||jsonb_build_array(receipt.source_event_id) END)
   THEN RAISE EXCEPTION 'INVALID_EPISODE_OUTCOME_PROGRESS' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.document->>'status' IS DISTINCT FROM 'proposed' OR NEW.document->'revision' IS DISTINCT FROM '0'::jsonb
   OR NEW.document->'sourceEventIds' IS DISTINCT FROM '[]'::jsonb
  THEN RAISE EXCEPTION 'EPISODE_INSERT_MUST_BE_PROPOSED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.world_id,NEW.owner_id,NEW.id,NEW.origin_decision_id,NEW.created_at)
  IS DISTINCT FROM (OLD.world_id,OLD.owner_id,OLD.id,OLD.origin_decision_id,OLD.created_at)
  OR (NEW.document-ARRAY['revision','status','sourceEventIds']) IS DISTINCT FROM (OLD.document-ARRAY['revision','status','sourceEventIds'])
  OR (NEW.document->>'revision')::integer<>(OLD.document->>'revision')::integer+1
  OR (NEW.document->>'status')<>'active'
  OR jsonb_array_length(NEW.document->'sourceEventIds')<>jsonb_array_length(OLD.document->'sourceEventIds')+1
  OR NOT((NEW.document->'sourceEventIds') @> (OLD.document->'sourceEventIds'))
 THEN RAISE EXCEPTION 'INVALID_EPISODE_PROGRESS' USING ERRCODE='23514'; END IF;
 SELECT v INTO source_id FROM jsonb_array_elements_text(NEW.document->'sourceEventIds') v
  WHERE NOT(OLD.document->'sourceEventIds' ? v);
 IF source_id IS NULL OR NOT EXISTS(SELECT 1 FROM parallel_life.agent_episode_receipts r
  WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.episode_id=NEW.id AND r.source_event_id=source_id
   AND r.attempt_id=current_setting('app.agent_commit_attempt_id',true) AND r.choice='engage'
   AND jsonb_array_length(r.presented_message_ids)>0)
 THEN RAISE EXCEPTION 'EPISODE_NOT_ACTUALLY_PRESENTED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
