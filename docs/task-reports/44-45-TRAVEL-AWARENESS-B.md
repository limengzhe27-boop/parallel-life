# 44-45-TRAVEL-AWARENESS-B

Owner codex-ma44-travel-awareness-b; root sole public contracts, journey store, kernel, reducer/history, SQL, application/server, scene intervals and integration/release owner. Independent npc-director-progress tree, codex/ma-arch44-travel-awareness-b from87cf225e. **Initial scope was read-only analysis/report. Root then explicitly approved only world/domain/world-awareness.ts existing committedAwarenessDelta/context plus NEW tests/agent-travel-awareness.test.ts; later authorized optional AgentWorldContext.travelRoutes in that same owned file. All other source/SQL/public infrastructure remained root-owned.0PG/model/production/fullcheck/build.**

## Accepted proposal and implementation boundary

Use existing committedAwarenessDelta entry point, existing AuthoritativePosition/ActorPositionKnowledge and same73 transactional projection. Do not add another movement runtime, state store, clock or model capability. Public departure contract proposed by root: AgentRuntimeTransition.departures?:AgentJourney[]. Actual standalone arrival event/data remain SQL80 protocol.

### Departure validation and output

Within the existing recognized actual runtime event types (turn.resolved, agent.state_committed, group.turn_resolved, scene.reaction_recorded), validate current runtime actor/state and actual results first. Optional departures must be an array; empty is no movement; initial one-active-journey scope means at most one current-actor journey in a single event. Reject invalid/mixed/duplicate records, not partial success.

Require true in_transit/revision0 journey, matching world/actor, independent journey/begin action/result refs, departure event/version/time bound to this actual event and storyAt, prepared version=event.version-1, real prior origin at route.from with valid prior source/version/time, existing finite endpoints and pinned directed route/duration/ETA. Match runtime.results successful action result and stateAfter.actions actual travel.begin/routeId/resultId/status. Mere dialogue, planned journey, failed result or mismatched source cannot move a person.

Produce only that NPC's actual position: in_transit, placeId=null, sourceEventId=this event, worldVersion=this version, occurredAt=actual world departedAt. Do not modify player position, destination presence, appointment attendance, goal status or a shared episode. Optionally enqueue one normal new_condition reason; existing actual action_result reason remains independent evidence, not fabricated completion.

### Arrival needs original trusted journey context

Propose extending the existing optional pure context with `journey?:AgentJourney`. Root projector repository must load the actual SQL80 row for event.data.journeyId under same owner/world transaction, never take the NPC's asserted journey as authority. Accept original revision0 in_transit or already-CAS revision1 arrived only when its arrival exactly matches this event. Missing journey context on an arrival must reject, not guess ETA/duration or silently leave a physically committed fact unprojected.

Validate data exact actorId/journeyId/departureEventId/original route/independent arrival receipt against original pinned journey and actual arrival event.commandId/id/version/storyAt. Ensure distinct departure/arrival event/receipt, legal version progression, same known actor/world and actual arrival.at>=original ETA. Use story time only; occurredAt is wall-clock audit and must not be compared as physical world duration. Route equality must be structural, not sensitive to JSON object property order.

Produce only that NPC's at-original-destination source/version/current settlement time. Arrival is not room entry, meeting attendance, player acceptance, goal fulfillment or another action result. Late settlement cannot be backdated to ETA.

Use type-only import of journey types in world-awareness: agent-travel currently runtime-imports awarenessLocalTime, so importing its execution helpers back would create a domain runtime cycle. Do not move shared time code or edit agent-travel without another root-owned allocation. Pure projection validates relevant bindings; actual SQL/source authenticity and full execution rules remain root/80 responsibility.

### Observer policy — recommend no new knowledge in first phase

Current five-field arrival event and departure array have no separately authenticated observation packet. Default delta.knowledge stays empty for NPC movement. A map position, same-place coordinate, current cast, contact roster or bare scene presence list does not grant another NPC live global location knowledge. Do not infer who saw departure or reveal destination.

Later visible movement may yield clipped left/at knowledge only from a canonical actor-scoped observation with independently verified scene access/presence at the precise event, source identity/time and actual visibility. Root would need to define and persist that protocol. Do not add an ad hoc optional observer list in this task or reuse player departureObservation for an NPC without explicit subject and source authority.

## Confirmed scene interval hazard — activation blocker

Current committedAwarenessDelta projects every still-active scene presence interval back to at(scene.placeId) on scene.opened/entered/action_resolved. Current native scene projector authorizes speaking/receiving through scenePresent intervals; existing input authority also trusts sourced scene intervals (including historical worldResults), so changing only73 physical position cannot end room access.

Actual read-only pure probe using the current function: assume NPC departs atv6. A v7 scene.action_resolved with stale active interval emitted `{subject:actor npc,status:at,placeId:shop,sourceEventId:later_scene,worldVersion:7}`. Closing that same interval with leftVersion6 emitted positions=[]. No DB/source code was changed for this probe. Thus stale room state would overwrite in_transit with a newer source, and could still expose later room dialogue to a physically departed actor.

