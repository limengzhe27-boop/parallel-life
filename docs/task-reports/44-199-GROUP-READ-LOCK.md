# 44-199 group read lock removal

Owner scheduler199; root approved only `group-repository.ts` read/list, its private snapshot helper, new focused PG test, this report. No production writes, schema, fields, model calls or permission changes.

## Production read-only diagnosis

Sampling during the reported slow request found six concurrent `publication_story_offer_context` queries growing from ~19 to ~33 seconds. A writer/hydrate transaction blocked group `SELECT state,version,owner_id ... FOR SHARE`, and queued world `FOR UPDATE` readers/writers reached 21–23 seconds. An advance-operation insert waited ~30 seconds behind that transaction. WALInsert/BufferContent pressure was also observed.

Cumulative pg_stat_statements: group header FOR SHARE 37,554 calls, mean135ms/max47.5s; offer context 106,506 calls, mean33.7ms/max50s. These are cumulative totals, not this deploy's latency distribution. At sampling, proactive leases46/live34. Only23 authored story nodes exist across18 worlds; only2 have both source event and invitation. Root owns the offer-query investigation/fix.

No model call was found inside the current private snapshot database transaction: snapshot returns before runNpcAgent. However readActorSituation acquires a world SHARE lock and keeps it across further snapshot queries; root owns that separate scope.

## Implemented

PostgresGroupRepository.read/list now open `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, bind the original owner identity, and pass existing `readonlySnapshot=true` to the existing load functions. This removes world row SHARE locks on ordinary GETs while preserving a consistent snapshot and RLS. Error rollback and pool release remain explicit.

markRead, mutate, send, worker loads and all world write locks/versions remain unchanged. Ordinary world.get already has no SHARE lock, so it was not changed blindly. No new abstraction layer or business state.

## Evidence

`tests/integration/group-read-lock199.test.ts`, dedicated PostgreSQL55659, 1/1:
- hold another transaction's world FOR UPDATE; list and read both finish before the two-second failure guard;
- wrong owner receives NOT_FOUND;
- inject a committed group title change after the header read; list retains original group title in the same snapshot, next read sees new title.

Typecheck0 errors / boundaries719 passed; integrated check/build/deployment belongs to root. This fix removes the read/write lock convoy but does not claim to solve the separately observed slow offer SQL or database resource pressure.
