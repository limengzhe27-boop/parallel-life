-- Additive correction: real queue transactions carry a lease, not an app identity.
-- Retain historical actual-offer place provenance; only current valid scene directions are readable.
CREATE OR REPLACE FUNCTION parallel_life.publication_story_offer_context(w text,o text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE caller text; BEGIN
 caller=CASE WHEN COALESCE(current_setting('role',true),'none')='none' THEN session_user ELSE current_setting('role',true) END;
 IF pg_has_role(caller,'pl_app','MEMBER') THEN
  IF o IS DISTINCT FROM current_setting('app.user_id',true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 ELSIF pg_has_role(caller,'pl_worker','MEMBER') THEN
  IF NOT EXISTS(SELECT 1 FROM parallel_life.tasks t WHERE t.id::text=current_setting('app.task_id',true) AND t.lease_token::text=current_setting('app.lease_token',true) AND t.owner_id=o AND t.scope_kind='world' AND t.scope_id=w AND t.status='running' AND t.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('nodeKey',s.node_key,'editorialIntent',CASE WHEN scene_gate.allowed AND opportunity.allowed AND current_offer.allowed THEN n.value->>'editorialIntent' ELSE NULL END,'sceneEligible',scene_gate.allowed AND opportunity.allowed AND current_offer.allowed,'actorIds',jsonb_build_array(s.actor_id),'placeId',place.value->>'key','placeName',place.value->>'name','invitationId',s.invitation_id,'sourceEventId',s.source_event_id) ORDER BY s.node_key),'[]'::jsonb)
 FROM parallel_life.publication_story_nodes s
 JOIN parallel_life.publication_story_plans p ON p.world_id=s.world_id AND p.owner_id=s.owner_id
 JOIN parallel_life.publication_world_bindings b ON b.id=p.binding_id AND b.world_id=s.world_id AND b.owner_id=s.owner_id
 JOIN LATERAL jsonb_array_elements(p.document->'nodes') n(value) ON n.value->>'key'=s.node_key
 JOIN LATERAL jsonb_array_elements(p.document->'places') place(value) ON place.value->>'key'=n.value->'intent'->>'placeKey'
 JOIN parallel_life.world_events e ON e.world_id=s.world_id AND e.owner_id=s.owner_id AND e.id=s.source_event_id AND e.command_id=s.command_id::text AND e.payload->'data'->>'actorId'=s.actor_id
 JOIN parallel_life.commands c ON c.id=e.command_id AND c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.status='succeeded' AND c.result_event_id=e.id
 JOIN parallel_life.world_appointments a ON a.id=s.invitation_id AND a.world_id=s.world_id AND a.owner_id=s.owner_id AND a.document->>'sourceEventId'=e.id AND a.document->'participantIds'=jsonb_build_array(s.actor_id)
 LEFT JOIN LATERAL (SELECT GREATEST((x.state->>'time')::timestamptz,c.story_now+CASE WHEN c.paused THEN interval '0' ELSE GREATEST(EXTRACT(EPOCH FROM now()-c.last_tick_at),0)*c.speed*interval '1 second' END) AS story_now FROM parallel_life.worlds x JOIN parallel_life.world_clock c ON c.world_id=x.id AND c.owner_id=x.owner_id WHERE x.id=w AND x.owner_id=o) authorized_clock ON true
 LEFT JOIN LATERAL (SELECT LEAST((n.value->'timeline'->'window'->>'expiresAt')::timestamptz,(SELECT (stage->'window'->>'expiresAt')::timestamptz FROM jsonb_array_elements(COALESCE(p.document->'timeline'->'stages','[]'::jsonb)) stage WHERE stage->>'key'=n.value->'timeline'->>'stageKey')) AS expires_at) deadline ON true
 LEFT JOIN LATERAL (SELECT (deadline.expires_at IS NULL OR s.status='committed' OR authorized_clock.story_now<deadline.expires_at OR EXISTS(SELECT 1 FROM parallel_life.world_events r JOIN parallel_life.commands rc ON rc.id=r.command_id AND rc.world_id=r.world_id AND rc.owner_id=r.owner_id AND rc.status='succeeded' AND rc.result_event_id=r.id WHERE r.world_id=s.world_id AND r.owner_id=s.owner_id AND r.payload->>'type'='invitation.responded' AND r.payload->'data'->>'id'=s.invitation_id AND r.payload->'data'->>'operation' IN ('accept','attend') AND (r.payload->>'storyTime')::timestamptz<deadline.expires_at)) AS allowed) opportunity ON true
 LEFT JOIN LATERAL (SELECT (NOT EXISTS(SELECT 1 FROM parallel_life.scene_sessions ss WHERE ss.world_id=s.world_id AND ss.owner_id=s.owner_id) OR EXISTS(SELECT 1 FROM parallel_life.scene_sessions ss JOIN parallel_life.player_experiences pe ON pe.world_id=ss.world_id AND pe.owner_id=ss.owner_id AND pe.current_scene_id=ss.id WHERE ss.world_id=s.world_id AND ss.owner_id=s.owner_id AND ss.document->>'appointmentId'=s.invitation_id AND ss.document->>'status'='active')) AS allowed) scene_gate ON true
 LEFT JOIN LATERAL (SELECT r.payload->'data'->>'operation' AS operation FROM parallel_life.world_events r JOIN parallel_life.commands rc ON rc.id=r.command_id AND rc.world_id=r.world_id AND rc.owner_id=r.owner_id AND rc.status='succeeded' AND rc.result_event_id=r.id WHERE r.world_id=s.world_id AND r.owner_id=s.owner_id AND r.payload->>'type'='invitation.responded' AND r.payload->'data'->>'id'=s.invitation_id ORDER BY r.version DESC LIMIT 1) response ON true
 LEFT JOIN LATERAL (SELECT (s.status IN ('offered','committed') AND COALESCE(response.operation,'') NOT IN ('cancel','miss')) AS allowed) current_offer ON true
 WHERE s.world_id=w AND s.owner_id=o AND s.source_event_id IS NOT NULL AND s.invitation_id IS NOT NULL AND n.value->'intent'->>'kind'='offer_invitation'
 AND p.document->'origin'=jsonb_build_object('workId',b.work_id,'publicationVersion',COALESCE(b.publication_version,0),'draftVersion',b.draft_version,'contentHash',b.content_hash));
END $$;
REVOKE ALL ON FUNCTION parallel_life.publication_story_offer_context(text,text) FROM PUBLIC,pl_publisher,pl_app,pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.publication_story_offer_context(text,text) TO pl_app,pl_worker;
