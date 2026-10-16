# MA-ARCH-44-7-COLLECT-P — pure same-view candidate sources

Status: frozen pending root acceptance. This is pure scheduling input, not autonomous NPC dialogue acceptance or production activation.

## Scope and ownership

Agent `codex-ma44-collect-p`, auxiliary2 conversation `01a11a84-9572-7ab0-92fb-967f963dfc20`. Worktree `/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本`, branch `codex/agent-collectors44`, base `fe5c1f51`. Root approved interface and the internal eligibility probe before implementation.

Exactly three new files: `src/modules/world/application/agent-schedule-collectors.ts`, `tests/agent-schedule-collectors.test.ts`, this report. Existing sources/shared ports/domain/kernel/SQL/server/dispatcher remain unchanged. No PG, model, build, browser or production operation.

## Interface

`createAgentScheduleSources(view: SchedulingView): readonly RegisteredAgentCandidateSource[]`

`SchedulingView` contains one authoritative `worldId`, `engineEpoch`, `worldVersion`, `storyAt`; per-actor `{snapshot: AgentSnapshot, trustedResults: readonly AgentActionResult[], appointments: readonly Appointment[]}`; active attempt `{actorId,status,id}` records; and `consumedCandidateIds` from truly committed wake receipts only.

Two registered pure AgentCandidateSource closures per actor (`actor_plan` and `responsibility`), each with failureScope actor. The factory takes a detached deep-frozen copy. collect returns freshly built candidates/blockers, performs no IO/model/warehouse access or mutation, and rejects a mismatched requested world. Owner/source authorization remains the trusted server reader's responsibility, not this pure adapter.

All actor reads must match the same world version/story instant, current state/view identity/revision/projection and retained state content. Ambiguous source IDs fail scoped collection. Sources, own position, appointments and trusted results must be currently visible with strict valid calendar instants and committed versions no later than the current read. Invalid actor projection fails only its own registered sources; other actors remain schedulable.

## Actor plan source

- Active/waiting recorded plan with a real nextActionId; action/goal/related responsibility have authorized own basis and channel/world capability permission.
- Reuse `evaluateAgentActionEligibility` for goal/plan/terminal state, all related plan triggers, dependencies, observations, place and latest request-revision decision. No separate semantic interpreter.
- A merely proposed action does not wake. An empty waiting action/plan does not become ready from an empty trigger array. Explicit action status ready, or a waiting action with nonempty actual trigger/precondition/dependency evidence that now fully satisfies the shared evaluator, can be a candidate.
- Actual trusted receipt boundary is <= current worldVersion (not the shared evaluator's same-transaction current+1 allowance). Future/foreign/hidden/unproved results are excluded. An actual result for this action prevents rerunning a stale ready action.
- Only sourced server-built selfPosition can satisfy physical location. Speech, another person's location, unknown/transit or future/unsupported position do not.
- If multiple plans reference the same next action, collect it once and evaluate all related triggers. No duplicate per-plan wake for the same action.

## Responsibility source

Only nonterminal responsibilities with their own authorized source basis qualify. Candidates require at least one actual basis:

1. Nonempty nextCheck fully satisfied by the shared eligibility interpreter.
2. The latest explicit player decision for this exact request revision, with a currently authorized accepted-input source. Earlier acceptance cannot survive later refusal or a changed request revision.
3. Its linked known appointment, with the actual appointment source handle/event binding, this actor among participants, currently proposed/confirmed status, no future response source/version/time, and appointment time reached.

Appointment arrival of time means re-evaluate this actor's own arrangements. It never asserts attendance, player agreement, missing an appointment or a response deadline. Explicit deadline metadata must match its actual source; deadline alone never creates expiry, a wake or a default reminder. An unbounded waiting responsibility with no new basis stays quiet.

Root approved an **internal condition-evaluation probe** because the existing shared evaluator currently exposes an action-shaped API only. The probe is an ephemeral goal/action-shaped adapter in a collision-avoiding internal namespace. It never becomes a real Agent proposal, candidate action ID, state mutation, source, persisted goal/action or model output. All condition rules remain in the shared domain evaluator. Root can later extract a shared condition helper without changing semantics; no second interpreter was introduced here.

## Stable identity / deduplication

Candidate IDs are local deterministic SHA-256 fingerprints, prefixed by source. Standard WebCrypto avoids forbidden application imports of Node/infrastructure code. Fingerprints include actual world/actor/channel identity, related plan/action parameters, responsibility content/revision, current relevant decision or actual condition/result proof and authorized basis identity/integrity. Logical source/condition sets are sorted; action order remains part of the actual plan.

Generic worldVersion, actor revision, ambient storyNow, source projection time/version cursors, unrelated conversation/input and unrelated receipts are excluded. Availability is checked separately. CAS fields expectedWorldVersion/expectedActorRevision still use the current read. No source is fabricated to supply an empty basis.

Only consumedCandidateIds from genuinely committed success/quiet wake receipts suppress a stable candidate. Root persists `wake:${worldId}:${candidate.id}` and owns actual idempotent claim/result/quiet semantics. Reserved, failed, invalid or unknown attempts must not be falsely counted as committed consumed candidates. These collectors neither claim nor retry anything.

Unknown-after-send creates an actor-only blocker; reserved/request_sent/response_received also block only their actor pending settlement. Actors absent from the current view cannot stall other actors. No world-wide unknown blocker or legacy agenda fallback.

## Verification

Final pure run86/86: new collector28, existing scheduler39 and shared eligibility19. `npm run typecheck` passed; module boundaries531 passed; diff check passed. Ignored log `.local/ma44-collect-pure.log`.

Tests cover stable IDs across CAS/chatter/ambient cursor changes, actual plan/parameter/decision/result/revision changes, source/condition set ordering, empty waiting/proposed/terminal states, all related plans, capability/source/redaction boundaries, actual self position, failed/success result conditions and strict current-version boundary, latest refusal and request revision, no default deadline/expiry, sourced due appointment without consent/attendance, rolled calendar dates, detached immutable input, duplicate source/view disagreement, scoped stale actor failure, unknown actor A while scheduler selects B, and completely quiet input without a director/model call.

No PG/model calls, no full check/build or deployment were performed by this pure subtask. Existing application/domain shared source was read-only throughout.

## Root integration next

Root builds SchedulingView from actual authorized persistent reads, queries only truly committed wake receipts for consumed IDs and pending attempts for actor blockers, sends all sources to the existing single scheduleAgents/runNpcAgent/kernel, and rebuilds the read after each commit. This does not add authored/opportunity/event-library collectors or replace the full director observer. Root owns pending event-library/actual runner integration, full checks/build/release/READY/public testing and genuine multi-role quality acceptance.
