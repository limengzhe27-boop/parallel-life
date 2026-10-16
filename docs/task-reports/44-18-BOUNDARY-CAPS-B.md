# 44-18-BOUNDARY-CAPS-B

Owner codex-ma-arch44-boundary-caps-b; root sole public-contract/kernel/SQL/integration/release owner. **Design/read-only delivery only.** Root source inspected at cd72d339, then ddc59465 plus explicitly visible WIP; no source/SQL/model/PG/production/test/build action. Only this report and own main registry row changed. No unused runtime module or migration number reserved.

## Current implementation and hard boundaries

Actual npc-agent-kernel capability execution is only plan.record and appointment.propose. The shared eligibility function checks active goals, related plans/triggers, actual own location and trusted results. Kernel loads ownActual before its action loop; this is adequate for current nonmovement capabilities, but future spatial actions must update/read the transaction-local spatial state after each execution, or a begin→observe sequence could incorrectly reuse the predeparture location. A unique active-journey constraint is still required even with application preflight.

73 AuthoritativePosition already supports at/in_transit/unknown but only placeId/source event/version/time; it has no journey ID/destination clock. Positions require actual positive source_version/event FK. ActorPositionKnowledge separately stores at/left/absent/report, source kind, learnedAt/occurredAt/possiblyStale. Current runtime positionKnowledge branch only accepts player_report report with explicit input receipt/quote; do not insert physical room observations into that report channel without a new validated typed effect.

75 shared_episodes remains immutable proposed/revision0, without NPC UPDATE permission. Do not turn individual mobility, RSVP or observation into direct shared-episode completion, or grant generic NPC writes to that table. Controlled kernel lifecycle/criteria transitions require a later migration.

No exported type literally named SameAgentSource was found in the inspected source. The actual common protocol is AgentSource + readActorStrategyBasis/forgottenAgentSourceIds, private/native snapshot builders, attachAgentWorldContext and final kernel authorization. Use these actual interfaces and add verified source kinds/handles there; do not claim a new similarly named runtime already exists.

## Willingness, support and execution are separate

An NPC may want an unsupported activity. Product limitations must not force every personality to reject it or pretend it happened. Keep the person's wish/stance in its own valid goal/plan/expression; render product limits as product UI, not a fictional NPC quote.

Proposed smallest compatible additions (root contracts, **not implemented**):

```
AgentProposal.intentReports?: [{
  id, goalId?,
  kind: travel | meet | observe | other,
  knownActorIds: [], knownPlaceIds: [],
  description, sourceIds: []
}]

IntentOrActionDisposition = {
  ref: {kind: intent | action, id},
  status: supported | unsupported | blocked,
  executed: boolean,
  reasonCode,
  missingConditions: [],
  availableOptions: [{registeredCapabilityKey, allowedObjectRefs}]
}

AgentActionResult.failure?: {code, evidenceSourceIds: []}
```

IntentReport is a bounded, source-owned **semantic desire**, never an executable capability name. Description remains an attributed wish/plan, not a new city/person/fact. Unknown destinations remain text without minting place IDs. No arbitrary requestedCapability is added to a registry, and a supported intent still needs a separately validated AgentAction/explicit player choice before execution. Records can live in the same actual event's runtime metadata; existing NPC goal state stays the sole goal store, not another intent agent/database.

