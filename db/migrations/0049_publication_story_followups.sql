-- Later player dialogue can supply actual invitation evidence without rewriting the original claim.
CREATE TABLE parallel_life.publication_story_followups (
 world_id text NOT NULL, owner_id text NOT NULL, node_key text NOT NULL,
 source_event_id text NOT NULL, source_message_id text NOT NULL, invitation_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,node_key), UNIQUE(world_id,invitation_id),
 FOREIGN KEY(world_id,owner_id,node_key) REFERENCES parallel_life.publication_story_nodes(world_id,owner_id,node_key),
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id)
);
ALTER TABLE parallel_life.publication_story_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.publication_story_followups FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_story_followup ON parallel_life.publication_story_followups TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
REVOKE ALL ON parallel_life.publication_story_followups FROM PUBLIC,pl_app,pl_worker,pl_publisher;
GRANT SELECT,INSERT ON parallel_life.publication_story_followups TO pl_app;
CREATE TRIGGER story_followup_immutable BEFORE UPDATE OR DELETE ON parallel_life.publication_story_followups
 FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_story_immutable();
-- Current outcomes are derived from actual replies; followup rows never invent completion.
CREATE FUNCTION parallel_life.publication_story_followup_outcome(w text,o text,k text) RETURNS text
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN s.outcome IS NOT NULL THEN s.outcome
 WHEN f.node_key IS NULL THEN NULL
 WHEN response.op='cancel' THEN 'declined' WHEN response.op='miss' THEN 'expired'
 WHEN response.op IN ('accept','attend') AND (deadline.hi IS NULL OR response.at<deadline.hi) THEN 'committed'
 WHEN deadline.hi IS NOT NULL AND parallel_life.publication_story_clock(w)>=deadline.hi THEN 'expired' ELSE NULL END
 FROM parallel_life.publication_story_nodes s
 JOIN parallel_life.publication_story_plans p ON p.world_id=s.world_id AND p.owner_id=s.owner_id
 JOIN LATERAL jsonb_array_elements(p.document->'nodes') n(value) ON n.value->>'key'=s.node_key
 LEFT JOIN parallel_life.publication_story_followups f ON f.world_id=s.world_id AND f.owner_id=s.owner_id AND f.node_key=s.node_key
 LEFT JOIN LATERAL (SELECT LEAST((n.value->'timeline'->'window'->>'expiresAt')::timestamptz,(SELECT (stage->'window'->>'expiresAt')::timestamptz FROM jsonb_array_elements(COALESCE(p.document->'timeline'->'stages','[]'::jsonb)) stage WHERE stage->>'key'=n.value->'timeline'->>'stageKey')) hi) deadline ON true
 LEFT JOIN LATERAL (SELECT GREATEST((world.state->>'time')::timestamptz,clock.story_now+CASE WHEN clock.paused THEN interval '0' ELSE GREATEST(EXTRACT(EPOCH FROM now()-clock.last_tick_at),0)*clock.speed*interval '1 second' END) story_now FROM parallel_life.worlds world JOIN parallel_life.world_clock clock ON clock.world_id=world.id AND clock.owner_id=world.owner_id WHERE world.id=s.world_id AND world.owner_id=s.owner_id) authorized_time ON true
 LEFT JOIN LATERAL (SELECT r.payload->'data'->>'operation' op,(r.payload->>'storyTime')::timestamptz at FROM parallel_life.world_events r JOIN parallel_life.commands c ON c.id=r.command_id AND c.world_id=r.world_id AND c.owner_id=r.owner_id AND c.status='succeeded' AND c.result_event_id=r.id WHERE r.world_id=s.world_id AND r.owner_id=s.owner_id AND r.payload->>'type'='invitation.responded' AND r.payload->'data'->>'id'=f.invitation_id ORDER BY r.version DESC LIMIT 1) response ON true
 WHERE s.world_id=w AND s.owner_id=o AND s.node_key=k AND o=current_setting('app.user_id',true);
$$;
REVOKE ALL ON FUNCTION parallel_life.publication_story_followup_outcome(text,text,text) FROM PUBLIC,pl_app,pl_worker,pl_publisher;

