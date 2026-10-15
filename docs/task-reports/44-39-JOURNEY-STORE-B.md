# 44-39-JOURNEY-STORE-B

## 身份与范围

Owner codex-ma44-journey-store-b; root sole kernel/publiccontract/source/server/73projection and release owner. Independent /Users/limengzhe/.codex/worktrees/npc-director-progress/人生剧本; branch codex/ma-arch44-journey-store-b; base239fe493. Canonical short-lock registration, root explicitly allocated SQL80.77attention/78time/79episode remain other owners.

Allowed NEW files: db/migrations/0080_npc_journeys.sql, src/modules/world/infrastructure/agent-journey-repository.ts, tests/integration/agent-journey.test.ts and own report. Root additionally authorized minimal existing agent-travel.ts/tests command-ID compatibility repair after finding the original colon ID incompatible with actual world-history validation. No other existing domain, kernel, server, source, clock,73projection or migration files changed.

## 当前接续点

**待验收, source frozen2b8af04a** (exactly5source/test/SQL files). Root confirmed function protocol and exact arrival event data before implementation. No source edits after freeze. Report commit follows separately. PG55503 started only after no-listener check; confirmed postgres59864 had own data directory and parent59861 was own local-db cwd; gracefully TERM parent, session34169 exit0. Listener cleanup verified at handoff.0realmodel/production/browser/fullcheck/fullbuild. Root performs unified integration and release after actual wiring.

## Frozen persistence protocol

- `recordAgentDepartureInTransaction(sql,owner,{attempt,journey})` -> `{status:recorded|replayed,journey}`. Caller must use the SAME world/NPC UoW SqlClient AFTER actual `finishAgentCommitInTransaction` persisted action results and marked committed. Locks world then ledger, authenticates actual committed attempt/token/command/source event/result and identity. First insert also requires transaction-local app.agent_commit_attempt_id/world/epoch, real `travel.begin` proposal action + executed state action with same routeId/resultId, runtime exact results and server-certified `agentRuntime.departures` containing that exact journey once. Ordinary plan.record or any other succeeded result does not suffice.
- `recordAgentArrivalInTransaction(sql,owner,{journey})` -> same result. Exact prior immutable departure basis, CAS in_transit revision0→arrived revision1. Root must already have anchored lawful current world_clock.story_now and committed its dedicated canonical event+successful command in this same SQL transaction. Exact event type `agent.arrival_committed`, data `{actorId,journeyId,departureEventId,route,arrival}`; route is original pinned SpaceRoute and arrival is independent AgentArrivalReceipt. Current world version, command expectedversion, receipt event/version/time, current epoch, unpaused clock and ETA all checked. No old goal or fabricated arrival action/result. Active NPC attempt marker must be absent for this distinct continuation.
- `readAgentJourneysInTransaction(sql,owner,{worldId,actorId})`: authenticated own-owner/explicit actor ledger only. No initialization/write/player-position query.
- `readDueAgentJourneysInTransaction(sql,owner,{worldId,actorId?,storyAt})`: director/server-only read view, only in_transit and due at supplied explicit-offset storyAt<=persisted current clock anchor; paused returns empty. Rechecks clock pause/anchor in final rows query. No wall-time projection, scheduler execution, paid model call or always-held connection. Actual execution must reload/lock/re-evaluate fresh.
- `PostgresAgentJourneyRepository.readOwn/readDue` wraps those readers in short owner transactions using the supplied pool, whose lifecycle remains owned by application composition. No write convenience wrapper creates an independent transaction.
- Repository checks exact canonical domain shape through pure departure/arrival functions and whitelisted frozen domain outputs. Malformed/extra-field/noncanonical journey rejected; this is consistency checking, while SQL source authentication supplies authority. Replay after original departure later arrived returns that completed journey, never reopens it. Changed replay is conflict.

## SQL80

Single new npc_journeys table. Owner/world/actor/engine, immutable original origin/route/begin action/result/event/attempt refs, story departure/ETA, status/revision, nullable independent actual arrival refs and full bounded document. FK world+owner, actor state, actual attempt, actual action result and same-world/owner/version original/departure/arrival events and arrival command. World-event-authored route has generated source event/version columns with its own same-world/owner/version FK; genesis route retains source exactly and must match existing actual map route. No new source table, goal, action enum or migration changes elsewhere.

PK world/journey; unique world/actor/begin-action; partial unique one active journey peractor; independent world-unique arrival command/event/receipt. FORCE RLS owner policy. pl_app only SELECT/INSERT/UPDATE; no DELETE, no worker/publisher/PUBLIC grants. Guard is SECURITY INVOKER, fixed pg_catalog search_path and no generic definer authority. GUC alone never certifies a journey.