- **Supported:** exact implemented registry key, validated strict parameter schema, actor/channel/object permission and ready conditions. Execution produces actual succeeded/failed AgentActionResult, retaining today's two-outcome enum. Only registered ability may certify completedGoalIds.
- **Unsupported:** a legitimate semantic intent lacks product capability/boundary support. executed=false, disposition reason CAPABILITY_NOT_AVAILABLE/OUTSIDE_WORLD_BOUNDARY; no fake ActionResult or ready action. Product alternatives come only from actually implemented/currently authorized capabilities. For today's two caps that may be recording a plan or proposing an invitation, not an invented travel button.
- **Blocked:** implemented ability but time/location/dependency/access missing. executed=false; action waiting/blocked plus deterministic missing conditions/reconsider source. Do not label waiting a failed physical execution. A genuinely attempted registered action that fails has outcome=failed with kernel reason/evidence, no handled responsibilities/completed goals.
- Broken identity/private source/invalid graph/CAS/tampered receipt remains a hard reject. Unknown action.capability currently rejects the whole turn as known invalid; keep that security property until a separately reviewed compatibility strategy exists. The ordinary unsupported-wish path should use intentReports, avoiding invalid actions in the first place.
- Independently valid dialogue survives a well-formed unsupported intent/blocked/failed action. Any statement dependent on an unsuccessful action, or its unsuccessful dependency closure, is suppressed. Never publish “arrived/cancelled/saw them” merely because the model proposed it. Existing reducer already suppresses direct unsuccessful dependencies; new capability graph validation must preserve acyclic/transitive dependency correctness.
- Do not silently delete an unknown action and accept dangling plan/decision references. Optional later speech-only recovery must independently validate voice/privacy/source, preserve existing state, discard unsafe graph changes and return explicit partial disposition; it must not pretend a dropped player decision/state change was processed. This is not the first implementation phase or a generic prose sanitizer.
- Unsupported UI feedback is visible only for player-visible requests/explicitly shared intent. Do not reveal an NPC's private unsupported plan through a global product banner. Never auto-generate a uniform NPC refusal, affection penalty or consolation script.

## Capability contracts

### actor.travel.begin — ordinary NPC action, with exact actual start

Proposed parameters `{routeId}` only in the first phase. Actor/world come from the authenticated attempt. Destination/from/duration/mode/policy and all timestamps come from the verified route and actual position, not model fields. Require:

- Current actor actual position status=at and exact fromPlaceId; unknown/in_transit cannot start. ContactActorIds, job/address, invitation and a spoken “I'm at X” are not actual location.
- One existing available directed route whose from equals this actor's actual place; registered route duration/policy and boundary target place. WorldSpaceState.currentPlaceId belongs to **player** and must not be temporarily changed to reuse player-specific route validation. First phase can support only explicit routes; broader path policy must accept actual actor from explicitly and remain deterministic.
- Real route/access permission. A known map place is not permission to enter private rooms. Start with public/reachable map endpoints; indoor entry needs its own access/zone evidence. No arbitrary city/place/route duration or implicit extra leg.
- Active own goal/plan and legal conditions under the ordinary eligibility function; current actor/world/epoch CAS. A busy person's willingness remains independent of system execution eligibility.

Same UoW creates an immutable journey start, start ActionResult **meaning departure started only**, at→in_transit position, legitimate source-observer departures, this actor's actual old-scene exit, durable due continuation/outbox and final event/receipt. Keep other actors present. Compute departedAt from kernel's current projected story time at commit; plannedArrivalAt=departedAt+verified duration. Do not use an earlier model snapshot time to make the journey already over.

### actor.travel.arrive — trusted continuation, not a fresh goal-dependent model action

**Recommendation:** register this as a server-only WorldKernel continuation. Do not advertise it in NPC channel.allowedCapabilities. Minimal command `{journeyId, expectedJourneyRevision}` with verified server task/source scope; actor/world/destination derive from the original journey. No client/model trusted=true/bypassGoal parameter.

Why: current AgentAction always has goalId, ordinary eligibility blocks withdrawn goals, and agent_action_results is unique by(world,actor,actionId). Reusing the begin action/result, inventing an active system goal or blindly skipping eligibility by capability string would be incorrect. A physically started trip must settle even after its purpose is withdrawn.

Smallest clean integration is a typed KernelContinuation invocation plus an actual `actor.journey_arrived` event/receipt within the **same kernel/UoW/source infrastructure**, not a second AI runtime. The begin result already certifies start; arrival has a separate immutable journey-arrival receipt/source. Plans use observation(journey-arrival source) + actual at_place, rather than a fabricated second result for the same begin action. If root instead wants all completions in AgentActionResult, explicitly extend the invocation/result contracts to support goal-independent physical continuations; do not smuggle one through current mandatory goalId/reducer rules.

