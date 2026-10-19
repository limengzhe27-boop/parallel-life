# 44-154-P1 · Explicit non-executing NPC plan intent compiler

Owner: `codex-batch-lease-review-154-p1`. Base: `dfcc614d`. Worktree: `/Users/limengzhe/.codex/worktrees/npc-plan-intent154-p1/人生剧本`. Branch: `codex/npc-plan-intent154-p1`.

## Scope and delivered interfaces

Only two new source/test files plus this report. No edits to protocol, model, kernel, SQL, existing protected completions or production.

`npc-plan-intent.ts` exports `NativePlanIntentSchema`, `NativePlanIntentsSchema`, `NativePlanIntent`, `nativePlanIntentIds(context, ref)` and `compileNpcPlanIntents(context, raw): { goals: AgentGoal[]; plans: AgentPlan[] }`.

- `create`: `{kind,ref,goal:{kind:'new',summary,sourceIds}|{kind:'existing',id},summary,sourceIds,nextStep}`.
- `replace`: `{kind,ref,planId,summary,sourceIds,nextStep}`; target visible original plan binds its original goal, generates a new plan ID, records `supersedesPlanId`.
- `update`: `{kind,planId,summary,sourceIds,nextStep}`; preserves original ID, goal, child action IDs and supersession history.
- `close`: `{kind,planId,status:'finished'|'withdrawn',reason,sourceIds}`; closes an existing nonterminal plan only, with no new goal, result, execution or event completion.
- `nextStep`: `reconsider` with at least one typed condition; `wait` with explicit missing information; or `blocked` with explicit missing information. No action or closed-new-plan transport branch.

Local create/replace references hash the namespace `npc-plan-intent-v1`, world, actor, input source and ref into distinct `plan-intent-goal:` / `plan-intent-plan:` IDs. No model-authored new object IDs, no fallback goal inference and no dependence on current wall time.

## Safety and lifecycle

Existing references resolve exclusively against this actor's `viewState`, including identity checks and exactly-one-match checks. Terminal goals/plans are rejected. Every explicit basis includes the current input and uniquely authorized source records. Old plan sources are retained and must still be authorized; absent historical evidence causes explicit rejection rather than silently dropping history. Condition action/responsibility references must also be visible. Ref duplication, repeated old-plan targets, state object ID collisions, unknown keys and undocumented null/default syntax are rejected.

In-flight or hidden child actions always block changes. Update/close also reject any unfinished child action. Explicit replacement may retire visible, unexecuted child actions using the existing kernel supersession mechanism; the compiler does not invent withdrawal receipts or action results. Existing goals are omitted from output, so their prior result IDs and sources cannot be overwritten by this helper. New goals are explicit active intentions with empty result IDs; no fulfilled state is generated.

## Root integration contract and remaining work

This helper is intentionally not a runtime route. Root must integrate it only into a new v6 wire branch, restrict top-level goal updates to visible existing goals, merge compiled goals/plans with original execution output while rejecting cross-channel duplicate targets/supersession conflicts, and pass the complete proposal through the original canonical schema and kernel. Existing v1-v5 decode/ID/recovery behavior stays untouched.

Array absence/null should be normalized by the v6 transport only when declared optional by that protocol. This required-array helper rejects null, unknown keys and missing semantic fields; its schema has no nullable optional child fields. Existing deferred goals are referenceable, but an active reconsider plan still needs an explicitly active goal after the full reply is assembled, as required by the original kernel. This helper cannot authorize current-source facts, execute an action or satisfy a responsibility by itself.

## Verification

- `node --experimental-strip-types --test tests/npc-plan-intent.test.ts`: 10/10 pass, including valid compiled create/replace proposals checked by the existing kernel.
- `npx tsc --noEmit`: pass.
- Prettier applied to both new files; no broad check/build, database, commercial model, production or deployment calls.

Status: ready for root integration/review. Deployment remains with root; this module alone does not fix the production v5 dangling-goal completion and must not be reported as an end-to-end delivery.
