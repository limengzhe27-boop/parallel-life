-- Actual locations, observer knowledge and director cursors have separate provenance.
CREATE UNIQUE INDEX awareness_event_identity ON parallel_life.world_events(world_id,id,owner_id,version);
CREATE TABLE parallel_life.world_awareness_boundaries (
 world_id text PRIMARY KEY, owner_id text NOT NULL, source_event_id text,
 source_version integer NOT NULL CHECK(source_version>=0), document jsonb NOT NULL,
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id,source_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 CHECK((source_version=0)=(source_event_id IS NULL)),
 CHECK(document ?& ARRAY['worldId','actorIds','placeIds','capabilityIds','extensionPermission','createdFromVersion','sourceEventId'] AND jsonb_typeof(document)='object' AND (document->>'worldId') IS NOT DISTINCT FROM world_id AND (document->>'extensionPermission') IS NOT DISTINCT FROM 'none'
 AND jsonb_typeof(document->'actorIds')='array' AND jsonb_typeof(document->'placeIds')='array' AND jsonb_typeof(document->'capabilityIds')='array'
 AND (document->'sourceEventId') IS NOT DISTINCT FROM COALESCE(to_jsonb(source_event_id),'null'::jsonb)
 AND (document->'createdFromVersion') IS NOT DISTINCT FROM to_jsonb(source_version) AND octet_length(document::text)<=262144)
);
CREATE TABLE parallel_life.world_authoritative_positions (
 world_id text NOT NULL, owner_id text NOT NULL, subject_key text NOT NULL,
 source_event_id text NOT NULL, source_version integer NOT NULL CHECK(source_version>0), document jsonb NOT NULL,
 PRIMARY KEY(world_id,subject_key),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id,source_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 CHECK(document ?& ARRAY['worldId','subject','status','placeId','sourceEventId','worldVersion','occurredAt'] AND jsonb_typeof(document)='object' AND (document->>'worldId') IS NOT DISTINCT FROM world_id
 AND (document->>'sourceEventId') IS NOT DISTINCT FROM source_event_id AND (document->'worldVersion') IS NOT DISTINCT FROM to_jsonb(source_version)
 AND jsonb_typeof(document->'subject') IS NOT DISTINCT FROM 'object'
 AND jsonb_typeof(document->'subject'->'kind') IS NOT DISTINCT FROM 'string'
 AND jsonb_typeof(document->'status') IS NOT DISTINCT FROM 'string' AND jsonb_typeof(document->'occurredAt') IS NOT DISTINCT FROM 'string'
 AND ((document->>'status'='at')=(jsonb_typeof(document->'placeId')='string'))
 AND document->>'status' IN ('at','in_transit','unknown') AND document->'subject'->>'kind' IN ('player','actor')
 AND subject_key IS NOT DISTINCT FROM CASE WHEN document->'subject'->>'kind'='player' THEN 'player' ELSE 'actor:'||(document->'subject'->>'actorId') END
 AND octet_length(document::text)<=16384)
);
CREATE TABLE parallel_life.actor_position_knowledge (
 world_id text NOT NULL, owner_id text NOT NULL, observer_actor_id text NOT NULL, subject_key text NOT NULL, kind text NOT NULL,
 source_event_id text NOT NULL, source_version integer NOT NULL CHECK(source_version>0), document jsonb NOT NULL,
 PRIMARY KEY(world_id,observer_actor_id,subject_key,source_event_id,kind),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id,source_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 CHECK(document ?& ARRAY['worldId','observerActorId','subject','kind','placeId','sourceKind','occurredAt','learnedAt','sourceEventId','worldVersion','possiblyStale'] AND document->'possiblyStale'='true'::jsonb AND jsonb_typeof(document)='object' AND (document->>'worldId') IS NOT DISTINCT FROM world_id
 AND (document->>'sourceEventId') IS NOT DISTINCT FROM source_event_id AND (document->'worldVersion') IS NOT DISTINCT FROM to_jsonb(source_version)
 AND (document->>'observerActorId') IS NOT DISTINCT FROM observer_actor_id AND (document->>'kind') IS NOT DISTINCT FROM kind
 AND jsonb_typeof(document->'subject') IS NOT DISTINCT FROM 'object'
 AND jsonb_typeof(document->'subject'->'kind') IS NOT DISTINCT FROM 'string'
 AND jsonb_typeof(document->'learnedAt') IS NOT DISTINCT FROM 'string'
 AND jsonb_typeof(document->'sourceKind') IS NOT DISTINCT FROM 'string'
 AND document->'subject'->>'kind' IN ('player','actor')
 AND subject_key IS NOT DISTINCT FROM CASE WHEN document->'subject'->>'kind'='player' THEN 'player' ELSE 'actor:'||(document->'subject'->>'actorId') END
 AND kind IN ('at','left','absent','report') AND document->>'sourceKind' IN ('direct','player_report','relayed','inference')
 AND octet_length(document::text)<=16384)
);
CREATE TABLE parallel_life.director_observed_states (
 world_id text PRIMARY KEY, owner_id text NOT NULL,
 observed_through_version integer NOT NULL DEFAULT 0 CHECK(observed_through_version>=0),
 observed_event_id text,
 evaluated_through_version integer NOT NULL DEFAULT 0 CHECK(evaluated_through_version>=0 AND evaluated_through_version<=observed_through_version),
 evaluated_event_id text,
 last_evaluation text CHECK(last_evaluation IN ('quiet','acted')),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,observed_event_id,owner_id,observed_through_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 FOREIGN KEY(world_id,evaluated_event_id,owner_id,evaluated_through_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 CHECK((observed_through_version=0)=(observed_event_id IS NULL)),
 CHECK((evaluated_through_version=0)=(evaluated_event_id IS NULL))
);
-- Unprocessed changes are never truncated out of a bounded state JSON document.
CREATE TABLE parallel_life.director_pending_reasons (
 world_id text NOT NULL, owner_id text NOT NULL, id text NOT NULL,
 source_event_id text NOT NULL, source_version integer NOT NULL CHECK(source_version>0), document jsonb NOT NULL,
 PRIMARY KEY(world_id,id),
 FOREIGN KEY(world_id,owner_id) REFERENCES parallel_life.worlds(id,owner_id) ON DELETE CASCADE,
 FOREIGN KEY(world_id,source_event_id,owner_id,source_version) REFERENCES parallel_life.world_events(world_id,id,owner_id,version),
 CHECK(document ?& ARRAY['id','eventId','worldVersion','kind','ref'] AND jsonb_typeof(document)='object' AND (document->>'id') IS NOT DISTINCT FROM id AND (document->>'eventId') IS NOT DISTINCT FROM source_event_id
 AND jsonb_typeof(document->'kind') IS NOT DISTINCT FROM 'string' AND jsonb_typeof(document->'ref') IS NOT DISTINCT FROM 'object'
 AND (document->'worldVersion') IS NOT DISTINCT FROM to_jsonb(source_version) AND octet_length(document::text)<=16384)
);
CREATE INDEX awareness_knowledge_read ON parallel_life.actor_position_knowledge(world_id,observer_actor_id,source_version DESC,source_event_id);
CREATE INDEX awareness_director_pending ON parallel_life.director_pending_reasons(world_id,source_version,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['world_awareness_boundaries','world_authoritative_positions','actor_position_knowledge','director_observed_states','director_pending_reasons'] LOOP
  EXECUTE format('ALTER TABLE parallel_life.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE parallel_life.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON parallel_life.%I FROM PUBLIC,pl_app,pl_worker,pl_publisher,pl_publisher_login',t);
  EXECUTE format('CREATE POLICY awareness_owner ON parallel_life.%I TO pl_app USING(owner_id=current_setting(''app.user_id'',true)) WITH CHECK(owner_id=current_setting(''app.user_id'',true))',t);
  EXECUTE format('GRANT SELECT,INSERT ON parallel_life.%I TO pl_app',t);
 END LOOP;
END $$;
GRANT UPDATE ON parallel_life.world_awareness_boundaries,parallel_life.world_authoritative_positions,parallel_life.director_observed_states TO pl_app;
