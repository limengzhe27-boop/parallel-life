-- Evidence of bounded execution milestones; never an assertion that a whole authored event ended.
CREATE TABLE parallel_life.agent_episode_evidence (
 world_id text NOT NULL, owner_id text NOT NULL, id text NOT NULL,
 episode_id text NOT NULL, actor_id text NOT NULL, engine_epoch integer NOT NULL CHECK(engine_epoch>=2),
 action_id text NOT NULL, source_event_id text NOT NULL, world_version integer NOT NULL CHECK(world_version>0),
 kind text NOT NULL CHECK(kind IN ('invitation_proposed','invitation_accepted','invitation_declined','travel_started','arrived')),
 subject_kind text NOT NULL CHECK(subject_kind IN ('appointment','journey')), subject_id text NOT NULL,
 document jsonb NOT NULL,
 PRIMARY KEY(world_id,id), UNIQUE(world_id,episode_id,actor_id,source_event_id,kind,subject_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,episode_id) REFERENCES parallel_life.shared_episodes(world_id,id),
 FOREIGN KEY(world_id,source_event_id,owner_id) REFERENCES parallel_life.world_events(world_id,id,owner_id),
 CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=16384
   AND document @> jsonb_build_object('worldId',world_id,'episodeId',episode_id,'actorId',actor_id,'engineEpoch',engine_epoch,'actionId',action_id,'eventId',source_event_id,'worldVersion',world_version,'kind',kind,'subject',jsonb_build_object('kind',subject_kind,'id',subject_id))
   AND document->>'worldId'=world_id AND document->>'episodeId'=episode_id AND document->>'actorId'=actor_id
   AND document->'engineEpoch'=to_jsonb(engine_epoch) AND document->>'actionId'=action_id
   AND document->>'eventId'=source_event_id AND document->'worldVersion'=to_jsonb(world_version)
   AND document->>'kind'=kind AND document->'subject'->>'kind'=subject_kind AND document->'subject'->>'id'=subject_id)
);
ALTER TABLE parallel_life.agent_episode_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.agent_episode_evidence FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.agent_episode_evidence FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
CREATE POLICY episode_evidence_owner ON parallel_life.agent_episode_evidence TO pl_app
 USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
