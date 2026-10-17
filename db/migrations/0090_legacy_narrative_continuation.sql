-- Immutable continuation checkpoint; never modifies world state, time or old receipts.
CREATE TABLE parallel_life.legacy_engine_checkpoints(
 world_id text PRIMARY KEY REFERENCES parallel_life.worlds(id),owner_id text NOT NULL,
 world_version integer NOT NULL CHECK(world_version>=0),state_hash text NOT NULL CHECK(state_hash~'^[a-f0-9]{32}$'),
 genesis_hash text NOT NULL CHECK(genesis_hash~'^[a-f0-9]{32}$'),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE parallel_life.legacy_engine_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_life.legacy_engine_checkpoints FORCE ROW LEVEL SECURITY;
REVOKE ALL ON parallel_life.legacy_engine_checkpoints FROM PUBLIC,pl_app,pl_worker,pl_publisher;
GRANT SELECT,INSERT ON parallel_life.legacy_engine_checkpoints TO pl_app;
CREATE POLICY own_checkpoint ON parallel_life.legacy_engine_checkpoints TO pl_app USING(owner_id=current_setting('app.user_id',true)) WITH CHECK(owner_id=current_setting('app.user_id',true));
CREATE FUNCTION parallel_life.guard_legacy_checkpoint() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM parallel_life.worlds w JOIN parallel_life.world_initial_snapshots i ON i.world_id=w.id AND i.owner_id=w.owner_id LEFT JOIN parallel_life.agent_runtime_worlds r ON r.world_id=w.id WHERE w.id=NEW.world_id AND w.owner_id=NEW.owner_id AND w.version=NEW.world_version AND md5(w.state::text)=NEW.state_hash AND md5(i.state::text)=NEW.genesis_hash AND coalesce(r.engine_epoch,1)=1) THEN RAISE EXCEPTION 'INVALID_LEGACY_CHECKPOINT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legacy_checkpoint_guard BEFORE INSERT ON parallel_life.legacy_engine_checkpoints FOR EACH ROW EXECUTE FUNCTION parallel_life.guard_legacy_checkpoint();
ALTER TABLE parallel_life.agent_narrative_admissions DROP CONSTRAINT agent_narrative_admissions_kind_check;
ALTER TABLE parallel_life.agent_narrative_admissions DROP CONSTRAINT agent_narrative_admissions_admitted_at_version_check;
ALTER TABLE parallel_life.agent_narrative_admissions ADD CHECK(kind IN ('new_genesis','legacy_migration'));
ALTER TABLE parallel_life.agent_narrative_admissions ADD CHECK((kind='new_genesis' AND admitted_at_version=0) OR (kind='legacy_migration' AND admitted_at_version>=0));
CREATE OR REPLACE FUNCTION parallel_life.guard_agent_narrative_admission() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM parallel_life.worlds w JOIN parallel_life.world_initial_snapshots i ON i.world_id=w.id AND i.owner_id=w.owner_id JOIN parallel_life.agent_runtime_worlds c ON c.world_id=w.id AND c.owner_id=w.owner_id WHERE w.id=NEW.world_id AND w.owner_id=NEW.owner_id AND w.version=NEW.admitted_at_version AND c.engine_epoch=NEW.engine_epoch AND md5(i.state::text)=NEW.genesis_hash)
 OR EXISTS(SELECT 1 FROM parallel_life.agent_attempts WHERE world_id=NEW.world_id)
 OR EXISTS(SELECT 1 FROM parallel_life.director_runtime_attempts WHERE world_id=NEW.world_id)
 OR EXISTS(SELECT 1 FROM parallel_life.worlds w,LATERAL jsonb_array_elements(w.state->'actors') a WHERE w.id=NEW.world_id AND NOT EXISTS(SELECT 1 FROM parallel_life.actor_agent_states s WHERE s.world_id=w.id AND s.owner_id=w.owner_id AND s.actor_id=a->>'id' AND s.revision=0 AND s.projected_world_version=NEW.admitted_at_version))
 THEN RAISE EXCEPTION 'INVALID_NARRATIVE_ADMISSION' USING ERRCODE='23514'; END IF;
 IF NEW.kind='legacy_migration' AND NOT EXISTS(SELECT 1 FROM parallel_life.legacy_engine_checkpoints p JOIN parallel_life.worlds w ON w.id=p.world_id AND w.owner_id=p.owner_id WHERE p.world_id=NEW.world_id AND p.owner_id=NEW.owner_id AND p.world_version=NEW.admitted_at_version AND p.genesis_hash=NEW.genesis_hash AND p.state_hash=md5(w.state::text)) THEN RAISE EXCEPTION 'INVALID_LEGACY_ADMISSION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- Worker may initialize ONLY the immutable v0 world being built under its current live lease.
