-- A fully saved quiet decision needs no new model call and creates no episode.
-- Reuse the immutable known-result receipt; ownership, raw hash, original input
-- and the existing guarded transition remain unchanged. No new table or column.
ALTER TABLE parallel_life.director_handoff_revalidations
 DROP CONSTRAINT director_handoff_revalidations_opportunity_ids_check;
ALTER TABLE parallel_life.director_handoff_revalidations
 ADD CONSTRAINT director_handoff_revalidations_opportunity_ids_check
 CHECK(jsonb_typeof(opportunity_ids)='array' AND jsonb_array_length(opportunity_ids) BETWEEN 0 AND 2);
