# 44-49-OBSERVABILITY-B

Owner codex-ma44-observability-b. Read-only root-source audit at **75b24d10**; independent npc-director-progress tree, branch codex/ma-arch44-observability-b. Exclusive new report/canonical own row/main mirror only. No source, SQL, config or test modifications; no PG, model, browser, production, fullcheck or build. Root owns all contracts/kernel/73/sources/candidates/release decisions. Findings below are code inspection and call-graph evidence, **not a claimed real-model/public reproduction**.

## Main finding

Current source cannot faithfully distinguish “mother is at home but did not see the player leave” from “mother directly witnessed departure” once she has been included in the active scene. It prevents direct all-world destination broadcasting, but still grants a stronger local observation than its evidence proves:

`same sourced map place -> automatic scene.presence -> everyone in active scene treated as departure witness -> canonical fact + left knowledge with exact departedAt`.

The problem is semantic authority at the producer, not a missing owner/version/receipt check. A real source receipt can prove that the system performed a transaction; it cannot by itself prove that an NPC had sight of a doorway. Actual location, membership in a local interaction and visual observation are conflated.

## Exact actual call graph

1. `src/app/api/v1/worlds/[id]/space/travel/route.ts:16` calls the `PostgresWorldSpace` instance assembled by `src/server/services.ts:98`.
2. `src/modules/world/infrastructure/space-repository.ts:372-414` checks owner/version/activity/clock and obtains current player scene. At419-435, observers are **all active actor intervals in that scene**, provided only that scene.placeId equals route.fromPlaceId and actor belongs to the cast. There is no view zone, room, line of sight, engagement, attention or actual per-observer perception evidence.
3. At437-446 it creates canonical actor-visible text saying the NPC **personally saw the player leave**, without destination. At456-466 it includes that `departureObservation` in the actual travel.completed event.
4. `space-repository.ts:123-160` applies actual event, stores world/command/receipt and calls `projectAgentWorldChange`. `world/domain/space.ts:318-335` validates canonical/visibility/cast/leftSceneId shape and includes the observation fact. It does not authenticate the observation meaning.
5. `world/domain/world-awareness.ts:258-284` accepts that packet and emits each listed NPC's direct `left` knowledge with `occurredAt=departedAt` and `learnedAt=departedAt`; source/version come from the actual travel event. `world-awareness-repository.ts:124-147` stores the projected knowledge in73.
6. Later in the same transaction, `space-repository.ts:495-519` closes the player scene interval, clears current scene and persists the canonical actor-scoped fact. Moving that step earlier/later would not fix the overbroad witness decision; event and projections are already atomic.
7. `agent-snapshot-repository.ts:472-519` clips73 knowledge by observer/source/version/time/forget, then adds a `knowledge:<event>:<subject>:<kind>` source and fact/belief observation. `agent-schedule-collectors.ts:492-535` can turn the new authorized knowledge into an observation candidate. Unified scheduling/NPC evaluation can therefore legitimately consume an **incorrectly certified** departure fact.

## How activeScene presence is actually produced

### Epoch2 deterministic environment

`src/server/worker-composition.ts:44-48` dispatches Agent work through sceneEnvironmentTaskHandler before nativeNpcTaskHandler. `agent-scene-environment.ts:195-215` limits the environment path to opening tasks and epoch>=2, with genuine lease/owner/world/version checks.

At271-290 the handler queries **all**73 authoritative positions at the same `placeId`, status at, with real event/version/successful command provenance. It retains known cast actors. No contact roster or home-address guess directly creates these new-runtime physical proofs; unknown NPC positions remain unknown.

However `agent-scene-environment.ts:104-132` then appends every supplied same-place NPC proof to the scene presence intervals. At147 and322 the environment entry's observableTo is the entire participant set. The replay check proves matching actual source, same place and temporal bounds. It does not distinguish two rooms in the same house or whether the actor is looking, sleeping or taking part in the conversation.

Thus this is **not** simply an unsourced roster grant in the epoch2 opening path; it is a sourced coarse-location grant that is then treated as shared perception. A correct73 position does not make the latter inference valid.

### Legacy scene path is different

`scene-repository.ts:923-964` builds eligible model-present actors from the due invitation participants or `place.contactActorIds`, accepts model `presentActorIds` inside that set, and appends actual result-sourced scene intervals. This is a separate legacy source of broad presence; it also contains no view/attention structure. Do not describe the epoch2 deterministic handler as still using that roster path, or describe the legacy path as fixed merely because the newer handler uses73.