Arrival validates original same-world/same-actor journey, begin event/result, exact active journey revision, actual position still in_transit tied to that begin source, unchanged route authorization sufficient to reach its original safe endpoint, and current story time>=plannedArrivalAt. It cannot teleport to a model-selected destination or finish an unrelated journey. It does **not** require the old goal/episode/invitation to remain active. Finish at original safe destination, then the NPC may independently decide its next plan. A new redirect/interrupt ability can be added later with its own legal endpoint/route; cancelling a goal is not cancelling physical existence.

Do not mutate player.currentPlaceId, auto-attend an appointment, enter a private room, fulfill the old goal or close75 episode. Arrival updates journey and73 actor position; actual permitted witnesses may learn arrival, everyone else remains unknown. A sourced wake can let that NPC reconsider, with no mandatory paid call or fixed “I've arrived” message.

### appointment.withdraw — own actual offer, not a fake player cancel

Parameters `{appointmentId, expectedResponseVersion?, reasonCode}`; finite reason codes are operation audit, not prescribed dialogue. First phase restricts to this NPC's own single-NPC offer, proven from the immutable appointment source event and actual actor capability result. Current Appointment lacks issuerActorId: participantIds/contact/source text alone cannot grant issuer authority. Genesis/legacy offers without a verified issuer need explicit future authored issuer provenance, otherwise unsupported for this ability.

Allow proposed/confirmed owned offer, reject attended/missed/cancelled or another issuer's offer; preserve original title/time/source and player's acceptance history. Source owner+current response/version hash are rechecked to resolve reschedule/accept races. For multi-party participation, a later own-RSVP withdrawal is distinct from cancelling the whole meeting; do not let A withdraw B's commitment.

Append typed `appointment.withdrawn` kernel effect with actor/source/time/reason; hydrate/replay it through private/group/scene/calendar/wait views. **Never synthesize InvitationCommand operation=cancel as if the player clicked it.** responseAt/responseVersion currently mean player's latest explicit response and must not be overwritten by NPC cancellation; add separate actor-cancellation provenance in the canonical projection contract. Keep the original immutable offer row plus actual events, rather than rewriting history.

Only its exact own matching responsibilities may be handled/withdrawn after actual success. Current kernel blanket rejects handlesResponsibilityIds: replace it with narrow per-capability ownership/subject validation, not wholesale removal. No external “ate together” goal completes just because an invite was withdrawn; no automatic affection/anger. Calendar status/participant-scoped product notification can update without fabricating an NPC message. Any NPC success sentence must depend on this action's real result. In-flight travel continues safely even if this appointment is withdrawn.

### observe.room — an actual scoped inspection, not querying global truth into a mind

Parameters `{roomId, subject:{kind:player}|{kind:actor,actorId}}`; no observedAbsent/known departure time supplied by model. Need registered room/zone->existing place mapping, observer actual presence, access/sight authority and a server-certified observation snapshot at the current story time. Coarse map place/contact list alone is not a room or complete-visibility certificate. Unknown observer location/access => blocked, not absent.

Observation outcome `seen_here | absent | inconclusive` is computed by a real registered room observation adapter under the world transaction. Partial/occluded/unmodeled coverage cannot prove absence; global Director actual target elsewhere is not enough to grant this observer knowledge. A positive visible identification can prove seen_here with partial coverage; not seeing under partial coverage yields inconclusive. With no room/coverage implementation, leave capability unregistered/unsupported rather than ask the model to invent a survey result.

For a real absent result, write ActorPositionKnowledge `{kind:absent,sourceKind:direct,placeId:roomPlace,occurredAt:null,learnedAt:observedAt,possiblyStale:true}` for this observer only, plus typed evidence `{observationId, observedAt, coverageSourceId, observerPresenceSource}`. Existing evidence inputReceiptId/quote is for player reports; extend a discriminated evidence contract rather than fake a quote. At15:40 observed absent means absent **as of that observation**, not departed15:30 or arrived elsewhere. No target actual-position mutation. A seen_here observation can record at with actual observed time; inconclusive never writes absent.

A successfully performed inspection with inconclusive result may be action succeeded with observation.result=inconclusive and completedGoalIds=[]; it does not certify finding/absence. Permission/precondition blockage is not an execution failure. Actual sensor/inspection failure has a failed result with real reason. Source text presented to the NPC includes only its witnessed outcome, never the hidden target destination.