CREATE FUNCTION parallel_life.initialize_built_agent_world(wid text,states jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w parallel_life.worlds%ROWTYPE; a jsonb; doc jsonb; ref text; own text;
BEGIN
 SELECT * INTO w FROM parallel_life.worlds WHERE id=wid FOR UPDATE;
 IF NOT FOUND OR w.version<>0 OR NOT EXISTS(SELECT 1 FROM parallel_life.world_initial_snapshots i WHERE i.world_id=w.id AND i.owner_id=w.owner_id) THEN RAISE EXCEPTION 'INVALID_GENESIS'; END IF;
 IF current_setting('app.user_id',true) IS DISTINCT FROM w.owner_id AND NOT EXISTS(SELECT 1 FROM parallel_life.tasks t JOIN parallel_life.world_builds b ON b.seed_id::text=t.scope_id AND b.world_id=wid AND b.owner_id=t.owner_id WHERE t.id::text=current_setting('app.task_id',true) AND t.lease_token::text=current_setting('app.lease_token',true) AND t.owner_id=w.owner_id AND t.status='running' AND t.scope_kind='world-build' AND t.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM parallel_life.agent_runtime_worlds WHERE world_id=wid AND engine_epoch>=2) THEN RETURN; END IF;
 IF jsonb_typeof(states)<>'array' OR jsonb_array_length(states)<>jsonb_array_length(w.state->'actors') THEN RAISE EXCEPTION 'INVALID_CAST'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(w.state->'actors') LOOP
  SELECT value INTO doc FROM jsonb_array_elements(states) WHERE value->>'actorId'=a->>'id';
  ref=encode(sha256(convert_to('['||to_json(wid)::text||','||to_json(a->>'id')::text||','||coalesce((a->'persona')::text,'null')||','||coalesce((a->'relationship')::text,'null')||']','UTF8')),'hex');
  IF doc IS NULL OR doc->>'worldId'<>wid OR doc->>'definitionRef'<>ref OR doc->>'schemaVersion'<>'1' OR doc->>'revision'<>'0' OR doc->>'projectedWorldVersion'<>'0' OR doc->'goals'<>'[]'::jsonb OR doc->'plans'<>'[]'::jsonb OR doc->'actions'<>'[]'::jsonb OR doc->'responsibilities'<>'[]'::jsonb OR doc->'decisions'<>'[]'::jsonb THEN RAISE EXCEPTION 'INVALID_INITIAL_AGENT'; END IF;
  INSERT INTO parallel_life.actor_agent_states(world_id,owner_id,actor_id,revision,projected_world_version,document) VALUES(wid,w.owner_id,a->>'id',0,0,doc);
 END LOOP;
 INSERT INTO parallel_life.agent_runtime_worlds(world_id,owner_id,engine_epoch) VALUES(wid,w.owner_id,1) ON CONFLICT(world_id) DO NOTHING;
 UPDATE parallel_life.agent_runtime_worlds SET engine_epoch=2 WHERE world_id=wid AND engine_epoch=1;
 INSERT INTO parallel_life.agent_narrative_admissions(world_id,owner_id,engine_epoch,kind,genesis_hash,admitted_at_version) SELECT wid,w.owner_id,2,'new_genesis',md5(i.state::text),0 FROM parallel_life.world_initial_snapshots i WHERE i.world_id=wid;
 INSERT INTO parallel_life.director_observed_states(world_id,owner_id) VALUES(wid,w.owner_id) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION parallel_life.initialize_built_agent_world(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.initialize_built_agent_world(text,jsonb) TO pl_app,pl_worker;
