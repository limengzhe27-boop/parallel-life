-- Business attention lives on the existing expiring client lease. It is not presence or consent.
ALTER TABLE parallel_life.world_clock_activity ADD COLUMN focus jsonb;
ALTER TABLE parallel_life.world_clock_activity ADD CONSTRAINT clock_activity_focus_shape CHECK (
 focus IS NULL OR (
  mode='conversation' AND jsonb_typeof(focus)='object'
  AND focus ?& ARRAY['channel','threadId'] AND focus-ARRAY['channel','threadId']='{}'::jsonb
  AND jsonb_typeof(focus->'channel')='string' AND focus->>'channel' IN ('private','group','scene')
  AND jsonb_typeof(focus->'threadId')='string'
  AND char_length(focus->>'threadId') BETWEEN 1 AND 240 AND length(btrim(focus->>'threadId'))>0
 )
);
-- Existing owner RLS and app-only grants remain unchanged; no worker access is introduced.
