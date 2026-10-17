# 44-10-EXTERNAL-B

Owner codex-ma-arch44-external-b; root sole integrator/public contract/common source/writer/awareness/release owner. Independent npc-director-progress/codex-ma-arch44-external-b based c9dbab47. Frozen source **8c8f8370** contains exactly four new files: domain/agent-external-projection.ts, infrastructure/agent-external-event-projector.ts, tests/agent-external-projection.test.ts and tests/integration/agent-external-projection.test.ts. No existing source, SQL, public types or configuration modified. No model/production calls or fullcheck/build.

## Actual schema and frozen interface

InvitationEvent uses **storyTime**, not storyAt, and original data is InvitationCommand. Supported operations are accept/cancel/reschedule/attend/miss, with no decline field. This batch maps only explicit accept→accepted and cancel→declined (including withdrawing a prior accepted invitation); no NPC stance/emotion is inferred. Reschedule/attend/miss remain separate future actual-result handling. Epoch1 always returns empty and leaves actor state unchanged.

- `projectInvitationAgentDecision(state,event,beforeAppointment)` pure prepares `{actorId,stateAfter,projection} | null`.
- `applyAgentExternalProjection(state,projection)` pure applies compact delta for replay. Replaying after a later legitimate actor revision preserves that later state, verifies recorded decisions exactly and never overwrites it.
- `prepareExplicitInvitationProjections(sql,owner,{event,beforeAppointment})` phase1 reads and locks world and existing participant actor states, computes pure results and writes nothing. Must be called before inserting the original event. Returned projections are server metadata, not user/model input.
- `projectExplicitInvitationDecision(sql,owner,{event,beforeAppointment})` phase2 verifies actual successful stored original event, original command hash/payload/expectedVersion/result event, owner/world/epoch and metadata, then actor CAS in caller's **same transaction**. All participant deltas are verified before any actor write. Actual event must already contain the prepared metadata.
- `ProjectedInvitationEvent` is a new local subtype with optional data.agentProjections; root owns any public InvitationEvent type extension. No common types changed by this delivery.

## Root writer order (not wired by this package)

1. Authorize/lock the actual calendar player command, hydrate true before appointment and validate applyInvitationEvent.
2. prepareExplicitInvitationProjections using that actual event/before appointment.
3. Set server event.data.agentProjections to returned compact projection[]; **repeat the event size check after attaching metadata**. Request payload/hash remain the original command without server metadata.
4. Insert the original command/event, update world and successful command receipt.
5. projectExplicitInvitationDecision using same SqlClient/UoW.
6. Final awareness hook, clock caps and return. Any failure rolls back the entire original player command. Never patch the event later or update only the mutable actor table.

## Evidence and ownership

Supplied beforeAppointment is not trusted merely because a caller passes it. Both phases independently load immutable version0 world baseline and actual successful historical events through original expectedVersion; existing replayWorldHistory plus existing publication invitation links reconstruct canonical prior appointment, which must deep-equal supplied beforeAppointment. This avoids importing WorldRepository back into its projector or inventing a second hydration store. Missing baseline/history fails closed. It adds history reconstruction to this explicit operation; future performance consolidation belongs in a shared authoritative reader under root, not skipping provenance checks.

Only existing actor states for actual appointment participants are considered. Only existing nonterminal responsibility.subject appointment with exact ID is changed; absent state/subject or fulfilled/withdrawn/expired responsibility creates no new goal/question/responsibility. Other actors and unrelated obligations remain unchanged. No memory-row initialization, physical movement, attendance, goal completion, affection change, anger or automatic withdrawal.

Each affected actor revision advances once and projectedWorldVersion records the actual calendar event version. Each affected responsibility revision advances once; status becomes open and waitingOn self, nextCheck becomes observation(calendar-response:event.id). This gives the NPC a sourced opportunity to reconsider, not a forced message or attitude. Old **reply deadline** is removed as root approved; compact metadata records removeDeadline and deadlineBefore with original at/sourceId. Appointment.at is untouched. Indefinite responsibilities remain indefinite.