CREATE FUNCTION parallel_life.publication_story_followup_valid(w text,o text,k text,ev text,msg text,inv text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(
 SELECT 1 FROM parallel_life.publication_story_nodes s
 JOIN parallel_life.publication_story_plans p ON p.world_id=s.world_id AND p.owner_id=s.owner_id
 JOIN parallel_life.publication_world_bindings binding ON binding.id=p.binding_id AND binding.world_id=s.world_id AND binding.owner_id=s.owner_id
 JOIN LATERAL jsonb_array_elements(p.document->'nodes') n(value) ON n.value->>'key'=s.node_key
 LEFT JOIN LATERAL (SELECT stage FROM jsonb_array_elements(COALESCE(p.document->'timeline'->'stages','[]'::jsonb)) stage WHERE stage->>'key'=n.value->'timeline'->>'stageKey') st ON true
 JOIN parallel_life.world_events original ON original.id=s.source_event_id AND original.world_id=s.world_id AND original.owner_id=s.owner_id AND original.command_id=s.command_id::text AND original.version=s.expected_version+1 AND original.payload->>'type'='turn.resolved' AND original.payload->'data'->>'actorId'=s.actor_id
 JOIN parallel_life.commands oc ON oc.id=original.command_id AND oc.world_id=original.world_id AND oc.owner_id=original.owner_id AND oc.status='succeeded' AND oc.result_event_id=original.id
 JOIN parallel_life.world_messages om ON om.id=s.source_message_id AND om.world_id=s.world_id AND om.owner_id=s.owner_id AND om.actor_id=s.actor_id AND om.document->>'actorId'=s.actor_id AND om.document->>'role'='assistant' AND om.document->>'sourceEventId'=original.id AND length(trim(om.document->>'text'))>0
 JOIN parallel_life.world_events e ON e.id=ev AND e.world_id=s.world_id AND e.owner_id=s.owner_id AND e.version>original.version AND e.payload->>'type'='turn.resolved' AND e.payload->'data'->>'actorId'=s.actor_id AND COALESCE(e.payload->'data'->>'origin','player')='player'
 JOIN parallel_life.commands c ON c.id=e.command_id AND c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.status='succeeded' AND c.result_event_id=e.id
 JOIN parallel_life.worlds world ON world.id=s.world_id AND world.owner_id=s.owner_id AND world.version>=e.version
 JOIN parallel_life.world_messages m ON m.id=msg AND m.world_id=s.world_id AND m.owner_id=s.owner_id AND m.actor_id=s.actor_id AND m.document->>'actorId'=s.actor_id AND m.document->>'role'='assistant' AND m.document->>'sourceEventId'=e.id AND length(trim(m.document->>'text'))>0
 JOIN parallel_life.world_messages u ON u.world_id=s.world_id AND u.owner_id=s.owner_id AND u.actor_id=s.actor_id AND u.document->>'actorId'=s.actor_id AND u.document->>'role'='user' AND u.document->>'sourceEventId'=e.id AND length(trim(u.document->>'text'))>0 AND u.ordinal>om.ordinal
 JOIN parallel_life.world_appointments a ON a.id=inv AND a.world_id=s.world_id AND a.owner_id=s.owner_id AND a.document->>'sourceEventId'=e.id AND a.document->'participantIds'=jsonb_build_array(s.actor_id) AND a.document->>'title'=n.value->'intent'->>'title'
 CROSS JOIN LATERAL (SELECT GREATEST((n.value->'timeline'->'window'->>'notBefore')::timestamptz,(st.stage->'window'->>'notBefore')::timestamptz) lo,LEAST((n.value->'timeline'->'window'->>'expiresAt')::timestamptz,(st.stage->'window'->>'expiresAt')::timestamptz) hi,COALESCE(e.payload->>'storyAt',c.result_state->>'time')::timestamptz at,COALESCE(original.payload->>'storyAt',oc.result_state->>'time')::timestamptz original_at) win
 WHERE o=current_setting('app.user_id',true) AND s.world_id=w AND s.owner_id=o AND s.node_key=k AND s.status='failed' AND s.outcome IS NULL AND s.invitation_id IS NULL

 AND NOT EXISTS(SELECT 1 FROM parallel_life.publication_story_nodes other JOIN LATERAL jsonb_array_elements(p.document->'nodes') other_node(value) ON other_node.value->>'key'=other.node_key WHERE other.world_id=w AND other.owner_id=o AND other.node_key<>k AND other.status='failed' AND other.outcome IS NULL AND other.source_event_id IS NOT NULL AND other.actor_id=s.actor_id AND other_node.value->'intent'->>'title'=n.value->'intent'->>'title')
 AND NOT EXISTS(SELECT 1 FROM parallel_life.publication_story_nodes other WHERE other.world_id=w AND other.owner_id=o AND other.node_key<>k AND ((n.value->'mutuallyExclusiveNodeKeys' ? other.node_key AND parallel_life.publication_story_followup_outcome(w,o,other.node_key)='committed') OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(n.value->'timeline'->'excludeIfResolved','[]'::jsonb)) exclusion WHERE exclusion->>'nodeKey'=other.node_key AND exclusion->'outcomes' ? parallel_life.publication_story_followup_outcome(w,o,other.node_key))))
 AND n.value->'intent'->>'kind'='offer_invitation' AND n.value->'intent'->'actorKeys'=jsonb_build_array((SELECT actor->>'key' FROM jsonb_array_elements(p.document->'actors') actor WHERE actor->>'id'=s.actor_id))
 AND p.document->'origin'=jsonb_build_object('workId',binding.work_id,'publicationVersion',COALESCE(binding.publication_version,0),'draftVersion',binding.draft_version,'contentHash',binding.content_hash)
 AND EXISTS(SELECT 1 FROM parallel_life.publication_story_receipts r WHERE r.world_id=s.world_id AND r.owner_id=s.owner_id AND r.node_key=s.node_key AND r.command_id=s.command_id AND r.source_event_id=original.id AND r.kind='failure' AND r.data->>'reason'='no_matching_actual_invitation')
 AND NOT EXISTS(SELECT 1 FROM parallel_life.publication_story_nodes pending WHERE pending.world_id=w AND pending.owner_id=o AND pending.status IN ('claimed','unknown'))
 AND win.at IS NOT NULL AND win.original_at IS NOT NULL AND win.at>=win.original_at
 AND (win.lo IS NULL OR (win.at>=win.lo AND win.original_at>=win.lo)) AND (win.hi IS NULL OR (win.at<win.hi AND win.original_at<win.hi AND parallel_life.publication_story_clock(w)<win.hi)) AND win.at<=parallel_life.publication_story_clock(w)
 AND (a.document->>'at')::timestamptz >= (n.value->'intent'->>'earliestAt')::timestamptz AND (a.document->>'at')::timestamptz>win.at
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'effects') effect WHERE effect->>'type'='appointment.proposed' AND effect->>'id'=inv AND effect->>'title'=a.document->>'title' AND effect->>'at'=a.document->>'at' AND effect->'participantIds'=jsonb_build_array(s.actor_id))
 );