## Minimal journey storage/source/UoW

Proposed future migration (number not reserved): `actor_journeys` with world/owner/actor/id/revision, status in_transit/arrived/interrupted, from/to/route+policy ref, departedAt/plannedArrivalAt/actualArrivedAt, beginEventId/beginWorldVersion/beginActionId/startResultId, settlementEventId/version and audit-only initiating goal/plan refs. Composite owner/event/version FKs use existing canonical events; world+actor FK uses actor state identity. One active journey per(world,actor); unique begin action and unique arrival receipt key. Place IDs are checked against current finite boundary/registered route under world lock, since no normalized place FK exists today.

Do not delete a journey when a goal is withdrawn; per-actor goal refs are causal audit, not a cascading lifecycle FK. Begin/arrival payloads are typed kernel-produced effects, never arbitrary JSON claimed by model.73 mirrors the committed actual event; Same-Agent source resolver exposes own `journey-start:id` / `journey-arrival:id` as world_event/action-result references using real event/version/time. Only actor-own route details are visible by default. Departure witness source is a **separate clipped observation** with from/time and no toPlaceId/full journey record. Director raw global catalogue is not an NPC excerpt API.

Respect actual locking: withLeasedAgentDatabase currently validates and locks task **before world**, then control. Continuation task path should reuse verified TaskLease and app-scoped bridge, then lock journey/actor/position/affected calendar or sensor rows consistently. Do not widen pl_worker grants, reuse real-player authorizeWorldCommand for background work, or update task rows in inverse world→task order. Do not hold any DB transaction over a model call. New dispatcher input subtype must be explicit; no serial legacy handled/fallback engine.

Continuation uses a stable source-derived command/dedupe key for that journey, but a **fresh current world version at each deterministic execution**, not the begin world version frozen forever. Successful original receipt replay settles once. Exact DB commit proof can recover an uncertain delivery without paying a model again. A lost lease/foreign actor/world/forged task input cannot settle anything.

## Time and continuation rules

plannedArrivalAt is the **earliest legal story time**, not proof of arrival. Reliable jobs use existing durable task/outbox execution with a sourced due condition; current task schema has no general not_before/run_after field, so specify due-wake persistence/claim semantics in the migration before enabling start. No in-process post-response timer assumption and no per-check paid calls. Wall-clock ETA hints are recalculated when speed/lease/pause changes; authority remains story time.12x browsing/1x conversation/60–90s cheap checks stay unchanged.

Do not pull the clock forward merely to finish an NPC trip or count offline pause as elapsed time. If delivery is late, actualArrivedAt is the current lawful kernel settlement time; do not silently backdate to plannedArrivalAt or grant retroactive scene hearing/attendance. A later optimized clock-boundary/due scheduler can settle promptly at the due instant, but absent that proof planned≠actual. Paused/offline worlds retain pending continuation until authorized active advancement/resume; no fake time penalty or expired goal.

Current player commands require expectedVersion and event.version=expectedVersion+1. Do not drain a hidden extra arrival event inside an already-validated player command and mutate its expected version/hash. Process due continuation as its own serialized canonical command before the next fresh input, or surface a normal version refresh/conflict before any paid call. Native accepted source receipts can keep original accepted version under existing execution rules; that does not authorize rewriting other player command contracts.

## Genesis setup and old-world migration — activation blockers

**New worlds must not start autonomous mobility with every NPC unknown and no initialization route.** Add explicit `genesis_setup` authorization in the world creation/pre-entry pipeline: only a new unentered version0 world, before any event/attempt/active business session. Author supplies typed `{actorId,placeId,fictionalSourceRef}` assignments or explicitly approves a bounded setup proposal over existing cast/map places. This is authorized creation of fictional initial truth, not inference from address/job/relationship/contactActorIds or an NPC self-report.

