# 44-154-P2 · NPC v6 explicit non-executing plans

Owner: `codex-batch-lease-review-154-p1`. Branch/worktree: `codex/npc-plan-intent154-p1` / `/Users/limengzhe/.codex/worktrees/npc-plan-intent154-p1/人生剧本`. P1 prerequisite: `c4f84653`; root deployment baseline: `dfcc614d`.

## Delivered runtime wiring

Current model output is `npc-wire-v6`, prompt `npc-agent-v35-explicit-plan-intents`.

- V6 replaces the free-ID `plans` field with P1 `planIntents`. A new goal must be explicitly nested under `create.goal` or the existing `executions.goal`; dangling local goal references are never repaired.
- Top-level `goals` updates are restricted to visible, existing nonterminal goals and must cite the uniquely authorized current input. Existing result IDs remain bound to trusted prior actor state; model-supplied result receipts remain forbidden.
- The state-scoped provider grammar restricts existing goal and plan IDs, excludes terminal/in-flight plans, offers update/close only when no unfinished child actions would be erased, and shares a next-step definition to bound schema size. With no editable goals the grammar offers `goals:null`, decoded only as an empty update list in that exact scope.
- V6 compiles P1 plan intents, reuses the fixed V5 interpretation/execution conversion, and merges canonical proposals. Same-goal cross-channel planning, duplicate IDs or replacement targets, and conflicting terminal/deferred goal updates are rejected. Different-goal plan and execution can coexist; execution count remains at most one and statement dependencies bind only actual execution intents.
- The original proposal schema and domain kernel still validate the final result. This module executes nothing, does not mark goals fulfilled, and creates no facts or responsibility outcomes.

## Compatibility

`PreviousInterpretationWire` is permanently bound to `npc-wire-v5`; upgrading the current constant cannot reroute historical V5 into the V4 parser. V1–V4 decoders and execution ID generation remain unchanged. V5 raw IDs, interpretation semantics, stored receipt recovery and invalid dangling-goal failures are preserved. There is no automatic correction or repurchase of old invalid responses.

The source changes are limited to `npc-model-protocol.ts` and `npc-agent-model.ts`. Tests changed only current prompt/schema assertions in existing `npc-agent-model.test.ts` and `npc-model-protocol.test.ts`; old protocol fixtures were not rewritten. New `npc-plan-wire.test.ts` covers V6, mixed channels, goal lifecycle and V5 preservation.

## Verification and limitations

- Focused pure suite: `npc-plan-wire`, `npc-agent-model`, `npc-model-protocol`, `npc-plan-intent`: **81/81 pass**.
- `npx tsc --noEmit`: pass.
- `npm run check:boundaries`: pass, 647 files.
- Prettier and `git diff --check`: pass.
- No SQL, real model, production, deployment, broad check/build or old paid raw mutations.

This is ready for root integration, not a claim of natural model performance or deployment. Root retains integration, real PostgreSQL lifecycle verification, commercial model acceptance and final production deployment. Previously invalid/unknown real attempts remain untouched. The separate autonomous agenda scheduler and cross-version paid-response rebase are not implemented by this task.
