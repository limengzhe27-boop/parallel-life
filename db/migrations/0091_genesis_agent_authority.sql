-- Tighten initializer authority without rewriting an existing migration.
ALTER TABLE parallel_life.legacy_engine_checkpoints DROP CONSTRAINT legacy_engine_checkpoints_world_id_fkey;
ALTER TABLE parallel_life.legacy_engine_checkpoints ADD FOREIGN KEY(world_id) REFERENCES parallel_life.worlds(id) ON DELETE CASCADE;
CREATE OR REPLACE FUNCTION parallel_life.initialize_built_agent_world(wid text,states jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE w parallel_life.worlds%ROWTYPE; a jsonb; doc jsonb; ref text; own text;
BEGIN
 SELECT * INTO w FROM parallel_life.worlds WHERE id=wid FOR UPDATE;
 IF NOT FOUND OR w.version<>0 OR NOT EXISTS(SELECT 1 FROM parallel_life.world_initial_snapshots i WHERE i.world_id=w.id AND i.owner_id=w.owner_id) THEN RAISE EXCEPTION 'INVALID_GENESIS'; END IF;
 IF (pg_has_role(session_user,'pl_worker','MEMBER') OR current_setting('app.user_id',true) IS DISTINCT FROM w.owner_id) AND NOT EXISTS(SELECT 1 FROM parallel_life.tasks t JOIN parallel_life.world_builds b ON b.seed_id::text=t.scope_id AND b.world_id=wid AND b.owner_id=t.owner_id WHERE t.id::text=current_setting('app.task_id',true) AND t.lease_token::text=current_setting('app.lease_token',true) AND t.owner_id=w.owner_id AND t.status='running' AND t.scope_kind='world-build' AND t.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM parallel_life.agent_runtime_worlds WHERE world_id=wid AND engine_epoch>=2) THEN RETURN; END IF;
 IF jsonb_typeof(states)<>'array' OR jsonb_array_length(states)<>jsonb_array_length(w.state->'actors') THEN RAISE EXCEPTION 'INVALID_CAST'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(w.state->'actors') LOOP
  SELECT value INTO doc FROM jsonb_array_elements(states) WHERE value->>'actorId'=a->>'id';
  ref=encode(sha256(convert_to('['||to_json(wid)::text||','||to_json(a->>'id')::text||','||coalesce((a->'persona')::text,'null')||','||coalesce((a->'relationship')::text,'null')||']','UTF8')),'hex');
  IF doc IS NULL OR doc->>'worldId' IS DISTINCT FROM wid OR doc->>'definitionRef' IS DISTINCT FROM ref OR doc->>'schemaVersion' IS DISTINCT FROM '1' OR doc->>'revision' IS DISTINCT FROM '0' OR doc->>'projectedWorldVersion' IS DISTINCT FROM '0' OR doc->'goals' IS DISTINCT FROM '[]'::jsonb OR doc->'plans' IS DISTINCT FROM '[]'::jsonb OR doc->'actions' IS DISTINCT FROM '[]'::jsonb OR doc->'responsibilities' IS DISTINCT FROM '[]'::jsonb OR doc->'decisions' IS DISTINCT FROM '[]'::jsonb OR doc->'knowledgeSourceIds' IS DISTINCT FROM '[]'::jsonb OR doc->'memoryIds' IS DISTINCT FROM '[]'::jsonb OR doc->'relationshipIds' IS DISTINCT FROM '[]'::jsonb OR doc->'focus' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'INVALID_INITIAL_AGENT'; END IF;
  INSERT INTO parallel_life.actor_agent_states(world_id,owner_id,actor_id,revision,projected_world_version,document) VALUES(wid,w.owner_id,a->>'id',0,0,doc);
 END LOOP;
 INSERT INTO parallel_life.agent_runtime_worlds(world_id,owner_id,engine_epoch) VALUES(wid,w.owner_id,1) ON CONFLICT(world_id) DO NOTHING;
 UPDATE parallel_life.agent_runtime_worlds SET engine_epoch=2 WHERE world_id=wid AND engine_epoch=1;
 INSERT INTO parallel_life.agent_narrative_admissions(world_id,owner_id,engine_epoch,kind,genesis_hash,admitted_at_version) SELECT wid,w.owner_id,2,'new_genesis',md5(i.state::text),0 FROM parallel_life.world_initial_snapshots i WHERE i.world_id=wid;
 INSERT INTO parallel_life.director_observed_states(world_id,owner_id) VALUES(wid,w.owner_id) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION parallel_life.initialize_built_agent_world(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.initialize_built_agent_world(text,jsonb) TO pl_app,pl_worker;
