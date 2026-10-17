# 44-8-DIRECTOR-REVIEW-B

Owner codex-ma-arch44-director-review-b; root sole public-contract/integration/release owner. Read-only review of root history-chat-media, initially1f51ee47 and subsequently587cd46c plus explicitly uncommitted scene/model/kernel/snapshot WIP. Only this new report and own main registry row are writable. No source/SQL/model/DB/test/fullcheck/build execution. Earlier unrelated report/source commits are not part of this delivery.

## Findings first

1. **P1 actual hook ordering defect, root WIP correction now statically confirmed; actual regression still required.** Initially scene-repository event()334 projected awareness before enter()/enterPlace() inserted scene_sessions and before commitSceneProposal()1164–1178 saved newly arrived presence. Cursor already consumed the event, so calling the same hook again at the end could not fix missing positions. Root removed the early helper hook and moved it to finalization points548/640/746/825/1432. I confirmed helper no longer calls it and these final hooks exist in latest WIP. Root must verify real enter/open/new-arrival transaction and same-command replay, including person own actual position, without private-query writes. This is no longer reported as unfixed source after root's correction.
2. **P1 activation gate remains: actual advance still runs the legacy serial chain.** services.ts234–273 calls opening.handled -> published.handled -> generic advance; actual /advance route passes directly there. There are no production callsites of scheduleAgents or markDirectorEvaluated in the reviewed snapshot (only definitions). No epoch branch was found in these entrypoints. Before any epoch2 world is activated for autonomous advancement, route by engine epoch before constructing/calling old planners: epoch1 old implementation; epoch2 unified collection/scheduling/director/runtime. Until connected, explicit quiet/unsupported with **zero old planner calls** is safer than paying first and relying on the DB final writer fence to reject later. This is a cutover gate, not a claim that current epoch1 deployment is broken.
3. **P1 future privacy gate: free guidance.intent must never be forwarded directly to an NPC.** agent-runtime-ports.ts87–103 and schedule-agents.ts292–301 allow arbitrary nonempty intent string. The scheduler validates structure and candidate/actor membership, not whether prose contains A's private messages, player actual destination or other protected knowledge. Current scheduler has no production caller, so I did not establish an active disclosure. Fix the contract before wiring: global rationale stays director-only audit; actor-facing output is a positive-whitelisted typed nudge plus recipient-authorized sources/own object references. Do not repurpose authored facts, private_strategy, receipt.text, candidate.reason or deferred.reason as a prose tunnel.
4. **P2 coordination quiet mismatch.** npc-agent-model prompt33 currently says player and coordination should reply, only wake may remain quiet. agent-kernel validation399/498 actually only requires speech for player input. Typed nudge delivery must allow a coordinated NPC to remain quiet and update its own plan/responsibility; synchronize the prompt. Existing validator is already appropriately permissive here. A director hint is not an order to produce a message.

Native runtime awareness now recognizes group.turn_resolved/scene.reaction_recorded in addition to private/no-speech events; I confirmed those types in domain. Existing worldContext actor projection uses own actual position and actor knowledge only, strips source record pointers in model-facing whitelist, filters knowledge by snapshot version/time and computes UTC+08 time from snapshot.storyAt. I did not find a current direct player-actual-position field forwarded through that whitelist. This observation is static and limited to inspected code, not paid-model or production acceptance.

## Minimal contract: keep control decisions separate from world facts

These are proposed contracts for root, **not implemented types or released APIs**. They replace a future free intent route; they do not add another director service or use old nodeKey selection.

### Director input and durable decision

A `DirectorEvaluationInput` needs:

- worldId / engineEpoch / sourceSnapshotVersion / storyAt and a policyVersion.
- observedRange `{afterVersion, throughVersion}` and a digest of actually inspected source records. Observed and evaluated remain separate.
- pending change references and due-condition references, with exact event/result/plan/decision/responsibility revision and source identity. Time-only eligibility may mature without a new world event; a real sourced due condition is a trigger, elapsed idle itself is not.
- candidate IDs with expected world/actor/episode revisions and concrete scope/resource read set; same frozen eligible candidates for coordination and eventual claim. Director never creates authorization by editing a candidate.
- finite boundary/registered capabilities; scoped attention/business-conversation state, open workload and source-backed stagnation context. DOM scrolling and a generic timer tick are not semantic evidence of boredom.
- director-only fictional observations, labeled fact/report/plan/utterance/result. No real-profile interview, unrelated real archive or private user account data.