Trigger prevents changing any original basis or reopening/removing completion, independently authenticates full actual source graph/effect/own position, and validates only revision0→1. Generated route-source columns are excluded from BEFORE-trigger physical-row comparison because PostgreSQL computes them afterward; their entire source route JSON remains immutable and their FK remains enforced.

Own73 projection may be checked before or after root updates it in the SAME UoW: departure accepts original at-source or exact new in_transit source; arrival accepts exact original in_transit source or exact new at-arrival source. Both restrict subject_key to this actor, verify exact source/version/time/place and never read or return player position. Repo does not itself mutate73.

## Command-ID interface repair

Original44-31 helper produced `journey:j:arrival`, incompatible with existing validation.validateEventId (colon forbidden, max64). This task fixes it to stable `arrival_<journeyId>` and rejects journey IDs outside `[a-zA-Z0-9_-]{1,56}` during prepare and basis checks. Root server UUIDs fit. Domain has no Node crypto/network import. Actual validateEventId test covers UUID, tiny and max-length IDs, overlength/colon/space/nonASCII rejection. SQL80 uses the same stable safe command rule. Root still must add the actual new arrival event type/reducer to history replay; safe ID alone does not implement replay support.

## Actual validation

- Final pure23/23, zero skip. Includes actual history ID validator and previous origin/route/time/receipt/goal-withdrawal separation tests.
- New real PostgreSQL19/19, zero skip (parent+18subtests). Actual persistent runtime accept→claim→request_sent→save local stub response→begin commit→real command/event/outbox/finish state/results→record ledger. No actual kernel capability or real AI execution is claimed: test-only explicit synthetic source fixtures exercise storage authentication, using actual runtime commit helpers. Origin setup uses explicitly synthetic test.fixture_setup storage evidence, not a claimed implemented genesis setup feature.
- Final combined new journey+existing agent-runtime realPG49/49, zero skip, after final SQL route-source FK addition.
- Positive: immutable departure; independent due arrival; exact read-only replays; completed departure replay stays arrived; late lawful settlement uses actual current time, no backdate; event-authored route source remains valid through arrival; own scoped reads/due view.
- Negative: arbitrary nontravel succeeded result, omitted certified effect, unfinished attempt/result, wrong token/owner/commit marker, future unanchored time, paused world, wrong arrival event type/source/pinned route, wrong own physical projection, edited/reopened basis and changed replay, DELETE/worker SELECT. Failure rolls back actual event/world/state/outbox. Actual cross-world/owner route evidence fails the FK and rolls back.
- Concurrency: two independently sourced starts in one transaction hit real partial unique active-actor constraint and fully roll back; two arriving deliveries serialize on world/ledger to one recorded+one replayed and one actual arrival event.
- Actual ACL check proves worker/publisher SELECT false and FORCE RLS true. No secrets/private player materials.
- Final typecheck0errors, boundary551files, focused Prettier/diff checks PASS.

Initial implementation failures retained: Node strip-only mode rejected a TS constructor parameter property (replaced with explicit field); type narrowing fixed by declaring throwing helper as function. First positive PG run exposed JSONB @>/arrow operator precedence; fixed with parentheses. Only own never-released local SQL80 prototype table/function/migration row was recreated to validate changed80; all older applied migrations/checksums remained untouched. Final19/49 validations passed after prototype fixes.

## Root wiring and release blockers

This commit enables **no runtime ability**. Root must register/validate actual travel.begin, construct transition.departures, persist real world effects/commands/events in reducer/history, call departure record after finish, update73 positions and any actual witnesses, and add durable due/outbox/lease execution. Separate trusted physical continuation must not go through ordinary goal eligibility, be offered to the model or inherit goal/appointment cancellation. Original safe route endpoint remains pinned; invalidating active anchors needs explicit sourced reconciliation. No forced player movement, auto attendance/room entry/goal fulfillment, private path leak or retroactive presence.

Root must supply lawful time anchoring under existing attention/pause policy before readDue/arrival commit; no call may advance wall time solely to finish a journey. Database helpers do not authorize a clock jump or source creation. Current epoch must match stored journey; a future engine migration requires explicit reconciliation rather than silently bypassing the fence. Existing unknown NPC positions remain unknown pending legitimate authored/new-world setup or historical physical evidence.

Root integration must perform required fullcheck/build, migration checksum review/application and READY/public actual flow acceptance. Production unchanged by this delivery, actual capability not claimed online. Canonical task remains待验收 until those gates are satisfied.
