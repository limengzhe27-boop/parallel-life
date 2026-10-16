-- Private, already-introduced story directions for an owner or an actual leased
-- scene worker. The worker never receives the full plan or future candidates.
CREATE FUNCTION parallel_life.publication_scene_goal_owner(w text, require_scene boolean DEFAULT false)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE caller text; o text; t parallel_life.tasks%ROWTYPE; ss parallel_life.scene_sessions%ROWTYPE; ws parallel_life.worlds%ROWTYPE;
BEGIN
 caller:=CASE WHEN COALESCE(current_setting('role',true),'none')='none' THEN session_user ELSE current_setting('role',true) END;
 IF pg_has_role(caller,'pl_app','MEMBER') THEN
  SELECT owner_id INTO o FROM parallel_life.worlds WHERE id=w AND owner_id=current_setting('app.user_id',true);
  IF o IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  RETURN o;
 ELSIF NOT pg_has_role(caller,'pl_worker','MEMBER') THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 SELECT * INTO t FROM parallel_life.tasks WHERE id::text=current_setting('app.task_id',true)
  AND lease_token::text=current_setting('app.lease_token',true) AND status='running'
  AND lease_until>clock_timestamp() AND scope_kind='world' AND scope_id=w AND input->>'type'='scene';
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO ss FROM parallel_life.scene_sessions WHERE id=t.input->>'sceneId' AND world_id=w AND owner_id=t.owner_id AND document->>'status'='active';
 SELECT * INTO ws FROM parallel_life.worlds WHERE id=w AND owner_id=t.owner_id;
 IF ss.id IS NULL OR ws.id IS NULL OR NOT EXISTS(SELECT 1 FROM parallel_life.player_experiences pe
  WHERE pe.world_id=w AND pe.owner_id=t.owner_id AND pe.current_scene_id=ss.id)
  OR (ss.document->>'placeId' IS NOT NULL AND ss.document->>'placeId' IS DISTINCT FROM ws.state->'space'->>'currentPlaceId')
 THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- Worker transactions use a task lease, not a forged or assumed app identity.
 RETURN t.owner_id;
END $$;

CREATE FUNCTION parallel_life.publication_introduced_goal(w text, o text, k text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM parallel_life.publication_story_nodes n
  JOIN parallel_life.worlds x ON x.id=n.world_id AND x.owner_id=n.owner_id
  JOIN parallel_life.world_events e ON e.world_id=n.world_id AND e.owner_id=n.owner_id AND e.id=n.source_event_id
   AND e.command_id=n.command_id::text AND e.version=n.expected_version+1 AND e.version<=x.version
   AND e.payload->>'type'='turn.resolved' AND e.payload->'data'->>'actorId'=n.actor_id
  JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id
  JOIN parallel_life.world_messages m ON m.world_id=n.world_id AND m.owner_id=n.owner_id AND m.id=n.source_message_id AND m.actor_id=n.actor_id
   AND m.document->>'sourceEventId'=e.id AND m.document->>'role'='assistant' AND length(trim(m.document->>'text'))>0
  WHERE n.world_id=w AND n.owner_id=o AND n.node_key=k AND n.status IN ('presented','offered','committed','declined','failed'))
$$;

CREATE FUNCTION parallel_life.publication_scene_goal_actor(w text, o text, a text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a IS NOT NULL AND EXISTS(SELECT 1 FROM parallel_life.worlds x
  WHERE x.id=w AND x.owner_id=o AND EXISTS(SELECT 1 FROM jsonb_array_elements(x.state->'actors') actor WHERE actor->>'id'=a)
  AND (
   EXISTS(SELECT 1 FROM parallel_life.tasks t JOIN parallel_life.scene_sessions ss ON ss.id=t.input->>'sceneId' AND ss.world_id=w AND ss.owner_id=o
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ss.document->'presence','[]'::jsonb)) p
    WHERE t.id::text=current_setting('app.task_id',true) AND p->'participant'->>'kind'='actor' AND p->'participant'->>'actorId'=a
     AND (p->>'joinedVersion')::int<=x.version AND (NOT (p ? 'leftVersion') OR x.version<(p->>'leftVersion')::int))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(x.state->'space'->'places','[]'::jsonb)) place
    WHERE place->>'id'=x.state->'space'->>'currentPlaceId' AND place->'contactActorIds' ? a)
   OR EXISTS(SELECT 1 FROM parallel_life.tasks t JOIN parallel_life.scene_sessions ss ON ss.id=t.input->>'sceneId' AND ss.world_id=w AND ss.owner_id=o
    JOIN parallel_life.world_appointments ap ON ap.world_id=w AND ap.owner_id=o AND ap.id=ss.document->>'appointmentId'
    WHERE t.id::text=current_setting('app.task_id',true) AND ap.document->'participantIds' ? a)
   OR EXISTS(SELECT 1 FROM parallel_life.publication_story_nodes n
    JOIN parallel_life.publication_story_plans plan ON plan.world_id=n.world_id AND plan.owner_id=n.owner_id
    JOIN LATERAL jsonb_array_elements(plan.document->'nodes') node ON node->>'key'=n.node_key
    WHERE n.world_id=w AND n.owner_id=o AND n.actor_id=a AND parallel_life.publication_introduced_goal(w,o,n.node_key)
     AND (node->>'settingPlaceKey'=x.state->'space'->>'currentPlaceId' OR node->>'placeKey'=x.state->'space'->>'currentPlaceId'
      OR node->'scenePlaceKeys' ? (x.state->'space'->>'currentPlaceId') OR node->'intent'->>'placeKey'=x.state->'space'->>'currentPlaceId'))
  ))
