# 44-23-STATE-CONTEXT-B

Owner codex-ma-arch44-state-context-b; root sole NPC/Director adapter/public-contract/integration/release owner. Independent npc-director-progress/codex-ma-arch44-state-context-b from exact326762b8. Frozen source **8991c717** contains only new application/agent-state-context.ts and tests/agent-state-context.test.ts. Existing model adapters/types/ports/SQL/config untouched.

## Frozen interface and behavior

`actorStateContextPayload(state:ActorAgentState, options:ActorStateContextOptions={}, invalid?:()=>never):ActorAgentState`.

Options: `privateStrategySourceIds?:ReadonlySet<string>` and `includeRequestRevisions?:boolean`. Default error is fixed `Error('INVALID_AGENT_CONTEXT')` with code INVALID_AGENT_CONTEXT, no source text/content. Adapter supplies `()=>itsOriginalInvalidFunction(code)` to retain its existing error identity/class/code. Callback is called once for a failed validation; no catch/retry that hides or replaces it.

Pure explicit whitelist of all ActorAgentState standard fields and nested goal/plan/action/responsibility/decision/condition/focus fields. No DB-object spread, authorization selection, summary, interpretation, truncation, database, network or capability registry. Conditional spreads construct only explicit known optional fields. Arrays and nested records detach. Unknown metadata/getters are not copied or visited. Known primitive/string-list shapes are checked; five actual condition variants preserved; malformed known values fail instead of copying an object into a text field.

NPC defaults match the existing326762b8 adapter's actual serialized state shape: no responsibility.revision or decision.responsibilityRevision; matching privateStrategy source quote becomes empty string while IDs/history remain. Caller must pass its already authorized viewState and privateStrategy source set; this is not a substitute for source/audience/forgetting authorization.

Director includeRequestRevisions=true preserves explicit responsibility revision and decision responsibilityRevision, including0. Absent revision remains absent; no inferred revision0. Existing actor revision/projectedWorldVersion, goals, terminal states, action/result references, waiting conditions, responsibility resolution, decision history and focus are retained. No closed-loop state compression or historical trimming occurs;1200-decision test proves no limit.

Parameters keep the current **open Record** contract: only finite number/string/boolean/null/string[] values, cloned arrays. Nested objects, mixed/sparse arrays, nonfinite numbers, undefined/functions/bigint/symbol, accessor parameters and nonplain containers fail. Parameter key names and valid string content are not semantically reinterpreted or mapped to supported capabilities. An unrecognized historical capability name is copied as data, never registered/supported by this serializer. Capability-specific parameter key/schema validation and real private content inside otherwise standard text remain upstream kernel/source/adapter duties; metadata must not be placed inside the open parameter dictionary and assumed to be a removable extra field.

## Root adapter integration

- NPC: replace only private statePayload/condition/focus implementation with this shared function, pass privateStrategySourceIds and original invalid callback. Do not change its authorized view or request budgeting in this package.
- Director: whitelist actorStates through this function with includeRequestRevisions=true; do not spread raw database state into the request. Preserve current/request-history distinction and all execution state.
- Existing snapshot/attempt persistence may still retain canonical state for CAS/replay; model serialization is the explicit boundary. This helper does not erase persistent state or prove that an adapter is wired to call it.

## Verification and scope

**9/9 pure tests**, standard typecheck, module boundaries544 files, targeted Prettier and diff checks passed. Tests include actual existing NpcAgentModel with a local TextModel stub capturing its real serialized request and comparing default shared output; no copied serializer as expected result. This is zero external/provider calls, not natural NPC/model quality acceptance.

Other coverage: extra privateProfile/interview on root and all nested objects plus unknown getters omitted/unread; private quote trimming without mutation; director revision0/current vs historical and no synthetic missing revision; all arrays/nested objects detached; bad JSON parameters fail with fixed content-free error; exact adapter invalid callback identity and one invocation; malformed condition/known field/accessor rejection; empty/null/optional shape and long history unchanged. Logs ignored.local/state-context-test.log and state-context-type.log.

No PG, real model, production, fullcheck/build, source adapter or public contract edits. Root still wires both actual adapters, runs integrated gates and deploys; source freeze alone does not claim the Director request is already protected in production. Longer-term context compression remains a separate task, not an excuse to drop state here.
