-- Keep existing withdrawal authority while accepting explicitly closed standalone plans.
-- Reuse committed participant state; no new ledger or model fields.
CREATE OR REPLACE FUNCTION parallel_life.episode_actor_withdrawn(w text,o text,ep text,actor text) RETURNS boolean
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
 AND EXISTS(SELECT 1 FROM participant WHERE choice='decline' OR (choice='engage' AND (EXISTS(SELECT 1 FROM goals) OR EXISTS(SELECT 1 FROM responsibilities) OR EXISTS(
 SELECT 1 FROM plans WHERE plan->>'status'='withdrawn'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(plan->'missingConditions') reason WHERE trim(reason)<>'')
 AND NOT EXISTS(SELECT 1 FROM participant p CROSS JOIN LATERAL jsonb_array_elements(p.state->'plans') replacement
 WHERE replacement->>'supersedesPlanId'=plan->>'id')))))
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
