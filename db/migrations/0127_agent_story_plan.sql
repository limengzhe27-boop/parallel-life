-- Agent-runtime authored events get a deterministic story plan without rewriting the
-- immutable publication source or any historical episode. The cutover lets an existing
-- archive start a clean authored run while retaining every old episode/receipt as history.
ALTER TABLE parallel_life.publication_story_plans
  ADD COLUMN runtime_cutover_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION parallel_life.ensure_agent_story_plan(w text, o text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  s jsonb;
  b parallel_life.publication_world_bindings%ROWTYPE;
  nodes jsonb;
  timeline jsonb;
  stages jsonb;
  opening text;
  stage_count integer;
  epoch integer;
BEGIN
  IF o IS NULL OR w IS NULL THEN RETURN false; END IF;
  IF current_setting('app.user_id',true) IS DISTINCT FROM o
     AND current_user NOT IN ('pl_admin','postgres') THEN
    RAISE EXCEPTION 'INVALID_AGENT_STORY_SCOPE' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('app.user_id',o,true);
  SELECT * INTO b FROM parallel_life.publication_world_bindings
    WHERE world_id=w AND owner_id=o;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT engine_epoch INTO epoch FROM parallel_life.agent_runtime_worlds
    WHERE world_id=w AND owner_id=o;
  -- Legacy publication engines own their own story plan path.
  IF epoch IS NULL OR epoch < 2 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM parallel_life.publication_story_plans
            WHERE world_id=w AND owner_id=o) THEN
    RETURN false;
  END IF;
  s := parallel_life.publication_story_source(w);
  IF s IS NULL THEN RETURN false; END IF;
  nodes := s->'nodes';
  IF jsonb_typeof(nodes) <> 'array' THEN RETURN false; END IF;
  opening := s->>'openingEventKey';
  IF opening IS NULL THEN
    SELECT n.value->>'key' INTO opening
    FROM jsonb_array_elements(nodes) WITH ORDINALITY n(value,ordinality)
    WHERE n.value->'intent'->>'kind'='director_event'
    ORDER BY n.ordinality LIMIT 1;
  END IF;
  -- An authored library without explicit pacing is compiled into deterministic
  -- three-event acts. This is a runtime interpretation, not a rewrite of the source.
  IF s->'timeline' IS NULL
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) WITH ORDINALITY n(value,ordinality)
                WHERE n.value->'intent'->>'kind' <> 'editorial_only') THEN
    SELECT jsonb_agg(
      CASE WHEN n.value->'intent'->>'kind'='editorial_only' THEN n.value
      ELSE jsonb_set(n.value,'{timeline}',jsonb_build_object(
        'stageKey','runtime_stage_'||(
          ((SELECT count(*) FROM jsonb_array_elements(nodes) WITH ORDINALITY x(value,ordinality)
            WHERE x.value->'intent'->>'kind' <> 'editorial_only'
              AND x.ordinality <= n.ordinality)-1)/3+1
        ),
        'excludeIfResolved','[]'::jsonb,
        'alternatives',jsonb_build_object(
          'onDeclined','[]'::jsonb,'onSkipped','[]'::jsonb,'onExpired','[]'::jsonb
        )
      )) END ORDER BY n.ordinality)
    INTO nodes
    FROM jsonb_array_elements(nodes) WITH ORDINALITY n(value,ordinality);
    SELECT count(DISTINCT (
      ((SELECT count(*) FROM jsonb_array_elements(nodes) WITH ORDINALITY x(value,ordinality)
        WHERE x.value->'intent'->>'kind' <> 'editorial_only'
          AND x.ordinality <= n.ordinality)-1)/3+1
    )) INTO stage_count
    FROM jsonb_array_elements(nodes) WITH ORDINALITY n(value,ordinality)
    WHERE n.value->'intent'->>'kind' <> 'editorial_only';
    SELECT jsonb_agg(jsonb_build_object(
      'key','runtime_stage_'||g,
      'title','第'||g||'幕',
      'order',g,
      'afterStageKeys',CASE WHEN g=1 THEN '[]'::jsonb
        ELSE jsonb_build_array('runtime_stage_'||(g-1)) END
    ) ORDER BY g) INTO stages
    FROM generate_series(1,stage_count) g;
    timeline := jsonb_build_object('initialStageKey','runtime_stage_1','stages',stages);
  ELSE
    timeline := s->'timeline';
  END IF;
  INSERT INTO parallel_life.publication_story_plans(
    world_id,owner_id,binding_id,document,runtime_cutover_at
  ) VALUES(
    w,o,b.id,
    jsonb_build_object(
      'schemaVersion',1,
      'origin',s->'origin',
      'openingEventKey',opening,
      'timeline',timeline,
      'nodes',nodes,
      'conditions',COALESCE(s->'conditions','[]'::jsonb),
      'actors',(
        SELECT jsonb_agg(jsonb_build_object(
          'key',a.value->>'actorKey','id',a.value->>'actorId'
        ) ORDER BY a.ordinality)
        FROM jsonb_array_elements(s->'contacts') WITH ORDINALITY a(value,ordinality)
      ),
      'places',COALESCE(s->'places','[]'::jsonb),
      'history','[]'::jsonb
    ),
    now()
  );
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION parallel_life.ensure_agent_story_plan(text,text)
  FROM PUBLIC,pl_worker,pl_publisher;
GRANT EXECUTE ON FUNCTION parallel_life.ensure_agent_story_plan(text,text) TO pl_app;

-- Backfill existing Agent worlds. Their pre-cutover episodes remain immutable history;
-- authored occupancy is computed only from records created after this cutover.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT b.world_id,b.owner_id
    FROM parallel_life.publication_world_bindings b
    JOIN parallel_life.agent_runtime_worlds a
      ON a.world_id=b.world_id AND a.owner_id=b.owner_id AND a.engine_epoch>=2
  LOOP
    PERFORM parallel_life.ensure_agent_story_plan(r.world_id,r.owner_id);
  END LOOP;
END $$;
