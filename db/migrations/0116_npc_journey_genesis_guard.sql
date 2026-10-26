-- Preserve the full current trigger and its permissions; version-0 origins carry
-- JSON null rather than a fabricated event. All other ownership/attempt/result checks remain.
DO $migration$
DECLARE body text;
BEGIN
  body := pg_get_functiondef('parallel_life.guard_npc_journey()'::regprocedure);
  IF strpos(body, 'pos->>''sourceEventId''=NEW.origin_event_id') = 0 THEN
    RAISE EXCEPTION 'UNEXPECTED_NPC_JOURNEY_GUARD';
  END IF;
  EXECUTE replace(body, 'pos->>''sourceEventId''=NEW.origin_event_id',
    '(pos->>''sourceEventId'') IS NOT DISTINCT FROM NEW.origin_event_id');
END
$migration$;
