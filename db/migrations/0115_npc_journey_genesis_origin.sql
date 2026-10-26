-- Genesis positions (0087) have a real authored version-0 origin and no event ID.
-- Keep the existing journey/attempt/result/position guards and all foreign keys;
-- only admit the same origin shape already accepted by AuthoritativePosition.
ALTER TABLE parallel_life.npc_journeys ALTER COLUMN origin_event_id DROP NOT NULL;
ALTER TABLE parallel_life.npc_journeys DROP CONSTRAINT npc_journeys_origin_version_check;
ALTER TABLE parallel_life.npc_journeys ADD CONSTRAINT npc_journeys_origin_version_check
  CHECK (origin_version >= 0 AND
    ((origin_version = 0 AND origin_event_id IS NULL) OR
     (origin_version > 0 AND origin_event_id IS NOT NULL)));
