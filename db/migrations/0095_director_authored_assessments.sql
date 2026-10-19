-- Optional, immutable evidence of which authored opportunities a Director actually assessed.
-- Older decisions stay unchanged; a catalogue snapshot alone is not a new assessment.
CREATE FUNCTION parallel_life.valid_director_authored_assessments(document jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb; seen text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(document) IS DISTINCT FROM 'array' OR jsonb_array_length(document)>128 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(document) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object'
   OR NOT (item ?& ARRAY['nodeKey','nodeHash','qualificationKey','decision','reason'])
   OR item - ARRAY['nodeKey','nodeHash','qualificationKey','decision','reason']<>'{}'::jsonb
   OR jsonb_typeof(item->'nodeKey') IS DISTINCT FROM 'string'
   OR length(item->>'nodeKey') NOT BETWEEN 1 AND 240
   OR jsonb_typeof(item->'nodeHash') IS DISTINCT FROM 'string' OR (item->>'nodeHash') !~ '^[a-f0-9]{64}$'
   OR jsonb_typeof(item->'qualificationKey') IS DISTINCT FROM 'string' OR (item->>'qualificationKey') !~ '^[a-f0-9]{64}$'
   OR jsonb_typeof(item->'decision') IS DISTINCT FROM 'string'
   OR (item->>'decision') NOT IN ('consider','defer')
   OR jsonb_typeof(item->'reason') IS DISTINCT FROM 'string' OR length(btrim(item->>'reason')) NOT BETWEEN 1 AND 2000
   OR (item->>'nodeKey')=ANY(seen)
  THEN RETURN false; END IF;
  seen:=array_append(seen,item->>'nodeKey');
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION parallel_life.valid_director_authored_assessments(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parallel_life.valid_director_authored_assessments(jsonb) TO pl_app;
DO $$ DECLARE constraint_name text; matches integer; BEGIN
 SELECT count(*),min(conname) INTO matches,constraint_name FROM pg_constraint
 WHERE conrelid='parallel_life.director_decisions'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%jsonb_typeof(document)%'
 AND pg_get_constraintdef(oid) LIKE '%evaluatedThroughVersion%';
 IF matches<>1 THEN RAISE EXCEPTION 'DIRECTOR_DOCUMENT_CONSTRAINT_NOT_UNIQUE'; END IF;
 EXECUTE format('ALTER TABLE parallel_life.director_decisions DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE parallel_life.director_decisions ADD CONSTRAINT director_decision_document_shape_v4 CHECK(
 jsonb_typeof(document)='object' AND octet_length(document::text)<=1048576
 AND document ?& ARRAY['schemaVersion','id','worldId','engineEpoch','worldVersion','inputHash','evaluatedThroughVersion','mode','selectedCandidateIds','deferred','nudges','opportunities','audit']
 AND document - ARRAY['schemaVersion','id','worldId','engineEpoch','worldVersion','inputHash','evaluatedThroughVersion','mode','selectedCandidateIds','deferred','nudges','opportunities','audit','authoredAssessments']='{}'::jsonb
 AND document->'schemaVersion'='1'::jsonb AND (document->>'id') IS NOT DISTINCT FROM id AND (document->>'worldId') IS NOT DISTINCT FROM world_id
 AND document->'engineEpoch' IS NOT DISTINCT FROM to_jsonb(engine_epoch) AND document->'worldVersion' IS NOT DISTINCT FROM to_jsonb(world_version)
 AND (document->>'inputHash') IS NOT DISTINCT FROM input_hash AND document->'evaluatedThroughVersion' IS NOT DISTINCT FROM to_jsonb(evaluated_through_version)
 AND document->>'mode' IN ('quiet','coordinate','bounded_opportunity')
 AND jsonb_typeof(document->'selectedCandidateIds')='array' AND jsonb_typeof(document->'deferred')='array'
 AND jsonb_typeof(document->'nudges')='array' AND jsonb_typeof(document->'opportunities')='array' AND jsonb_typeof(document->'audit')='object'
 AND (document->>'mode'<>'quiet' OR (document->'selectedCandidateIds'='[]'::jsonb AND document->'nudges'='[]'::jsonb AND document->'opportunities'='[]'::jsonb))
 AND (NOT (document ? 'authoredAssessments') OR parallel_life.valid_director_authored_assessments(document->'authoredAssessments'))
);
