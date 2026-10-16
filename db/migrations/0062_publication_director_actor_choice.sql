-- Dynamic casting for authored library events; all actual-source and owner checks remain intact.
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
 IF n->'intent'->>'kind'='director_event' AND NOT (n->'intent' ? 'actorKey') THEN
  -- The director may choose one real cast member from this exact authored event.
  -- Choice is bound by the existing immutable actor_id claim; retries never reassign it.
  IF NEW.actor_id IS NULL THEN
   IF NEW.status IN ('claimed','unknown','presented','offered','committed','declined','failed') THEN RAISE EXCEPTION 'STORY_ACTOR_CHOICE_REQUIRED' USING ERRCODE='23514'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'actors') a WHERE a->>'id'=NEW.actor_id AND (jsonb_array_length(COALESCE(n->'actorKeys','[]'::jsonb))=0 OR n->'actorKeys' ? (a->>'key'))) THEN
   RAISE EXCEPTION 'INVALID_STORY_ACTOR' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT a->>'id' INTO expected_actor FROM jsonb_array_elements(p->'actors') a WHERE a->>'key'=COALESCE(n->'intent'->>'actorKey',n->'intent'->'actorKeys'->>0);
  IF NEW.actor_id IS DISTINCT FROM expected_actor OR (n->'intent'->>'kind'='editorial_only' AND NEW.status IN ('claimed','unknown','presented','offered','committed')) THEN RAISE EXCEPTION 'INVALID_STORY_ACTOR' USING ERRCODE='23514'; END IF;
 END IF;
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
