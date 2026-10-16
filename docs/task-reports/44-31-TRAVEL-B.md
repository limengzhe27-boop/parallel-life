# 44-31-TRAVEL-B

## 身份与范围

- Owner: codex-ma44-travel-b; root sole public contract, kernel, SQL, source, runtime and release owner.
- Independent workspace: /Users/limengzhe/.codex/worktrees/npc-director-progress/人生剧本; branch codex/ma-arch44-travel-b; frozen base fe7e9432.
- Allowed paths: new src/modules/world/domain/agent-travel.ts, tests/agent-travel.test.ts and this report; own canonical registry row/main report mirror under short lock.
- Root confirmed interface before implementation. No existing source, UI, time, migration or runtime files changed. No model, database, production or full-build actions.

## 当前接续点

**待验收 / source frozen 055f986d.** Pure module and22focused tests complete. Root must review and wire real kernel/transaction/source/scheduler paths; this commit does not enable NPC mobility. Source files will not be edited after this freeze without a new assigned followup.

The earlier human time reply cited old39 report and its obsolete30-second reading heuristic. It is not part of this task or source: root current business-attention rule holds conversation reading/thinking at1x. This task performs no time policy changes.

## Frozen function/type boundary

- `prepareAgentTravel({frame,boundary,ownPosition,routes,intent,existingJourneys})`: ordinary kernel eligibility must already hold. Returns ready with **planned** AgentTravelPlan, or explicit missing/unsupported/blocked reason. Never uses player position, address/contact, NPC speech, new route/default duration or machine wall time.
- `commitAgentDeparture(plan, AgentActionResult)`: verifies same world/actor/action, successful next-version actual receipt, distinct event and exact departure instant. Returns **in_transit** AgentJourney with immutable original source, route/provenance, begin action, result and event refs.
- `evaluateAgentArrival({frame,journey,ownPosition})`: own actual in_transit projection must match original departure event/version/time; before ETA returns waiting, at/after ETA returns **ready continuation**, never arrived. Dedicated stable command identity `journey:<id>:arrival` does not encode old world version. No old goal/episode/invitation status input. Persisted completion returns already_arrived even after later lawful movement.
- `commitAgentArrival(continuation, AgentArrivalReceipt)`: receipt is a distinct server continuation record, not a fabricated goal-bound action/result. Requires fresh expected version+1, original journey/world/actor, distinct actual event/receipt and current settlement time>=ETA. Returns **arrived** revision1; no appointment attendance, old goal fulfillment or shared episode completion.
- All outputs whitelist fields, detach nested data and recursively freeze. Time inputs reuse existing `worldDateTimeInput` explicit-offset/calendar validation (including fractional seconds and offsets), normalize to UTC milliseconds, display via existing UTC+08 helper. No new time protocol. Route duration matches existing space domain1..120integer minutes.

## Trust and integration requirements

Pure functions verify **structure and consistency**, not SQL authenticity. No model-supplied trusted flag can authorize a position, route, receipt or continuation. Caller must authenticate stored/same-transaction inputs and exact travel-effect payload before calling commit functions. A perfectly forged plain object with matching fields is not cryptographically or database authenticated by this module.

Root wiring points / remaining blockers:

1. `infrastructure/npc-agent-kernel.ts`: register a real begin ability only after common action/source/access/goal eligibility. Resolve actor's actual73 position from the same transaction, never world.space.currentPlaceId (player position); pin existing authorized route. Update transaction-local own position immediately so later same-turn spatial actions cannot use stale origin.
2. Real journey ledger migration/repository: persist independent journeyId, owner/world/actor, original origin/route snapshot and source/action/result/event refs, departedAt/ETA and revision. Enforce unique world journeyId, unique actor begin action and one in_transit journey peractor. New events/results/journey/73 position/receipts/outbox must commit atomically. No caller-only list check substitutes for database uniqueness. ExistingJourney inputs include only authenticated same-world records at/before current frame.
3. Server-only continuation via existing kernel/UoW, not a model capability. Persist due wake/outbox through existing durable tasks; preserve lease/owner/epoch/world CAS. Evaluate fresh journey revision/current own in_transit proof and current world story time under transaction lock, then independently record arrival event/receipt and73 at-position. Stable continuation command+unique receipt makes repeat task execution/recovery replay one completion. No process-local timer or paid call is needed for physical settlement.
4. Goal, appointment or shared-event withdrawal cannot cascade-delete the physical journey. Honor pinned originally legal safe endpoint; later ordinary invitation/goal expiry cannot strand the actor. Future boundary deletion/forced relocation needs its own authenticated reconciliation, not silent arrival to a new place. API intentionally does not re-resolve route against current mutable goals or map to veto physical settlement.
5. Do not advance clock to complete a journey or count offline/pause wall time. A late valid settlement records **current** story time; ETA remains only earliest lawful time. No retroactive room hearing/attendance. Serialized arrival is its own canonical command; do not mutate already accepted player expectedVersion/hash invisibly.
6. Source authorization/snapshots: own full journey may be available to that NPC; other witnesses only clipped actual authorized observation, no destination/player location feed. Arrival may wake that NPC for fresh consideration without forcing a message or goal completion.
7. Genesis setup remains required for real known initial NPC positions; existing unknown saves stay unknown until sourced actual history/setup legitimately supplies truth. No read-side address/contact fallback. Actual room-entry/access/attendance abilities are separate future work.

## 交付与验证

- Source/test commit: **055f986d** (exactly2newfiles). Report separate commit to follow.
- Final focused test22/22, zero skips; actual shared `evaluateAgentActionEligibility` confirms withdrawn goal blocks new ordinary begin while an already-started journey still yields ready arrival continuation.
- Other coverage: planned vs started vs arrived; real own origin identity/event/version/time; missing/foreign/future origin; finite boundary and directed route; invalid/duplicate route/duration/provenance; timezone-less/rollover rejection, legitimate UTC+08 offset and6digitfraction normalization; failed/mismatched/reused receipts; duplicate journey/action/active trip; future ledger; early/late settlement; stale frame; replay; next trip after arrival; independent actor concurrency; immutable detached private-field-free output.
- Final `npm run typecheck` passed; boundary checks549files passed; focused Prettier and diff whitespace checks passed.
- Earlier validation failures retained honestly: first type run found a test-only readonly-array cast; corrected to mutate only fixture object. Future-ledger hardening then rejected a duplicate-test fixture whose frame was older than its departure receipt; corrected fixture to current version5. Final22/22 and typecheck passed afterward.
- No real model, PG, browser, production, migrations, fullcheck or fullbuild. Per explicit root scope, full integrated check/build and deployment belong to root after actual wiring.
- No secrets, private photos, interviews or live save modifications.

## 集成验收

Pending root review/cherry-pick and subsequent runtime/SQL/lease/source/integration evidence. This delivery proves pure deterministic rules only, **not** enabled NPC travel, scheduler execution or online availability. Main task remains待验收, not completed.