A `DirectorDecision` needs:

```
id, worldId, engineEpoch, attemptId, inputHash, policyVersion,
sourceSnapshotVersion, evaluatedRange, readSetHash,
mode: quiet | coordinate | bounded_opportunity,
selectedCandidateIds: [],
deferred: [{ candidateId, scope, reasonCode, reconsiderOn: AgentCondition[] }],
nudges: ActorNudge[],
opportunities: BoundedOpportunityDraft[],
audit: { rationale, basisRefs },
committedAt
```

`audit.rationale` may contain the global interpretation and stays director/server-only. Any rationale included in deferral diagnostics has the same restriction. NPC snapshots and notification/user-channel rendering must not serialize this object wholesale. Opportunity drafts and scheduling choices are proposals, not established world facts or proof that a participant agreed.

Quiet is a real durable outcome, with empty selected/nudges/opportunities allowed. Persisting a validated quiet decision and advancing the evaluated cursor is one transaction. Never advance evaluated just because coordinate() returned or because a periodic check ran. A quiet control decision does not require a fabricated world event or NPC message.

### Actor-facing nudge: strictly finite and recipient-local

Minimal `ActorNudge` control record:

```
id, directorDecisionId, worldId, recipientActorId, candidateId,
kind: reassess_own_request | consider_available_action |
      respond_to_authorized_observation | consider_bounded_opportunity,
ownPlanId?, ownActionId?, ownResponsibility?: {id, revision},
authorizedBasisSourceIds: [], opportunityDraftId?
```

No arbitrary intent/reason/text/parameters on this path. IDs must refer to recipient-owned state or an explicitly authorized shared opportunity view. No raw rejected candidate list, director observation, hidden participant roster, other actor plan summary, A private quote or global actual player position in the NPC projection. The model-facing form should contain only nudge kind and its own valid aliases/references; internal decision/attempt/DB metadata remains server-side.

The recipient loader resolves each basis against current audience, world, actor, version/time, content hash and forgetting rules. Membership in a director snapshot is **not** actor authorization. Revalidate again before commit. The nudge itself is not an observation that can satisfy physical arrival, consent, action result or an authored deadline. Do not mint an accepted_input with origin=player; preserve coordination origin and prohibit new PlayerDecision as current kernel already does.

Concrete privacy example: director can observe A's private meeting and B's outstanding invitation. B receives at most `reassess_own_request` for B's existing invitation, when B's own sourced condition is eligible. B receives neither “player is with A” nor “player is busy elsewhere,” unless B separately learned that fact through a real permitted channel. Even the nudge's timing/eligibility must have a recipient-local lawful window; global A knowledge does not manufacture B's trigger.

NPC independently chooses express/wait/decline/withdraw/replan/own action/quiet based on personality, relationship, history and its own knowledge. Director does not set its stance, wording, PlayerDecision or physical result. A coordinated quiet proposal may persist its own state change without message spam.

## Minimal persistent attempt and commit contract

Do not shoehorn a quiet director into actor_agent_attempts by creating a fake actor or fake world event. Reuse the same finite attempt lifecycle/protected-input/raw-response machinery, with a director scope and `decisionId` commit receipt rather than requiring an NPC eventId. A separate director control table is acceptable within the same modular runtime; a second serial story engine is not.

Minimum `DirectorAttempt` fields:

```
id, ownerId, worldId, engineEpoch,
evaluationKey, inputHash, policyVersion,
expectedWorldVersion, protectedEvaluationInput,
observedRange, readSetHash, expectedEpisodeRevisions,
token, leaseUntil, status,
rawResponse?, responseHash?, decisionId?
```

