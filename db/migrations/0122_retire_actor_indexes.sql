-- Stop creating redundant actor indexes; existing snapshots are immutable and remain readable.
-- Current actor documents lose these keys only through a normal versioned kernel commit.
-- Collapse two equivalent seed uniqueness constraints without losing dependent foreign keys.
DO $migration$
DECLARE
  duplicate_index oid;
  duplicate_keys smallint[];
  dependent_fks jsonb;
  fk record;
BEGIN
  SELECT conindid, conkey INTO duplicate_index, duplicate_keys
    FROM pg_constraint
    WHERE conrelid='parallel_life.approved_seeds'::regclass
      AND conname='seed_id_owner_unique' AND contype='u';
  IF duplicate_index IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='parallel_life.approved_seeds'::regclass
      AND conname='seed_owner_unique' AND contype='u' AND conkey=duplicate_keys
  ) THEN RAISE EXCEPTION 'SEED_UNIQUE_REPLACEMENT_MISSING'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema_name',n.nspname,'table_name',r.relname,'constraint_name',c.conname,
    'definition',pg_get_constraintdef(c.oid),'comment',obj_description(c.oid,'pg_constraint'))
    ORDER BY n.nspname,r.relname,c.conname),'[]'::jsonb)
    INTO dependent_fks
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE c.contype='f' AND c.conindid=duplicate_index;
  FOR fk IN SELECT * FROM jsonb_to_recordset(dependent_fks)
    AS x(schema_name text,table_name text,constraint_name text,definition text,comment text)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I',fk.schema_name,fk.table_name,fk.constraint_name);
  END LOOP;
  ALTER TABLE parallel_life.approved_seeds DROP CONSTRAINT seed_id_owner_unique;
  FOR fk IN SELECT * FROM jsonb_to_recordset(dependent_fks)
    AS x(schema_name text,table_name text,constraint_name text,definition text,comment text)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s',fk.schema_name,fk.table_name,fk.constraint_name,fk.definition);
    IF fk.comment IS NOT NULL THEN
      EXECUTE format('COMMENT ON CONSTRAINT %I ON %I.%I IS %L',fk.constraint_name,fk.schema_name,fk.table_name,fk.comment);
    END IF;
  END LOOP;
END $migration$;

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
  IF doc IS NULL OR doc->>'worldId' IS DISTINCT FROM wid OR doc->>'definitionRef' IS DISTINCT FROM ref OR doc->>'schemaVersion' IS DISTINCT FROM '1' OR doc->>'revision' IS DISTINCT FROM '0' OR doc->>'projectedWorldVersion' IS DISTINCT FROM '0' OR doc->'goals' IS DISTINCT FROM '[]'::jsonb OR doc->'plans' IS DISTINCT FROM '[]'::jsonb OR doc->'actions' IS DISTINCT FROM '[]'::jsonb OR doc->'responsibilities' IS DISTINCT FROM '[]'::jsonb OR doc->'decisions' IS DISTINCT FROM '[]'::jsonb OR doc->'knowledgeSourceIds' IS DISTINCT FROM '[]'::jsonb OR (doc ? 'memoryIds' AND doc->'memoryIds' IS DISTINCT FROM '[]'::jsonb) OR (doc ? 'relationshipIds' AND doc->'relationshipIds' IS DISTINCT FROM '[]'::jsonb) OR doc->'focus' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'INVALID_INITIAL_AGENT'; END IF;
  INSERT INTO parallel_life.actor_agent_states(world_id,owner_id,actor_id,revision,projected_world_version,document) VALUES(wid,w.owner_id,a->>'id',0,0,doc - 'memoryIds' - 'relationshipIds');
 END LOOP;
 INSERT INTO parallel_life.agent_runtime_worlds(world_id,owner_id,engine_epoch) VALUES(wid,w.owner_id,1) ON CONFLICT(world_id) DO NOTHING;
 UPDATE parallel_life.agent_runtime_worlds SET engine_epoch=2 WHERE world_id=wid AND engine_epoch=1;
 INSERT INTO parallel_life.agent_narrative_admissions(world_id,owner_id,engine_epoch,kind,genesis_hash,admitted_at_version) SELECT wid,w.owner_id,2,'new_genesis',md5(i.state::text),0 FROM parallel_life.world_initial_snapshots i WHERE i.world_id=wid;
 INSERT INTO parallel_life.director_observed_states(world_id,owner_id) VALUES(wid,w.owner_id) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION parallel_life.initialize_built_agent_world(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.initialize_built_agent_world(text,jsonb) TO pl_app,pl_worker;