$$;

CREATE FUNCTION parallel_life.publication_active_event_goals(w text, a text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o text; caller text; result jsonb;
BEGIN
 o:=parallel_life.publication_scene_goal_owner(w);
 caller:=CASE WHEN COALESCE(current_setting('role',true),'none')='none' THEN session_user ELSE current_setting('role',true) END;
 IF pg_has_role(caller,'pl_worker','MEMBER') AND NOT parallel_life.publication_scene_goal_actor(w,o,a)
 THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'node',node,'origin',plan.document->'origin',
  'actorIdsByKey',(SELECT COALESCE(jsonb_object_agg(contact->>'actorKey',contact->>'actorId'),'{}'::jsonb)
   FROM jsonb_array_elements(wb.opening->'contacts') contact WHERE node->'actorKeys' ? (contact->>'actorKey') OR contact->>'actorId'=n.actor_id),
  'persona',jsonb_build_object('motivation',actor->'privatePersona'->>'motivation','voice',actor->'privatePersona'->>'voice','boundaries',actor->'privatePersona'->>'boundaries'),
  'state',jsonb_build_object('actorId',n.actor_id,'sourceEventId',n.source_event_id,'sourceMessageId',n.source_message_id,
   'status',n.status,'invitationId',n.invitation_id,'expectedVersion',n.expected_version,'storyAt',n.story_at)) ORDER BY n.story_at,n.node_key),'[]'::jsonb)
 INTO result
 FROM parallel_life.publication_story_nodes n
 JOIN parallel_life.publication_story_plans plan ON plan.world_id=n.world_id AND plan.owner_id=n.owner_id
 JOIN parallel_life.publication_world_bindings b ON b.id=plan.binding_id AND b.world_id=w AND b.owner_id=o
 JOIN LATERAL (
  SELECT d.content FROM parallel_life.publication_draft_revisions d
   WHERE b.kind='trial' AND d.work_id=b.work_id AND d.version=b.draft_version AND d.content_hash=b.content_hash
  UNION ALL
  SELECT v.content FROM parallel_life.publication_versions v
   WHERE b.kind='published_work' AND v.work_id=b.work_id AND v.version=b.publication_version
    AND v.draft_version=b.draft_version AND v.content_hash=b.content_hash
 ) saved ON true
 JOIN parallel_life.world_builds wb ON wb.world_id=w AND wb.owner_id=o AND wb.seed_id=b.seed_id
 JOIN LATERAL jsonb_array_elements(plan.document->'nodes') node ON node->>'key'=n.node_key
 JOIN LATERAL jsonb_array_elements(wb.opening->'contacts') own_contact ON own_contact->>'actorId'=n.actor_id
 JOIN LATERAL jsonb_array_elements(saved.content->'actors') actor ON actor->>'key'=own_contact->>'actorKey'
 WHERE n.world_id=w AND n.owner_id=o AND (a IS NULL OR n.actor_id=a)
  AND parallel_life.publication_introduced_goal(w,o,n.node_key)
  AND NOT EXISTS(SELECT 1 FROM parallel_life.memory_records m WHERE m.owner_id=o AND m.branch_id=w AND m.status='forgotten' AND (m.character_id=n.actor_id OR (m.scope_type='branch' AND m.scope_id=w AND m.kind<>'episode'))
   AND (m.source_ids ? n.source_event_id OR m.source_ids ? n.source_message_id))
  AND plan.document->'origin'=jsonb_build_object('workId',b.work_id,'publicationVersion',COALESCE(b.publication_version,0),'draftVersion',b.draft_version,'contentHash',b.content_hash);
 RETURN result;
END $$;