- Unique evaluationKey per world/epoch/material trigger fingerprint. Fingerprint pending-reason revisions, matured sourced condition/window IDs, relevant episode/boundary revisions; **do not** key it by wall-clock milliseconds or every ordinary speech version, which would rebill an unchanged opportunity on each poll.
- Claim in a short transaction; no connection/world lock held over model work. Raw response and original protected input persist before parsing/validation.
- Reserved/request_sent/response_received/invalid_output/stale_discarded/committed/cancelled_before_send/unknown_after_send retain existing meanings. Lease expiry is not evidence that a request was never sent. Unknown prevents automatic paid retry of that decision; it does not freeze unrelated B private interaction or independent NPC plans.
- At commit check epoch, current source authorization/forgetting, actual pending range, actor/episode read sets and boundary. First implementation can fail closed on world CAS; do not silently rebase saved prose onto a new snapshot. If later allowing unrelated newer speech, revalidate the original immutable read set and apply only its original evaluatedRange, never mark newly arrived changes evaluated. New eligibility and execution still use fresh per-actor snapshot.
- One transaction saves validated DirectorDecision, finite nudge/opportunity outbox records, processed-range acknowledgment and its decision receipt. Exactly-once materialization keys `(decisionId,nudgeId/recipient)`; original response replay never resends a model request or duplicates opportunities.
- Known invalid schema/proposal is a recorded invalid response; storage failure after response persists is recoverable with the same envelope. Unknown delivery is not mislabeled invalid, and deterministic validation failure is not mislabeled an upstream unknown.

## SharedEpisode: a sourced projection, not a selected script node

Proposed smallest kernel-owned shared projection:

```
episodeId, worldId, revision,
originRefs, introducedByEventId,
status: introduced | active | deferred | closed,
participants: [{ actorId, participation, ownGoalRefs, ownResponsibilityRefs,
                 evidenceRefs }],
requiredCriteria: [{ criterionId, registeredRule, targetRefs }],
criterionResults: [{ criterionId, eventId, actionResultId?, outcome }],
nextChecks: [{ scope, sourceCondition }],
closure?: { outcome, reasonCode, evidenceRefs }
```

- Draft opportunities live in DirectorDecision until an actual authorized invitation/message/action introduces them. No source event is fabricated to pretend a draft happened. A script/source asset can seed criteria and opportunities by immutable source ref/content version; nodeKey is optional editorial lineage, never the runtime selector or completion driver.
- Participant statuses are independent: invited is not engaged, one actor's withdrawal/fulfilled does not close the whole episode, and focus change does not close any obligation. Goal and responsibility objects remain in existing per-actor state; episode contains references and shared criteria, not a second NPC goal database.
- Kernel alone derives shared progress from real choices/results/visible committed introduction. Actual message can prove an invitation was presented; it cannot prove attendance or execution. completedGoalIds/registered capability receipts prove corresponding completion. “record plan” and “propose appointment” do not complete an external goal.
- Closure follows registered actual criteria or explicit supported cancellation/withdrawal/alternative/partial outcomes. A director's prose summary or number of chat messages is not completion evidence. Missing criteria are explicit, and the episode may defer instead of pretending completion. A declined request can be resolved as declined without falsely recording a failed appointment or closing everyone else's work.
- Recipient episode view is audience-filtered: one shared episode ID does not grant access to all participants' sources, private commitments or locations.

Pacing belongs to soft policy hints and actual milestones (importance/complexity, desired meaningful steps, next sourced check), distinct from truth/completion. A small request may resolve in a few meaningful choices; a larger episode can have intermediate outcomes. No fixed message quota auto-completes it, no endless repeated invitation, no newly invented hard deadline merely to produce an ending.

## Finite improvisation without a second story engine

A `BoundedOpportunityDraft` minimally carries proposalId, basisRefs, existing actor/place IDs, proposed registered capability/typed parameters, recipient-local trigger conditions, optional episode/own responsibility links and an observability policy. Creation consumes a finite configured open-opportunity/introduction budget, validated against the current boundary. It creates no new important actor/city/identity/major setting unless a separately sourced expansion authorization exists (currently none).