Append-only decision uses original source `calendar-response:${event.id}`, actual storyTime and event version, world_event/private_strategy source. Quote is original operation button literal accept/cancel, never fabricated Chinese private-chat speech. Decision responsibilityRevision is the resulting current responsibility revision, so acceptance then cancellation preserves history while currentPlayerDecision sees the latest decline. Existing history, goals, plans, actions, memories, relationships and focus remain intact.

Compact metadata carries schema/kind/world/actor/appointment/operation, actor before/after revisions, source, responsibility ID/revision deltas/deadline removal evidence and appended decisions. It does not duplicate full actor state or claim a new NPC runtime event. JSON property order does not affect replay comparison. State size budget240000 is checked before persistence. A metadata mismatch, missing actor projection or CAS conflict rejects the transaction rather than silently applying a partial set.

An already active NPC attempt retains its original expected actor/world revision. The real calendar write changes both, so its later old response commit fails; the external projector never cancels unknown requests or resends a paid call.

## Root integration caveats

- Root must authorize calendar-response sources only for that actor's matching real projection/participant context, expose original button semantics, never the entire event's other actor deltas/private state, and preserve original source permissions/forgetting on final validation.
- Root owns director reasons. Current awareness previousAgentState loader reads only prior agentRuntime.stateAfter. After an external compact calendar delta, the next NPC stateAfter includes old calendar decisions absent from that previous runtime, so a whole-state diff could falsely mark the calendar decision new again during ordinary speech. Use actual current committed runtime.proposal.decisions accepted in stateAfter, or replay external actor deltas to reconstruct correct prior state; record calendar changes independently from actual agentProjections. Do not rebill director evaluation for old calendar decisions on every later conversation.
- Existing responsibilityRevision semantics increment on any responsibility content change; this package intentionally follows them. It does not redefine the public request identity/revision policy.
- Source/common resolver, original world writer, public InvitationEvent metadata and actual awareness/director hook remain root work. No actual product-entrypoint or deployment completion is claimed here.

## Verification

Final combined **18/18** pass:8 pure tests +9 real PostgreSQL subtests +parent. Pure: accept/current revision/compact replay/no mutation, later cancel preserving acceptance, no participant/subject/terminal resurrection, unsupported operations inert, replay preserving future actor state, tamper rejection, no deadline creation/unrelated obligation untouched and invalid event binding.

Real PG55503: actual event/receipt/actor state same transaction, actual metadata replay, participant-only state updates, accept→cancel history/current revision, no new responsibility for missing link, epoch1 unchanged, canonical before-appointment/participant tamper rejection, missing/tampered metadata or queued command and post-write failure rollback, foreign owner/worker refusal, exact event payload enforcement, active NPC request lifecycle stale protection. The active-attempt test actually marks request_sent, saves a synthetic response, proves beginCommit succeeds **before** calendar, then verifies precise VERSION_CONFLICT **after** calendar; no paid model call is implied.

Initial PG run expected worker permission-denied, but actual RLS rejected earlier as NOT_FOUND. Assertion corrected to accept either explicit safe denial; source permission behavior was unchanged. Final log is ignored.local/external-final.log. Dedicated55503 was checked free before startup, stopped successfully after tests and confirmed no listener; no other agent DB/port touched.

Boundary checks534 files, targeted Prettier and diff checks passed. Standard typecheck reports only two inherited c9dbab47 npc-agent-kernel287/288 findLastIndex/es2023-lib errors (TS2550/7006), no new-file errors. CLI `tsc --noEmit --lib dom,dom.iterable,es2023` passes the whole tree; no tsconfig/root kernel edits made to hide the baseline issue. Root final integrated type/check/build remain required. No SQL migration, no fullcheck/build, no model or production activation/deploy.