CREATE FUNCTION parallel_life.publication_scene_goal_candidates(w text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o text; result jsonb;
BEGIN
 o:=parallel_life.publication_scene_goal_owner(w,true);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('actorId',n.actor_id,'goalKey','publication:'||n.node_key,
  'placeId',x.state->'space'->>'currentPlaceId','source',jsonb_build_object('kind','publication_node','nodeKey',n.node_key,'sourceEventId',n.source_event_id,'sourceRecordId',n.source_message_id)) ORDER BY n.node_key),'[]'::jsonb)
 INTO result FROM parallel_life.publication_story_nodes n
 JOIN parallel_life.worlds x ON x.id=w AND x.owner_id=o
 JOIN parallel_life.publication_story_plans plan ON plan.world_id=w AND plan.owner_id=o
 JOIN LATERAL jsonb_array_elements(plan.document->'nodes') node ON node->>'key'=n.node_key
 LEFT JOIN parallel_life.publication_story_progress progress ON progress.world_id=w AND progress.owner_id=o AND progress.node_key=n.node_key
 WHERE n.world_id=w AND n.owner_id=o AND parallel_life.publication_introduced_goal(w,o,n.node_key)
  AND COALESCE(progress.state->>'phase','introduced')<>'resolved'
  AND (node->>'settingPlaceKey'=x.state->'space'->>'currentPlaceId' OR node->>'placeKey'=x.state->'space'->>'currentPlaceId'
   OR node->'scenePlaceKeys' ? (x.state->'space'->>'currentPlaceId') OR node->'intent'->>'placeKey'=x.state->'space'->>'currentPlaceId')
  AND NOT EXISTS(SELECT 1 FROM parallel_life.memory_records m WHERE m.owner_id=o AND m.branch_id=w AND m.status='forgotten' AND (m.character_id=n.actor_id OR (m.scope_type='branch' AND m.scope_id=w AND m.kind<>'episode'))
   AND (m.source_ids ? n.source_event_id OR m.source_ids ? n.source_message_id));
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION parallel_life.publication_actor_life_modules(w text,a text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE o text; caller text; result jsonb;
BEGIN
 o:=parallel_life.publication_scene_goal_owner(w);
 caller:=CASE WHEN COALESCE(current_setting('role',true),'none')='none' THEN session_user ELSE current_setting('role',true) END;
 IF pg_has_role(caller,'pl_worker','MEMBER') AND NOT parallel_life.publication_scene_goal_actor(w,o,a)
 THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
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

CREATE FUNCTION parallel_life.publication_worker_active_goal(w text,o text,k text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual_owner text; actor text;
BEGIN
 actual_owner:=parallel_life.publication_scene_goal_owner(w);
 IF actual_owner IS DISTINCT FROM o THEN RETURN false; END IF;
 SELECT actor_id INTO actor FROM parallel_life.publication_story_nodes WHERE world_id=w AND owner_id=o AND node_key=k;
 RETURN parallel_life.publication_introduced_goal(w,o,k) AND parallel_life.publication_scene_goal_actor(w,o,actor);
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END $$;
CREATE POLICY leased_scene_goal_progress ON parallel_life.publication_story_progress TO pl_worker
 USING(parallel_life.publication_worker_active_goal(world_id,owner_id,node_key))
 WITH CHECK(parallel_life.publication_worker_active_goal(world_id,owner_id,node_key));
CREATE POLICY leased_scene_goal_evidence ON parallel_life.publication_story_progress_evidence TO pl_worker
 USING(parallel_life.publication_worker_active_goal(world_id,owner_id,node_key))
 WITH CHECK(parallel_life.publication_worker_active_goal(world_id,owner_id,node_key));
CREATE POLICY leased_scene_goal_audit ON parallel_life.publication_story_receipts FOR INSERT TO pl_worker
 WITH CHECK(parallel_life.publication_worker_active_goal(world_id,owner_id,node_key) AND data->>'scope'='event_progress');
GRANT SELECT,INSERT,UPDATE ON parallel_life.publication_story_progress TO pl_worker;
GRANT SELECT,INSERT ON parallel_life.publication_story_progress_evidence TO pl_worker;
GRANT INSERT ON parallel_life.publication_story_receipts TO pl_worker;
REVOKE ALL ON FUNCTION parallel_life.publication_scene_goal_owner(text,boolean),
 parallel_life.publication_introduced_goal(text,text,text),parallel_life.publication_scene_goal_actor(text,text,text),
 parallel_life.publication_active_event_goals(text,text),parallel_life.publication_scene_goal_candidates(text),
 parallel_life.publication_actor_life_modules(text,text),parallel_life.publication_worker_active_goal(text,text,text)
 FROM PUBLIC,pl_app,pl_publisher,pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.publication_active_event_goals(text,text),parallel_life.publication_scene_goal_candidates(text),
 parallel_life.publication_actor_life_modules(text,text) TO pl_app,pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.publication_worker_active_goal(text,text,text) TO pl_worker;