### What the presence type and consumers mean in code

`world/domain/experience-rules.ts:25-30` intervals contain participant/joinedVersion/leftVersion/source identity only. `SpacePlace` at `world/domain/space.ts:23-30` contains id/name/description/source/contactActorIds/appointmentIds: **no structured room or visibility coverage**. Natural-language descriptions do not supply such authority.

`scene-runtime.ts:25-30` scenePresent is interval membership, not a visual test. `scene-repository.ts:710-721` marks ordinary player actions observableTo all present participants (except explicit private thought). `agent-channel-projector.ts:216-230,247-261` authorizes native scene participation from those intervals and marks NPC dialogue observableTo present. `agent-channel-snapshot.ts:82-105,277-293` respects accepted/current presence and observableTo, but those checks preserve the producer's already broad audience; they do not independently prove sight.

Existing whisper/private-thought rules or a statement such as “mother did not notice” cannot repair an automatically created canonical witnessed departure. The runtime has no structured attention/view fact that would override the broad observer selection.

## What is already correctly separated

- No active matching player scene means observerIds is empty even if some NPC is physically at the same map place. Cast/contact affiliation alone is insufficient in this travel method.
- The generated departure fact and73 left knowledge omit destination. `readActorAwareness` at `world-awareness-repository.ts:271-285` queries only actor:<self> actual position and observer-owned knowledge, not player actual or other NPC actual. Do not replace this with a global position feed.
- New NPC departure/arrival projection introduced by45 emits own truth and pending condition, **not** automatic observer knowledge. Stage7 canonical NPC scene-departure closure also addresses physically departed NPCs continuing in stale intervals. The remaining issue here is a still-co-located person with no actual observation, not a claim that45 failed to close departure intervals.
- Source/event/owner/version/forget clipping and historical native provenance remain valuable. They must be kept when fixing the observation producer, not bypassed with a separate knowledge mechanism.

`space.travel` observer creation has no epoch2-only condition. Therefore “no production epoch2” does not alone prove this producer cannot affect a legacy world if that source version is deployed. This audit did not inspect production state/SHA or modify any save, so it does **not** assert that an actual live mother's knowledge is already corrupted.

## The requested mother scenario today

- Mother at home but outside the current player scene: no immediate departure observation from this method. This limited case behaves conservatively.
- Mother same coarse place and automatically included in the active scene: she is always certified as having seen departure and learns the exact departure story instant. There is no way to represent “in another room / not facing the exit / did not notice” in this source path.
- Mother later checks an empty room: the capability registry (`world/domain/agent-capabilities.ts:2-7`) contains plan.record, appointment.propose and travel.begin, **not observe.room**. No actual kernel producer of a room scan or absent knowledge was found.
- `ActorPositionKnowledge.kind` includes absent, and the snapshot/candidate readers already understand it, but `committedAwarenessDelta` runtime.positionKnowledge at432-449 currently accepts **only** player_report/report with explicit actual input evidence. The enum is not an implemented observation action. Do not pass a forged direct absence through this report channel.

## Minimal proposed contract — NOT implemented

Keep one ordinary NPC capability in the existing kernel, same world event/transaction/73 knowledge/source/candidate pipeline. Do not add a second observer agent/database or broadcast playerActual.

