-- 0127 stored JSON null timeline values for authored libraries without a timeline.
-- Repair those just-created runtime plans once; player episodes and receipts are untouched.
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
  IF (s->'timeline' IS NULL OR jsonb_typeof(s->'timeline')='null')
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

-- Derive only the runtime timeline on an already-stored plan. No player record is touched.
CREATE OR REPLACE FUNCTION parallel_life.agent_story_with_timeline(d jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
WITH original AS (
  SELECT value,ordinality FROM jsonb_array_elements(d->'nodes') WITH ORDINALITY
), exec AS (
  SELECT value,ordinality,row_number() OVER (ORDER BY ordinality) rn
  FROM original WHERE value->'intent'->>'kind' <> 'editorial_only'
), numbered AS (
  SELECT value,ordinality,((rn-1)/3)::int+1 stage_no FROM exec
), compiled_nodes AS (
  SELECT jsonb_agg(
    CASE WHEN o.value->'intent'->>'kind'='editorial_only' THEN o.value
    ELSE jsonb_set(o.value,'{timeline}',jsonb_build_object(
      'stageKey','runtime_stage_'||n.stage_no,
      'excludeIfResolved','[]'::jsonb,
      'alternatives',jsonb_build_object(
        'onDeclined','[]'::jsonb,'onSkipped','[]'::jsonb,'onExpired','[]'::jsonb
      )
    )) END ORDER BY o.ordinality) nodes
  FROM original o LEFT JOIN numbered n ON n.ordinality=o.ordinality
), stage_count AS (
  SELECT COALESCE(max(stage_no),0)::int n FROM numbered
), stages AS (
  SELECT CASE WHEN (SELECT n FROM stage_count)=0 THEN '[]'::jsonb
    ELSE (SELECT jsonb_agg(jsonb_build_object(
      'key','runtime_stage_'||g,
      'title','第'||g||'幕',
      'order',g,
      'afterStageKeys',CASE WHEN g=1 THEN '[]'::jsonb
        ELSE jsonb_build_array('runtime_stage_'||(g-1)) END
    ) ORDER BY g) FROM generate_series(1,(SELECT n FROM stage_count)) g) END stages
)
SELECT CASE
  WHEN jsonb_typeof(d->'nodes') <> 'array'
    OR (d->'timeline' IS NOT NULL AND jsonb_typeof(d->'timeline')<>'null')
    OR (SELECT n FROM stage_count)=0 THEN d
  ELSE jsonb_set(
    jsonb_set(d,'{nodes}',(SELECT nodes FROM compiled_nodes)),
    '{timeline}',jsonb_build_object(
      'initialStageKey','runtime_stage_1','stages',(SELECT stages FROM stages)
    )
  )
END
$$;
REVOKE ALL ON FUNCTION parallel_life.agent_story_with_timeline(jsonb) FROM PUBLIC,pl_worker,pl_publisher;

-- The repair is limited to plans created by 0127; no player episode/receipt is changed.
ALTER TABLE parallel_life.publication_story_plans DISABLE TRIGGER story_plan_immutable;
UPDATE parallel_life.publication_story_plans p
SET document=parallel_life.agent_story_with_timeline(p.document)
WHERE (p.document->'timeline' IS NULL OR jsonb_typeof(p.document->'timeline')='null')
  AND jsonb_typeof(p.document->'nodes')='array'
  AND EXISTS(SELECT 1 FROM parallel_life.agent_runtime_worlds a
             WHERE a.world_id=p.world_id AND a.owner_id=p.owner_id AND a.engine_epoch>=2);
ALTER TABLE parallel_life.publication_story_plans ENABLE TRIGGER story_plan_immutable;