Root departure UoW must canonically close this actor's active original scene interval at departure event.version, preserving historical intervals/source refs and not ending other participants. The change must be in actual event/replay effects, not just an SQL repair that rehydration/replay later loses. If that capability cannot yet reconcile an existing scene, block begin while such an active interval exists; do not start travel and promise to repair it later. Scene-origin speech/action ordering also needs root validation: departure-dependent statements cannot still be emitted as room speech after leaving. Arrival does not automatically reopen/join destination scenes; observing/room entry needs its own lawful source.

## Actual UoW points

Current PostgresNpcAgentKernel sequence is finishAgentCommit -> projectAgentWorldChange -> afterCommit hook, all same SQL transaction. SQL80 explicitly permits original at proof or exact new in_transit source, so departure ledger may be called in afterCommit without accepting an arbitrary projection; any source/unique/CAS failure must roll back all state/event/position changes. Root may instead explicitly use finish -> ledger -> awareness. Canonical scene interval changes must be constructed with event/projections before stale room data can be observed or subsequent physical actions use it.

Suggested arrival order: world/control/journey/clock lock -> fresh due evaluation with legal active story time -> lawful clock anchor -> independent event/world/successful command -> SQL80 CAS while own73 is still in_transit -> awareness loads now-arrived ledger/context and projects at plus pending reason -> durable outbox, same transaction. A ledger-first projector context should support exact already-arrived revision1; this avoids forcing a special half-committed read path. Root serializes version/lease/epoch and adds reducer/history support. No hidden extra version mutation within an already accepted player command.

projectCommittedWorldAwareness currently supplies scene context only for three scene event types, and no journey context. Root must add the trusted arrival lookup before enabling the new arrival event. Its replay cursor walks actual committed events in order but passes current retained scene documents: versioned interval closure is necessary both for immediate projection and catch-up correctness. Existing finite map anchors must not be removed while a journey still pins them without separate sourced reconciliation.

## Evidence/status

Read root87cf225e domain/repository/commit wrapper, actual kernel order, scene projector/input authority and accepted39 SQL80 protocol. Initial pure current-function probe established the stale-interval risk before writing source. Root subsequently approved the proposed context/default no-observer policy and exact source scope. Actual NPC travel and online availability remain root integration gates, not claimed by pure projection tests.


## Final frozen delivery

**Source dcea0ece**, exactly2files: existing world/domain/world-awareness.ts and new tests/agent-travel-awareness.test.ts. No source edits after freeze. Base87cf225e; did not cherry-pick SQL80/store or modify agent-travel. Source commit is independently cherry-pickable. Earlier read-only report6ef914ce and this report update are separate; root may cherry both documentation commits in order or use the canonical complete mirror.

Implemented accepted validation and own-only projection. Arrival rejects missing context and malformed data instead of silently accepting no physical projection. It accepts original in_transit revision0 or exact same-arrival arrived revision1; checks safe stable arrival_<journeyId>, pinned original route/ETA, independent receipt/event/version/current settlement time and strict five-field data. Structural JSON equality ignores key insertion order. Departure checks actual successful result plus proposed/executed travel.begin action/route/result binding and existing route; no more than one own active departure in one event. No dialogue/intent/success-result-only inference, new observer knowledge or automatic scene join/goal completion.

Added optional AgentWorldContext.travelRoutes exactly `{id,fromPlaceId,toPlaceId,toPlaceName,durationMinutes,modeLabel}[]`. This is a finite route catalog type, not actual movement/evidence or another actor's position. Root attachment must supply only existing routes from this NPC's sourced real at-origin, and kernel must revalidate/ pin authoritative world.space.routes with existing own sourceIds. No runtime attachment or capability enablement is implemented here. worldBoundary default capability list is unchanged; root will publish travel.begin through its actual common registry only when ready.

Final focused new57/57 plus existing world-awareness9/9 = **66/66** pure tests, zero skips. Typecheck0errors; boundary551files, focused Prettier and diff checks PASS. Coverage includes all4recognized runtime channels, full identity/source/action/result/route/clock/ETA mismatches, planned/failed/missing/duplicate movement, unknown/future/player origin, safe journey ID and wrong event type, arrival missing context/malformed data/early/backdated/unrelated source/route/receipt, exact post-CAS replay, route property order and old pinned duration despite later route changes, late settlement with withdrawn purpose, untouched player position, closed scene intervals preventing re-projection and no observer grant from roster/claimed observation. Valid inputs remain unmodified.

No real DB, model, browser, production, fullcheck or build run; explicitly scoped pure work. Existing PG55503 remains stopped/no listener, no new DB session was opened. Tests use explicit synthetic typed source data to verify deterministic binding rules; they do not authenticate actual SQL receipts or demonstrate enabled runtime travel. Actual source authenticity must come from the real kernel/UoW/SQL80, never from a plain object merely matching these fields.

Root still must integrate store80/public transition, fresh actual own-position eligibility and journey lookup, actual canonical scene interval closure/replay, arrival time anchoring and lease/version controls,73projection calls/outbox, common capability registry and model route selection. Particularly use fresh pre-projection own73 evidence for due arrival; do not let overwriting73 first stand in for proving original physical state. Recommended ledger-CAS-before-arrival-awareness order remains above. No travel activation while stale scene intervals can revive/listen/speak for departed actors.0production epoch/cap changes by this task. Current status待验收; fullcheck/build/actualPG/READY/public flow remain root release responsibility.