GRANT SELECT,INSERT ON parallel_life.agent_episode_evidence TO pl_app;
CREATE FUNCTION parallel_life.guard_agent_episode_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source jsonb; action jsonb; result jsonb; prior jsonb; BEGIN
 SELECT e.payload INTO source FROM parallel_life.world_events e
 JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id
   AND c.status='succeeded' AND c.result_event_id=e.id
 JOIN parallel_life.agent_runtime_worlds w ON w.world_id=e.world_id AND w.owner_id=e.owner_id
 WHERE e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id AND e.id=NEW.source_event_id
   AND e.version=NEW.world_version AND w.engine_epoch=NEW.engine_epoch;
 IF source IS NULL THEN RAISE EXCEPTION 'EPISODE_EVIDENCE_SOURCE_REQUIRED' USING ERRCODE='23514'; END IF;
 IF NEW.kind IN ('invitation_proposed','travel_started') THEN
  SELECT r.document,a INTO result,action FROM parallel_life.agent_action_results r
   JOIN parallel_life.agent_attempts t ON t.world_id=r.world_id AND t.owner_id=r.owner_id
     AND t.actor_id=r.actor_id AND t.event_id=r.source_event_id AND t.status='committed'
     AND t.engine_epoch=NEW.engine_epoch,
   LATERAL jsonb_array_elements(source->'data'->'agentRuntime'->'stateAfter'->'actions') a
   WHERE r.world_id=NEW.world_id AND r.owner_id=NEW.owner_id AND r.actor_id=NEW.actor_id
    AND r.action_id=NEW.action_id AND r.source_event_id=NEW.source_event_id
    AND r.id=NEW.document->>'sourceId' AND a->>'id'=r.action_id
    AND r.document->>'outcome'='succeeded'
    AND EXISTS(SELECT 1 FROM parallel_life.agent_episode_requests q
      WHERE q.world_id=NEW.world_id AND q.owner_id=NEW.owner_id AND q.episode_id=NEW.episode_id
       AND q.actor_id=NEW.actor_id AND q.engine_epoch=NEW.engine_epoch AND q.status='consumed'
       AND (a->'sourceIds' ? ('episode-intent:'||q.id) OR a->'sourceIds' ? q.input_receipt_id));
  IF result IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'outputRefs') o
    WHERE o->>'kind'=NEW.subject_kind AND o->>'id'=NEW.subject_id)
   OR (NEW.kind='invitation_proposed' AND (action->>'capability' IS DISTINCT FROM 'appointment.propose' OR NEW.subject_kind<>'appointment'))
   OR (NEW.kind='travel_started' AND (action->>'capability' IS DISTINCT FROM 'travel.begin' OR NEW.subject_kind<>'journey'))
   OR NEW.document->>'at' IS DISTINCT FROM result->>'at'
  THEN RAISE EXCEPTION 'EPISODE_EVIDENCE_ACTION_REQUIRED' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT document INTO prior FROM parallel_life.agent_episode_evidence p
   WHERE p.world_id=NEW.world_id AND p.owner_id=NEW.owner_id AND p.episode_id=NEW.episode_id
    AND p.actor_id=NEW.actor_id AND p.engine_epoch=NEW.engine_epoch AND p.action_id=NEW.action_id
    AND p.subject_kind=NEW.subject_kind AND p.subject_id=NEW.subject_id AND p.world_version<NEW.world_version
    AND p.kind=CASE WHEN NEW.kind='arrived' THEN 'travel_started' ELSE 'invitation_proposed' END;
  IF prior IS NULL THEN RAISE EXCEPTION 'EPISODE_EVIDENCE_CAUSE_REQUIRED' USING ERRCODE='23514'; END IF;
  IF NEW.kind IN ('invitation_accepted','invitation_declined') THEN
   IF source->>'type'<>'invitation.responded' OR source->'data'->>'id' IS DISTINCT FROM NEW.subject_id
    OR source->'data'->>'operation' IS DISTINCT FROM (CASE WHEN NEW.kind='invitation_accepted' THEN 'accept' ELSE 'cancel' END)
    OR NEW.subject_kind<>'appointment' OR NEW.document->>'sourceId' IS DISTINCT FROM NEW.source_event_id
    OR NEW.document->>'at' IS DISTINCT FROM source->>'storyTime'
    OR EXISTS(SELECT 1 FROM parallel_life.world_events e WHERE e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id
      AND e.version> (prior->>'worldVersion')::integer AND e.version<NEW.world_version
      AND e.payload->>'type'='invitation.responded' AND e.payload->'data'->>'id'=NEW.subject_id)
   THEN RAISE EXCEPTION 'EPISODE_EVIDENCE_RESPONSE_REQUIRED' USING ERRCODE='23514'; END IF;
  ELSE
   IF source->>'type'<>'agent.arrival_committed' OR source->'data'->>'actorId' IS DISTINCT FROM NEW.actor_id
    OR source->'data'->>'journeyId' IS DISTINCT FROM NEW.subject_id OR NEW.subject_kind<>'journey'
    OR source->'data'->'arrival'->>'id' IS DISTINCT FROM NEW.document->>'sourceId'
    OR source->'data'->'arrival'->>'at' IS DISTINCT FROM NEW.document->>'at'
   THEN RAISE EXCEPTION 'EPISODE_EVIDENCE_ARRIVAL_REQUIRED' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER episode_evidence_guard BEFORE INSERT ON parallel_life.agent_episode_evidence
 FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_agent_episode_evidence();
CREATE TRIGGER episode_evidence_immutable BEFORE UPDATE ON parallel_life.agent_episode_evidence
 FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();
REVOKE ALL ON FUNCTION parallel_life.guard_agent_episode_evidence() FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login;
