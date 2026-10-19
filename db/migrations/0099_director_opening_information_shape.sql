-- Extend immutable director decision shape for the bounded opening information capability only.
ALTER TABLE parallel_life.director_decisions DROP CONSTRAINT director_decision_document_shape_v4;
ALTER TABLE parallel_life.director_decisions ADD CONSTRAINT director_decision_document_shape_v5 CHECK(
 jsonb_typeof(document)='object' AND octet_length(document::text)<=1048576
 AND document ?& ARRAY['schemaVersion','id','worldId','engineEpoch','worldVersion','inputHash','evaluatedThroughVersion','mode','selectedCandidateIds','deferred','nudges','opportunities','audit']
 AND document - ARRAY['schemaVersion','id','worldId','engineEpoch','worldVersion','inputHash','evaluatedThroughVersion','mode','selectedCandidateIds','deferred','nudges','opportunities','audit','authoredAssessments','openingContext']='{}'::jsonb
 AND document->'schemaVersion'='1'::jsonb AND (document->>'id') IS NOT DISTINCT FROM id AND (document->>'worldId') IS NOT DISTINCT FROM world_id
 AND document->'engineEpoch' IS NOT DISTINCT FROM to_jsonb(engine_epoch) AND document->'worldVersion' IS NOT DISTINCT FROM to_jsonb(world_version)
 AND (document->>'inputHash') IS NOT DISTINCT FROM input_hash AND document->'evaluatedThroughVersion' IS NOT DISTINCT FROM to_jsonb(evaluated_through_version)
 AND document->>'mode' IN ('quiet','coordinate','bounded_opportunity')
 AND jsonb_typeof(document->'selectedCandidateIds')='array' AND jsonb_typeof(document->'deferred')='array'
 AND jsonb_typeof(document->'nudges')='array' AND jsonb_typeof(document->'opportunities')='array' AND jsonb_typeof(document->'audit')='object'
 AND (document->>'mode'<>'quiet' OR (document->'selectedCandidateIds'='[]'::jsonb AND document->'nudges'='[]'::jsonb AND document->'opportunities'='[]'::jsonb))
 AND (NOT (document ? 'authoredAssessments') OR parallel_life.valid_director_authored_assessments(document->'authoredAssessments'))
 AND (NOT(document ? 'openingContext') OR (
 jsonb_typeof(document->'openingContext')='object'
 AND document->'openingContext' ?& ARRAY['reviewKey','disposition','reason','premises']
 AND (document->'openingContext') - ARRAY['reviewKey','disposition','reason','premises']='{}'::jsonb
 AND document#>>'{openingContext,reviewKey}' ~ '^[a-f0-9]{64}$'
 AND document#>>'{openingContext,disposition}' IN ('confirm','defer')
 AND length(btrim(document#>>'{openingContext,reason}')) BETWEEN 1 AND 1600
 AND jsonb_typeof(document#>'{openingContext,premises}')='array'
 AND jsonb_array_length(document#>'{openingContext,premises}')<=12
 AND CASE WHEN document#>>'{openingContext,disposition}'='confirm' THEN jsonb_array_length(document#>'{openingContext,premises}')>0 AND document->>'mode'<>'quiet' ELSE document#>'{openingContext,premises}'='[]'::jsonb END
 ))
);