$$;
REVOKE ALL ON FUNCTION parallel_life.publication_story_followup_valid(text,text,text,text,text,text) FROM PUBLIC,pl_worker,pl_publisher;
GRANT EXECUTE ON FUNCTION parallel_life.publication_story_followup_valid(text,text,text,text,text,text) TO pl_app;
CREATE FUNCTION parallel_life.publication_story_followup_source() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.owner_id IS DISTINCT FROM current_setting('app.user_id',true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM parallel_life.worlds WHERE id=NEW.world_id AND owner_id=NEW.owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT parallel_life.publication_story_followup_valid(NEW.world_id,NEW.owner_id,NEW.node_key,NEW.source_event_id,NEW.source_message_id,NEW.invitation_id) THEN RAISE EXCEPTION 'INVALID_STORY_FOLLOWUP' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
REVOKE ALL ON FUNCTION parallel_life.publication_story_followup_source() FROM PUBLIC,pl_app,pl_worker,pl_publisher;
CREATE TRIGGER story_followup_source BEFORE INSERT ON parallel_life.publication_story_followups FOR EACH ROW EXECUTE FUNCTION parallel_life.publication_story_followup_source();

CREATE OR REPLACE FUNCTION parallel_life.publication_story_offer_context(w text,o text) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE caller text; BEGIN
 caller=CASE WHEN COALESCE(current_setting('role',true),'none')='none' THEN session_user ELSE current_setting('role',true) END;
 IF pg_has_role(caller,'pl_app','MEMBER') THEN
  IF o IS DISTINCT FROM current_setting('app.user_id',true) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 ELSIF pg_has_role(caller,'pl_worker','MEMBER') THEN
  IF NOT EXISTS(SELECT 1 FROM parallel_life.tasks t WHERE t.id::text=current_setting('app.task_id',true) AND t.lease_token::text=current_setting('app.lease_token',true) AND t.owner_id=o AND t.scope_kind='world' AND t.scope_id=w AND t.status='running' AND t.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN (WITH effective AS (
 SELECT s.world_id,s.owner_id,s.node_key,s.actor_id,
 COALESCE(f.source_event_id,s.source_event_id) source_event_id,
 COALESCE(f.invitation_id,s.invitation_id) invitation_id,
 COALESCE(fe.command_id,s.command_id::text) command_id,
 CASE WHEN f.node_key IS NULL THEN s.status
      WHEN s.status<>'failed' THEN s.status
      WHEN response.operation IN ('accept','attend') AND (deadline.hi IS NULL OR response.at<deadline.hi) THEN 'committed'
      WHEN response.operation='cancel' THEN 'declined'
      WHEN response.operation='miss' THEN 'expired'
      WHEN deadline.hi IS NOT NULL AND authorized_time.story_now>=deadline.hi THEN 'expired'
      ELSE 'offered' END status
 FROM parallel_life.publication_story_nodes s
 LEFT JOIN parallel_life.publication_story_followups f ON f.world_id=s.world_id AND f.owner_id=s.owner_id AND f.node_key=s.node_key
 LEFT JOIN parallel_life.world_events fe ON fe.id=f.source_event_id AND fe.world_id=s.world_id AND fe.owner_id=s.owner_id
 JOIN parallel_life.publication_story_plans plan ON plan.world_id=s.world_id AND plan.owner_id=s.owner_id
 JOIN LATERAL jsonb_array_elements(plan.document->'nodes') node(value) ON node.value->>'key'=s.node_key
 LEFT JOIN LATERAL (SELECT LEAST((node.value->'timeline'->'window'->>'expiresAt')::timestamptz,(SELECT (stage->'window'->>'expiresAt')::timestamptz FROM jsonb_array_elements(COALESCE(plan.document->'timeline'->'stages','[]'::jsonb)) stage WHERE stage->>'key'=node.value->'timeline'->>'stageKey')) hi) deadline ON true
 LEFT JOIN LATERAL (SELECT GREATEST((world.state->>'time')::timestamptz,clock.story_now+CASE WHEN clock.paused THEN interval '0' ELSE GREATEST(EXTRACT(EPOCH FROM now()-clock.last_tick_at),0)*clock.speed*interval '1 second' END) story_now FROM parallel_life.worlds world JOIN parallel_life.world_clock clock ON clock.world_id=world.id AND clock.owner_id=world.owner_id WHERE world.id=s.world_id AND world.owner_id=s.owner_id) authorized_time ON true
 LEFT JOIN LATERAL (SELECT r.payload->'data'->>'operation' operation,(r.payload->>'storyTime')::timestamptz at FROM parallel_life.world_events r JOIN parallel_life.commands rc ON rc.id=r.command_id AND rc.world_id=r.world_id AND rc.owner_id=r.owner_id AND rc.status='succeeded' AND rc.result_event_id=r.id WHERE r.world_id=s.world_id AND r.owner_id=s.owner_id AND r.payload->>'type'='invitation.responded' AND r.payload->'data'->>'id'=f.invitation_id ORDER BY r.version DESC LIMIT 1) response ON true
) SELECT COALESCE(jsonb_agg(jsonb_build_object('nodeKey',s.node_key,'editorialIntent',CASE WHEN scene_gate.allowed AND opportunity.allowed AND current_offer.allowed THEN n.value->>'editorialIntent' ELSE NULL END,'sceneEligible',scene_gate.allowed AND opportunity.allowed AND current_offer.allowed,'actorIds',jsonb_build_array(s.actor_id),'placeId',place.value->>'key','placeName',place.value->>'name','invitationId',s.invitation_id,'sourceEventId',s.source_event_id) ORDER BY s.node_key),'[]'::jsonb)
 FROM effective s
 JOIN parallel_life.publication_story_plans p ON p.world_id=s.world_id AND p.owner_id=s.owner_id
 JOIN parallel_life.publication_world_bindings b ON b.id=p.binding_id AND b.world_id=s.world_id AND b.owner_id=s.owner_id
 JOIN LATERAL jsonb_array_elements(p.document->'nodes') n(value) ON n.value->>'key'=s.node_key
 JOIN LATERAL jsonb_array_elements(p.document->'places') place(value) ON place.value->>'key'=n.value->'intent'->>'placeKey'
 JOIN parallel_life.world_events e ON e.world_id=s.world_id AND e.owner_id=s.owner_id AND e.id=s.source_event_id AND e.command_id=s.command_id AND e.payload->'data'->>'actorId'=s.actor_id
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
