-- Reuse committed participant state; no new ledger or model fields.
CREATE FUNCTION parallel_life.episode_actor_withdrawn(w text,o text,ep text,actor text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 WITH participant AS (
 SELECT q.id,er.choice,s.document AS state FROM parallel_life.agent_episode_requests q
 JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=q.world_id AND rw.owner_id=q.owner_id AND rw.engine_epoch=q.engine_epoch
 JOIN parallel_life.agent_episode_receipts er ON er.world_id=q.world_id AND er.owner_id=q.owner_id AND er.id=q.receipt_id AND er.request_id=q.id AND er.actor_id=q.actor_id
 JOIN parallel_life.agent_attempts a ON a.world_id=er.world_id AND a.owner_id=er.owner_id AND a.id=er.attempt_id AND a.engine_epoch=q.engine_epoch AND a.status='committed'
 JOIN parallel_life.actor_agent_states s ON s.world_id=q.world_id AND s.owner_id=q.owner_id AND s.actor_id=q.actor_id
 WHERE q.world_id=w AND q.owner_id=o AND q.episode_id=ep AND q.actor_id=actor AND q.status='consumed'
 ), direct_goals AS (
 SELECT g FROM participant p CROSS JOIN LATERAL jsonb_array_elements(p.state->'goals') g WHERE g->'sourceIds' ? ('episode-intent:'||p.id)
 ), plans AS (
 SELECT plan FROM participant p CROSS JOIN LATERAL jsonb_array_elements(p.state->'plans') plan
 WHERE plan->'sourceIds' ? ('episode-intent:'||p.id) OR plan->>'goalId' IN (SELECT g->>'id' FROM direct_goals)
 ), goals AS (
 SELECT g FROM participant p CROSS JOIN LATERAL jsonb_array_elements(p.state->'goals') g
 WHERE g->>'id' IN (SELECT d.g->>'id' FROM direct_goals d) OR g->>'id' IN (SELECT plan->>'goalId' FROM plans)
 ), responsibilities AS (
 SELECT r FROM participant p CROSS JOIN LATERAL jsonb_array_elements(p.state->'responsibilities') r
 WHERE r->'sourceIds' ? ('episode-intent:'||p.id) OR r->'subject'=jsonb_build_object('kind','episode','id',ep) OR r->'subject'=jsonb_build_object('kind','request','id',p.id)
 ), actions AS (
 SELECT ac FROM participant p CROSS JOIN LATERAL jsonb_array_elements(p.state->'actions') ac
 WHERE ac->'sourceIds' ? ('episode-intent:'||p.id) OR ac->>'goalId' IN (SELECT g->>'id' FROM goals)
 OR EXISTS(SELECT 1 FROM plans WHERE plan->'actionIds' ? (ac->>'id') OR plan->>'nextActionId'=ac->>'id')
 OR EXISTS(SELECT 1 FROM responsibilities WHERE ac->'handlesResponsibilityIds' ? (r->>'id'))
 )
 SELECT (SELECT count(*) FROM participant)=1
 AND EXISTS(SELECT 1 FROM participant WHERE choice='decline' OR (choice='engage' AND (EXISTS(SELECT 1 FROM goals) OR EXISTS(SELECT 1 FROM responsibilities))))
 AND NOT EXISTS(SELECT 1 FROM goals WHERE g->>'status'<>'withdrawn' OR coalesce(trim(g->>'endReason'),'')='')
 AND NOT EXISTS(SELECT 1 FROM plans WHERE plan->>'status'<>'withdrawn')
 AND NOT EXISTS(SELECT 1 FROM responsibilities WHERE r->>'status'<>'withdrawn' OR coalesce(trim(r->>'endReason'),'')='')
 AND NOT EXISTS(SELECT 1 FROM actions WHERE ac->>'status' NOT IN ('succeeded','failed','withdrawn'))
 AND NOT EXISTS(SELECT 1 FROM parallel_life.agent_attempts a JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=a.world_id AND rw.owner_id=a.owner_id AND rw.engine_epoch=a.engine_epoch WHERE a.world_id=w AND a.owner_id=o AND a.actor_id=actor AND a.status IN ('request_sent','response_received','unknown_after_send'))
 AND NOT EXISTS(SELECT 1 FROM parallel_life.npc_journeys j WHERE j.world_id=w AND j.owner_id=o AND j.actor_id=actor AND j.status='in_transit' AND j.departure_action_id IN (SELECT ac->>'id' FROM actions))
 AND NOT EXISTS(
 SELECT 1 FROM parallel_life.agent_action_results ar CROSS JOIN LATERAL jsonb_array_elements(ar.document->'outputRefs') ref
 LEFT JOIN parallel_life.world_media_requests m ON m.world_id=ar.world_id AND m.owner_id=ar.owner_id AND m.id=ref->>'id'
 WHERE ar.world_id=w AND ar.owner_id=o AND ar.actor_id=actor AND ar.action_id IN (SELECT ac->>'id' FROM actions) AND ref->>'kind'='media'
 AND (m.id IS NULL OR m.document->>'status' NOT IN ('ready','failed') OR EXISTS(SELECT 1 FROM parallel_life.outbox_jobs ob WHERE ob.world_id=w AND ob.owner_id=o AND ob.payload->>'requestId'=m.id AND ob.status NOT IN ('succeeded','failed')))
 );
$$;
REVOKE ALL ON FUNCTION parallel_life.episode_actor_withdrawn(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.episode_actor_withdrawn(text,text,text,text) TO pl_app;

-- Extend the existing episode projection; no new tables or fields.
ALTER TABLE parallel_life.shared_episodes DROP CONSTRAINT shared_episodes_check;
ALTER TABLE parallel_life.shared_episodes ADD CONSTRAINT shared_episodes_check CHECK(
 jsonb_typeof(document)='object' AND octet_length(document::text)<=65536
 AND document ?& ARRAY['schemaVersion','worldId','id','revision','origin','status','title','description','participantActorIds','placeIds','sourceEventIds','resultIds','unresolvedResponsibilityIds']
 AND document - ARRAY['schemaVersion','worldId','id','revision','origin','status','title','description','participantActorIds','placeIds','sourceEventIds','resultIds','unresolvedResponsibilityIds','endReason']='{}'::jsonb
 AND document->'schemaVersion'='1'::jsonb AND (document->>'worldId') IS NOT DISTINCT FROM world_id
 AND (document->>'id') IS NOT DISTINCT FROM id AND jsonb_typeof(document->'revision')='number'
 AND (document->>'revision')::integer>=0
 AND document->>'status' IN ('proposed','active','resolved','withdrawn') AND document->'origin'=jsonb_build_object('kind','director','sourceId',origin_decision_id)
 AND jsonb_typeof(document->'title')='string' AND jsonb_typeof(document->'description')='string'
 AND jsonb_typeof(document->'participantActorIds')='array' AND jsonb_array_length(document->'participantActorIds')>0
 AND jsonb_typeof(document->'placeIds')='array' AND jsonb_typeof(document->'sourceEventIds')='array'
 AND jsonb_typeof(document->'resultIds')='array' AND document->'unresolvedResponsibilityIds'='[]'::jsonb
 AND ((document->>'status'='withdrawn' AND document->'resultIds'='[]'::jsonb AND document->>'endReason' IN ('all_participants_declined','all_participants_withdrew') AND (document->>'revision')::integer>0 AND jsonb_array_length(document->'sourceEventIds')>0) OR (document->>'status'='resolved' AND jsonb_array_length(document->'resultIds')=1 AND document->>'endReason'='author_completion_criteria_met' AND jsonb_array_length(document->'sourceEventIds')>0) OR (document->>'status' IN ('proposed','active') AND document->'resultIds'='[]'::jsonb AND NOT(document?'endReason') AND ((document->>'status'='proposed' AND document->'revision'='0'::jsonb AND document->'sourceEventIds'='[]'::jsonb)
  OR (document->>'status'='active' AND (document->>'revision')::integer>0 AND jsonb_array_length(document->'sourceEventIds')>0))))
);

CREATE OR REPLACE FUNCTION parallel_life.guard_agent_episode_progress() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source_id text; receipt parallel_life.agent_episode_outcomes%ROWTYPE; BEGIN
 IF TG_OP='UPDATE' AND NEW.document->>'status'='withdrawn' AND NEW.document->>'endReason'='all_participants_withdrew' THEN
  IF OLD.document->>'status'<>'active'
   OR (NEW.world_id,NEW.owner_id,NEW.id,NEW.origin_decision_id,NEW.created_at) IS DISTINCT FROM (OLD.world_id,OLD.owner_id,OLD.id,OLD.origin_decision_id,OLD.created_at)
   OR (NEW.document-ARRAY['revision','status','sourceEventIds','endReason']) IS DISTINCT FROM (OLD.document-ARRAY['revision','status','sourceEventIds','endReason'])
   OR (NEW.document->>'revision')::integer<>(OLD.document->>'revision')::integer+1
   OR jsonb_array_length(NEW.document->'sourceEventIds')<>jsonb_array_length(OLD.document->'sourceEventIds')+1
   OR NOT((NEW.document->'sourceEventIds') @> (OLD.document->'sourceEventIds'))
  THEN RAISE EXCEPTION 'INVALID_EPISODE_WITHDRAWAL' USING ERRCODE='23514'; END IF;
  SELECT v INTO source_id FROM jsonb_array_elements_text(NEW.document->'sourceEventIds') v WHERE NOT(OLD.document->'sourceEventIds' ? v);
  IF source_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM parallel_life.agent_attempts a
   JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=a.world_id AND rw.owner_id=a.owner_id AND rw.engine_epoch=a.engine_epoch
   JOIN parallel_life.world_events e ON e.world_id=a.world_id AND e.owner_id=a.owner_id AND e.id=a.event_id
   JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
   JOIN parallel_life.actor_agent_states s ON s.world_id=a.world_id AND s.owner_id=a.owner_id AND s.actor_id=a.actor_id
   WHERE a.world_id=NEW.world_id AND a.owner_id=NEW.owner_id AND a.id=current_setting('app.agent_commit_attempt_id',true) AND a.status='committed'
    AND a.event_id=source_id AND OLD.document->'participantActorIds' ? a.actor_id
    AND s.document=e.payload#>'{data,agentRuntime,stateAfter}'
  ) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(OLD.document->'participantActorIds') actor WHERE NOT parallel_life.episode_actor_withdrawn(NEW.world_id,NEW.owner_id,NEW.id,actor))
  THEN RAISE EXCEPTION 'EPISODE_WITHDRAWAL_REQUIRES_ALL_WITHDRAWN' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.document->>'status'='withdrawn' THEN
  IF OLD.document->>'status'<>'proposed'
   OR (NEW.world_id,NEW.owner_id,NEW.id,NEW.origin_decision_id,NEW.created_at) IS DISTINCT FROM (OLD.world_id,OLD.owner_id,OLD.id,OLD.origin_decision_id,OLD.created_at)
   OR (NEW.document-ARRAY['revision','status','sourceEventIds','endReason']) IS DISTINCT FROM (OLD.document-ARRAY['revision','status','sourceEventIds','endReason'])
   OR (NEW.document->>'revision')::integer<>(OLD.document->>'revision')::integer+1
   OR NEW.document->>'endReason' IS DISTINCT FROM 'all_participants_declined'
   OR jsonb_array_length(NEW.document->'sourceEventIds')<>jsonb_array_length(OLD.document->'sourceEventIds')+1
   OR NOT((NEW.document->'sourceEventIds') @> (OLD.document->'sourceEventIds'))
  THEN RAISE EXCEPTION 'INVALID_EPISODE_WITHDRAWAL' USING ERRCODE='23514'; END IF;
  SELECT v INTO source_id FROM jsonb_array_elements_text(NEW.document->'sourceEventIds') v WHERE NOT(OLD.document->'sourceEventIds' ? v);
  IF source_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM parallel_life.agent_episode_receipts r
   JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=r.world_id AND rw.owner_id=r.owner_id
   JOIN parallel_life.agent_attempts a ON a.id=r.attempt_id AND a.world_id=r.world_id AND a.owner_id=r.owner_id AND a.engine_epoch=rw.engine_epoch AND a.status='committed'
   WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.episode_id=NEW.id
    AND r.source_event_id=source_id AND r.choice='decline' AND r.attempt_id=current_setting('app.agent_commit_attempt_id',true)
  ) OR EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(OLD.document->'participantActorIds') AS participant(actor_id)
   WHERE NOT EXISTS(
    SELECT 1 FROM parallel_life.agent_episode_requests q
    JOIN parallel_life.agent_episode_receipts r ON r.world_id=q.world_id AND r.owner_id=q.owner_id AND r.id=q.receipt_id AND r.request_id=q.id AND r.actor_id=q.actor_id
    JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=q.world_id AND rw.owner_id=q.owner_id AND rw.engine_epoch=q.engine_epoch
    JOIN parallel_life.agent_attempts a ON a.id=r.attempt_id AND a.world_id=r.world_id AND a.owner_id=r.owner_id AND a.engine_epoch=rw.engine_epoch AND a.status='committed'
    WHERE q.world_id=NEW.world_id AND q.owner_id=NEW.owner_id AND q.episode_id=NEW.id AND q.actor_id=participant.actor_id
     AND q.status='consumed' AND r.choice='decline'
   )
  ) THEN RAISE EXCEPTION 'EPISODE_WITHDRAWAL_REQUIRES_ALL_DECLINED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
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