1. Define a **bounded, authored or actually established observation scope**, distinct from map co-location: existing place/room/view-zone identity, source, access, modality and what a complete scan can cover. For a genuinely small completely visible room, a place may be that scope. A coarse “home” place cannot silently mean all rooms. If area/scope is not modeled, return explicit unsupported/missing scope or an inconclusive result; do not let a model mint a bedroom ID or declare complete coverage in prose.
2. Proposed ordinary `observe.room` parameters should fit existing flat primitive action parameters, e.g. `{placeId,subjectKey,areaId?}` from the actual finite scope catalog. Kernel rechecks this observer's own current sourced at-position, legitimate access/view grant, world version/time and relevant scope state. In_transit/unknown/no view access cannot scan. Same place is a precondition, never sufficient perception proof.
3. Kernel constructs a typed observation receipt/effect inside the same actual event: identity/action/result/event/worldVersion, observerActorId, subject, scope reference, **observedAt**, modality, verified coverage and outcome `seen|absent|inconclusive`, with actual evidence refs. These are server-certified results, not model-supplied true/complete flags. Internal adjudication may consult hidden truth only after lawful local access, but observer-facing effects must exclude the subject's actual other location, hidden movement time/destination and private audit pointers.
4. Complete authorized coverage may project observer-owned73 `absent` with **occurredAt=null, learnedAt=actual observedAt, possiblyStale=true**, scoped only to the room/place actually checked. It means “not present there at the observation”, not “left at that time.” Partial/occluded/unknown coverage yields inconclusive/no absolute absence fact; do not generalize an unseen person in the living room to absent from the whole home. A direct seen-at observation also does not reveal when the target arrived.
5. Immediate `left` knowledge requires a separate explicit **departure-witness** proof: this observer's bounded view of the actual crossing/exit at that moment, subject/source/window identity and lawful coverage. No proof => no canonical “saw leave”, no occurredAt/known destination inference. An explicit shared interaction scope can be supported, but environment must not construct that scope from every same-place position. Reconcile scene audience so physically co-located but nonobserving people are not automatically observableTo recipients.
6. Record effect/result/state/receipt/outbox atomically under existing owner/world/actor/epoch/version/lease fences, project knowledge only to that observer, then reuse73 source clipping/forget and ordinary candidates. Observation changes no target authoritative position, does not fulfill an invitation, infer a player decision or close a shared event. A goal to find someone is not fulfilled merely because a scan executed.

## Two required integration details

**A successful scan is not a finding.** `agent-kernel.ts:587-590` currently releases statements depending on action status succeeded. With observe.room, succeeded would mean the scan executed, even if the outcome is seen-present or inconclusive. Do not let prewritten “room empty / you left” prose become true just because the scan action succeeded. Need typed result predicates or conservative independent dialogue followed by a normal NPC evaluation that actually sees the observation result. No automatic extra paid call is proposed by this audit.

**Do not swallow a new own-action observation as already considered.** `agent-schedule-collectors.ts:499-505` skips knowledge with source.worldVersion<=actor.projectedWorldVersion. An observe action can produce its result after the model request but in the same commit that advances projectedWorldVersion. Directly reusing this guard would not create an observation candidate for that same-version result unless a separate legal plan/result trigger exists. Use a durable unconsumed observation/result receipt or explicit plan continuation and actual evaluation/quiet-consumption evidence within the existing runtime. Do not add an always-polling knowledge queue or assume “persisted” means “model already saw it.” Preserve once-only candidate/evaluation semantics and budget controls.

Director may schedule an observer's own due plan, known opportunity or legal inspection. It must not hand that NPC the player's hidden travel event/location as a reason that the NPC somehow noticed. A quiet response remains valid. Personality/dialogue should be generated from actual observer-local results and existing own memory/stance, not a fixed “mother asks where you went” script.

## Minimal acceptance gates for future implementation

Same-place different room/unengaged actor receives no witnessed departure. Explicit exit-view witness learns origin/actual witnessed time and no destination. Later complete room scan yields absent with unknown departure time; partial scan yields inconclusive. Unknown target/scope/access remains unsupported or inconclusive, not proof of absence. Negative or corrected knowledge remains source-bounded and does not change player actual position. Another NPC/remote channel learns nothing without a real relay/share. Owner/world/actor/version/time/forget and room-access revocation races reject stale effects atomically. Own scan result can cause one legal continuation/quiet evaluation without repeating forever, and succeeded does not authorize a false outcome sentence.

Fixing the future producer does not itself retract earlier canonical departure facts or existing73 left records. If root confirms such records exist in affected worlds, correct them through explicit sourced supersession/reconciliation without deleting user history or pretending the user forgot. This audit performs no migration or save rewrite.

## Smallest old inferences to remove first — recommendations only