Validate every actor/place against the bound approved fictional edition/setup permission; include all mandatory actor states and preserve intentional unknown when no authorized assignment exists. A creation planner may propose this in the already authorized setup workflow, but AI output still requires validation and existing model-budget accounting; no silent extra paid runtime call or fixed R17 placement table. If no authorized setup is available, report needs_setup for mobility while private chat remains usable; do not disguise a setup defect as all NPCs personally refusing invitations.

73 requires positive event source. Recommended minimal path: authorize at version0 → commit a genuine typed **world.genesis_setup** event/version1 with setup authorization/assignment hash and actual source refs → same SQL initialize/reconcile all actor states, write73 positions and observation cursor/boundary → only then expose/activate epoch2 mobility. This is a real authorized setup action, not a fabricated event solely to satisfy FK. Immutable version0 baseline remains available for replay. If product insists on staying version0 without an event, a separate legitimate genesis-provenance/FK/public-source migration is required; never edit applied73 or insert fake source IDs.

Existing entered worlds cannot call genesis_setup to reset positions. Retain current73 actual positions; derive migration only from verified historical actual actor presence/travel/settlement sources in order, not map rosters, home address, plan or speech. A later unknown/departure cannot be overwritten with an older at record. Unknown stays unknown and private messaging works; no read-time filling or upgraded “I'm at X.” Migration preview/receipts/rollback and an explicit setup deficiency are required before claiming old-world autonomous mobility. No silent bulk production epoch change.

## Business attention identity is still a prerequisite

69 world_clock_activity persists client_id/sequence/mode/expires_at only. Conversation mode does not bind channel/thread/participant, and AgentConversationFocus is a last discussion subject, not proof a user is still in that business session. DirectorSnapshot.focus is currently an external trusted interface, not persisted business identity. Do not turn either into physical presence, consent or room authority.

Before relying on focus-aware pacing, extend69 via a new migration or a tightly linked attention-session record: server-issued session/focus token, owner/world/client incarnation/monotone sequence, channel/thread, authorized participant scope, opened/left/ended/expired status and lease provenance. Reuse existing lease clocks rather than introduce a second independent presence truth. Server validates current membership/scene scope; stale/out-of-order tab heartbeats cannot reopen ended sessions. No queries that create sessions, DOM inactivity timeout masquerading as leaving, or caller-supplied actor list treated as authority. Multi-tab slowest valid conversation and pause/explicit return continue existing policy. Attention can guide scheduling but does not compel an NPC to stay or reveal A's conversation to B.

## Concrete implementation sequence and acceptance gates

1. Freeze root-owned capability/intention/disposition/failure and typed spatial effect/continuation contracts; derive channel permissions and WorldBoundary capabilityIds from the same actual registry. Current defaults advertise only two capabilities; do not add labels before implementations exist. Preserve strict source/identity rejection and independent valid dialogue.
2. Persist business attention identity and authorize new-world genesis_setup; preview/migrate old evidence without guessing. Unknown-start behavior and explicit setup failure are tested before enabling movement.
3. Implement begin **and arrival together**, journey ledger, actual replay/source adapters, due scheduling and authenticated worker bridge. Never deploy begin without a working completion path. Test goal withdrawal/episode withdrawal/invitation cancellation in transit, lease crash/replay, speed changes/pause, unknown start, two starts in one batch and actor mismatch. Retain physical cleanup independent of goal.
4. Add owned single-offer appointment.withdraw across every actual channel/calendar/wait/replay/source view, with current response CAS and no fake player decision; expose only real UI alternatives/participant notifications. Test accept/reschedule race, another issuer, one participant leaving and no accidental whole-episode completion.
5. Add observe.room only with registered room/access/coverage truth; absent now vs unknown departure, partial coverage inconclusive, own location unknown, other-target mindreading and exact source audience must pass actual PG/native tests. No capability key without the real adapter.
6.75 active/resolved/withdrawn shared transitions require controlled kernel evidence/criteria migration, never direct NPC writes. Actual arrival≠attendance≠goal success; closing one responsibility cannot erase another participant. Only then run approved real-model idle/unrelated/refusal/arrival/withdrawal journeys and deploy through root's normal migration/READY/public acceptance gates.

All above APIs/tables/types are **design proposals**, not implemented or tested runtime. No current model quota, database, source or production changes were made by this task.
