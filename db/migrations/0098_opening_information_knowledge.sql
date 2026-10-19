-- Bounded Director-authored information receipt, never a free-form physical action executor.
CREATE TABLE parallel_life.opening_context_reviews (
 world_id text NOT NULL, owner_id text NOT NULL, engine_epoch integer NOT NULL CHECK(engine_epoch>=2),
 review_key text NOT NULL, node_key text NOT NULL, node_hash text NOT NULL, source_hash text NOT NULL,
 decision_id text NOT NULL REFERENCES parallel_life.director_decisions(id),
 attempt_id text NOT NULL REFERENCES parallel_life.director_runtime_attempts(id),
 disposition text NOT NULL CHECK(disposition IN ('confirm','defer')),
 source_event_id text REFERENCES parallel_life.world_events(id), document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(world_id,engine_epoch,review_key),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 CHECK ((disposition='confirm')=(source_event_id IS NOT NULL))
);
CREATE TABLE parallel_life.actor_narrative_knowledge (
 id text PRIMARY KEY, world_id text NOT NULL, owner_id text NOT NULL, actor_id text NOT NULL,
 fact_id text NOT NULL REFERENCES parallel_life.world_facts(id) ON DELETE CASCADE,
 source_event_id text NOT NULL REFERENCES parallel_life.world_events(id), source_version integer NOT NULL,
 occurred_at timestamptz NOT NULL, learned_at timestamptz NOT NULL,
 method text NOT NULL CHECK(method='authored_initial_context'), basis jsonb NOT NULL,
 content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 UNIQUE(world_id,actor_id,fact_id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,actor_id) REFERENCES parallel_life.actor_agent_states(world_id,actor_id) ON DELETE CASCADE,
 CHECK(occurred_at<=learned_at)
);
CREATE FUNCTION parallel_life.guard_opening_context_proof() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE decision_key text; BEGIN
 IF TG_TABLE_NAME='opening_context_reviews' THEN decision_key:=NEW.decision_id; ELSE decision_key:=NEW.basis->>'decisionId'; END IF;
 IF NEW.owner_id IS DISTINCT FROM current_setting('app.user_id',true)
 OR decision_key IS DISTINCT FROM current_setting('app.director_context_decision_id',true)
 OR NOT EXISTS(SELECT 1 FROM parallel_life.director_decisions d
   JOIN parallel_life.director_runtime_attempts a ON a.id=d.attempt_id AND a.world_id=d.world_id AND a.owner_id=d.owner_id AND a.decision_id=d.id
   JOIN parallel_life.agent_runtime_worlds rw ON rw.world_id=d.world_id AND rw.owner_id=d.owner_id AND rw.engine_epoch=d.engine_epoch
   WHERE d.id=decision_key AND d.world_id=NEW.world_id AND d.owner_id=NEW.owner_id
    AND a.status='committed' AND a.response_hash IS NOT NULL AND a.sent_at IS NOT NULL AND a.lease_until>clock_timestamp()
    AND d.document ? 'openingContext' AND d.document->'openingContext' IS NOT NULL
    AND current_setting('app.agent_world_id',true)=NEW.world_id AND current_setting('app.agent_engine_epoch',true)=d.engine_epoch::text)
 THEN RAISE EXCEPTION 'OPENING_CONTEXT_AUTHORITY_REQUIRED' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='actor_narrative_knowledge' THEN
 IF NOT EXISTS(
   SELECT 1 FROM parallel_life.world_events e
   JOIN parallel_life.commands c ON c.world_id=e.world_id AND c.owner_id=e.owner_id AND c.id=e.command_id AND c.status='succeeded' AND c.result_event_id=e.id AND c.expected_version+1=e.version
   JOIN parallel_life.world_facts f ON f.world_id=e.world_id AND f.owner_id=e.owner_id AND f.id=NEW.fact_id
   WHERE e.id=NEW.source_event_id AND e.world_id=NEW.world_id AND e.owner_id=NEW.owner_id AND e.version=NEW.source_version
    AND e.payload->>'type'='narrative.context_confirmed' AND e.payload->'data'->>'directorDecisionId'=decision_key
    AND f.document->>'kind'='canonical' AND f.document->>'sourceEventId'=e.id
    AND f.document->'visibility'=jsonb_build_object('kind','actors','actorIds',jsonb_build_array(NEW.actor_id))
    AND f.document->'narrativeContext'->>'knowledgeId'=NEW.id
    AND (f.document->>'text')::jsonb->>'type'='received_opening_information'
    AND (f.document->>'text')::jsonb->>'assertion'='report'
    AND (f.document->>'text')::jsonb->>'executionEvidence'='false'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.payload->'data'->'premises') p
      WHERE p->>'factId'=NEW.fact_id AND p->>'actorId'=NEW.actor_id AND p->'basis'=NEW.basis AND p->>'text'=f.document->>'text'
       AND (p->>'occurredAt')::timestamptz=NEW.occurred_at AND (p->>'learnedAt')::timestamptz=NEW.learned_at))
 THEN RAISE EXCEPTION 'NARRATIVE_KNOWLEDGE_PROOF_REQUIRED' USING ERRCODE='23514'; END IF;
 ELSE
 IF NEW.document IS DISTINCT FROM (SELECT d.document->'openingContext' FROM parallel_life.director_decisions d WHERE d.id=decision_key) OR NEW.review_key IS DISTINCT FROM NEW.document->>'reviewKey' THEN RAISE EXCEPTION 'OPENING_REVIEW_PROOF_REQUIRED' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER opening_context_insert_proof BEFORE INSERT ON parallel_life.opening_context_reviews FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_opening_context_proof();
CREATE TRIGGER narrative_knowledge_insert_proof BEFORE INSERT ON parallel_life.actor_narrative_knowledge FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_opening_context_proof();
CREATE TRIGGER opening_context_immutable BEFORE UPDATE ON parallel_life.opening_context_reviews FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();
CREATE TRIGGER narrative_knowledge_immutable BEFORE UPDATE ON parallel_life.actor_narrative_knowledge FOR EACH ROW EXECUTE FUNCTION parallel_life.agent_runtime_immutable();
REVOKE ALL ON FUNCTION parallel_life.guard_opening_context_proof() FROM PUBLIC;
ALTER TABLE parallel_life.opening_context_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.opening_context_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.actor_narrative_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.actor_narrative_knowledge FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.opening_context_reviews,parallel_life.actor_narrative_knowledge FROM PUBLIC,pl_worker,pl_publisher,pl_publisher_login;
GRANT SELECT,INSERT ON parallel_life.opening_context_reviews,parallel_life.actor_narrative_knowledge TO pl_app;
CREATE POLICY opening_context_owner ON parallel_life.opening_context_reviews TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE POLICY narrative_knowledge_owner ON parallel_life.actor_narrative_knowledge TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