- In space.travel, remove the implication `active scene participant at same place => witnessed departure`. When there is no independently valid witness packet, omit departureObservation entirely (not an empty canonical observer list). Keep actual player travel, receipt, clock progression, leftSceneId and canonical player interval closure. This is the smallest safe way to stop manufacturing new false direct-left facts; it does not itself implement observing or solve broad scene dialogue audiences.
- In deterministic scene opening, stop upgrading every same-place73 proof into an interacting/observing scene participant merely because the physical source is genuine. Preserve the physical proof in73. Only an independently authorized bounded interaction/perception grant should confer the scene audience used by observableTo and future witness checks. If no such source exists, represent unknown/unavailable observation honestly; do not fall back to contacts, invitation roster or natural-language scenery. Root must explicitly decide legacy compatibility rather than silently changing old scene history.
- Do not globally delete the collector's projectedWorldVersion guard: that would replay all old observations. Remove only the assumption that an own action's newly produced result was already evaluated by the model. Introduce a typed unconsumed-result/normal-plan continuation in the existing runtime and retire it through actual evaluation/quiet evidence.
- Do not weaken actual commit/epoch/owner/source/forget checks or use NPC dialogue to establish physical observation. Do not remove source-bound destination isolation. Do not rewrite old facts as if they had always been correct. Each suggestion here is prospective; this read-only task changed none of these paths.

## Actual execution-chain acceptance plan — not executed by this audit

1. Use isolated owner/world fixtures with explicit legitimate setup/presence and bounded scope source records. Missing authored room/scope must remain unsupported/inconclusive, not be replaced by fake success. Test setup may establish synthetic fictional initial truth; tests must not insert the expected knowledge/result rows themselves and then call that execution success.
2. Through the actual authenticated player travel route, move the player while mother is same-place but lacks an exit-view grant. Inspect the actual committed event, world facts,73 observer knowledge, model snapshot and candidate collection: no fabricated departureObservation/left fact/exact departure time; no location-fed mother candidate solely because hidden playerActual changed. Actual player position/clock/scene closure still change correctly. Replay the same command and verify one real receipt/event.
3. Establish an explicit legal exit-view grant through its real source path and perform actual travel again in a separate fixture. Only that observer may get a witnessed-left receipt/source; origin and actual witnessed instant are available, destination is absent from her context and from another NPC's context. Existing receipts/FKs alone cannot substitute for that view grant.
4. Through the normal NPC snapshot/plan/registered kernel action path, execute observe.room after the player left. Read real action result, canonical observation effect,73 knowledge and source clipping. With complete lawful coverage of the actual bounded room, absence has occurredAt=null and learnedAt=actual scan time; player authoritative position is untouched and true departure time/destination stay hidden. Without complete coverage, with a coarse home-only place, or with unknown target position, result is inconclusive/unsupported rather than invented absence.
5. Exercise seen-present, absent and inconclusive results using real kernel adjudication. An action succeeded in all completed-scan cases must not release a prewritten false absence sentence. Verify the actual next NPC request can receive the newly committed scan result even when its source version equals actor.projectedWorldVersion, using the normal pending receipt/plan continuation. Allow quiet, persist its actual evaluation, then repeat normal advance: no second evaluation/call from unchanged observation evidence. A later genuinely new scan can create new evidence.
6. Revoke scope access, forget the source alias, move the observer/invalidate its actual at-position, or change the version between proposal and commit. Real transaction must reject stale effects and roll back state/event/result/knowledge/outbox together. Wrong owner/world/actor and remote scope fail. Another NPC, private chat or another scene receives no native transcript or hidden target location without actual relay/share authority. A partial scan cannot widen from room to whole home while passing through snapshot/source/candidate serializers.
7. Rehydrate/replay real committed history and verify the same scope/audience/knowledge, not a current position-table reconstruction. Check actual ordinary API/worker composition and room interaction UI after the deterministic database checks, including correct active-scene audience and no fake NPC response. Root then runs authorized finite real-model acceptance for natural wording, continued own goals, refusal and quiet behavior; local stubs prove wiring, not human-like dialogue quality. This audit consumes no model quota and authorizes no paid run.
8. Before deployment, root verifies migrations/ACL, integrated check/build and actual app flow. Only after READY and public verification of the agreed bounded-scope cases should the capability be called delivered. Existing potentially false historical left facts require a separately reviewed sourced correction plan if found; do not delete real user history or silently repurpose a test fixture into a production save.

## Delivery status

Read-only audit/contract recommendation complete; no new capability, schema, observation packet or real behavior implemented. Source lines above refer to inspected75b24d10, not a guaranteed unchanged future HEAD. Root must choose contract/scope and separately authorize implementation, actual PG/model/UI/fullcheck/build/deployment validation. Unique new report and canonical own row/main mirror only; task remains待验收 for root review.