Semantic content may be proposed inside the director-only opportunity draft, but it is not an actor-facing free-intent payload. In the first contract the recipient gets only a finite opportunity kind, registered capability choice, authorized existing object references and original recipient-permitted source excerpts. The NPC generates any title, explanation or conversational expression from its own view. A schema-valid free title/parameter can still contain A secrets, so merely wrapping global prose in typed capability parameters is insufficient. Keep newly written global prose in audit or reject it; do not claim a deterministic whitelist can prove arbitrary prose contains no private inference. An NPC may consider the opportunity and do nothing. Capability unsupported != all NPCs personally refusing; preserve desire separately from execution limits.

Do not add a proactive-assistant fallback that invents a scene when other sources are quiet. All opportunity/own-plan/obligation/authored/actual-input/result collectors feed the same deterministic scheduler. A bounded opportunity competes with real work and attention rather than always winning. Budget and cooldown derive from actual introduced/executed outcomes and scoped decisions, not an arbitrary punishment for idle time.

## Switching implementation, in one architecture

1. Keep current schema/attempt/native-input/awareness/own strategy isolation. Fix finalization hook ordering and test the actual scene path before relying on position-aware eligibility.
2. Add pure DirectorDecision/Nudge/SharedEpisode contracts and deterministic validators. Ban actor-facing free intent before introducing a production consumer. Preserve root as sole public-contract owner; no copying old nodeKey coordinator into a new wrapper.
3. Add durable director attempts/decisions/outbox and shared episode projection through the same kernel. Mark evaluated only on validated durable decisions. Keep director audit and NPC projection separate at the type and loader level.
4. Pure collectors read the same authorized SchedulingView; all sources contribute rather than serial handled returns. Apply own eligibility before coordination; coordination sees only that exact candidate set. Materialize the first approved candidate through the same runNpcAgent/kernel; subsequent candidates require recollection/fresh revisions.
5. At actual advance/task ingress do explicit epoch routing. epoch2 cannot call legacy opening/published/generic model chain. If epoch2 collection/coordination is not implemented, honest quiet/unsupported and no paid legacy work. Existing final epoch DB fence remains defense in depth.
6. Separate eligible own plans from director-required cross-actor coordination so a busy A chat cannot starve B's independent legal work. Persist B's own next-check/wake fingerprint. A quiet decision only acknowledges its inspected range/scope; it is not a global pause or cooldown. A sourced time condition can mature with unchanged worldVersion; cheap checks detect it once and produce a new material-trigger key. No deadline => no automatic missed/expired/affection loss.
7. Gate off old executors/task schedules per epoch, recover/cancel known old queued work with receipts, preserve unknown uncertainty and existing anchors. Activate only after actual private/group/scene/idle/wait/travel pipelines pass. No automatic activation of all production worlds because contracts or pure tests pass.

## Acceptance cases for root (not executed here)

- Actual scene enter/open/new arrival -> one final awareness projection -> own actual place available; exact replay does not lose/duplicate it and private query causes no write.
- A private sentinel/true destination exists in director snapshot; inspect the **actual serialized B model request**, not just prompt: no sentinel, no A private rationale, no player true position, no global guidance string. B has only its own invitation/source window. B not accepted => never missed/expired; B may remain quiet or adjust autonomously.
- Repeated ordinary speech increments observed but causes zero extra director calls. Repeated idle checks with unchanged material triggers do not create attempts/opportunities. Quiet has a real receipt. A later B sourced window matures even if worldVersion has not changed and is reconsidered once without exposing A.
- Two simultaneous same-key director calls cause at most one request. Response persisted then crash resumes original protected response without paying again; unknown after send does not auto-resend or globally freeze unrelated work. Stale response does not acknowledge newer pending changes.
- Opportunity contains unsupported/new-city/hidden actor references -> runtime rejects without publishing a fabricated scene. Legal finite opportunity -> NPC may decline/quiet; acceptance still not attendance, message still not action result.
- Shared episode with A withdrawn/B active remains open for B; real trusted closure of required criteria closes it once; topic change/message count has no completion effect. Small episodes can reach an actual ending quickly without fake criteria or repeated requests.

No model quota consumed, SQL/database touched, source written, test/build run or deployment claimed in this review. Root's subsequent patches and actual regression evidence supersede line numbers and snapshots recorded here.
