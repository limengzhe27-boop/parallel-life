# 44-154-P3 · Explicit own-agenda review disposition and v7 source anchors

Owner `codex-batch-lease-review-154-p3`; isolated branch `codex/npc-agenda-review154-p3`, based on `519ac082`. Root retains integration, SQL, real PostgreSQL/model acceptance and deployment.

## Delivered contract

Latest protocol is `npc-wire-v7`, prompt `npc-agent-v37-review-disposition`. V6 is fixed as `PreviousPlanWire`, retaining its complete original `transport(raw,false)` normalization, plan schema, parsing and source behavior. V1–V5 paths are unchanged.

Only a server wake identified as `npc_agenda_review` accepts and requires `agendaReview: {decision:'quiet'|'update_plan'|'contact',reason,basisSourceIds}`. All other inputs require null. Authority still comes from the original runtime receipt and source checks, not a user-written JSON tag. Provider grammar offers the corresponding object or null by current input scope.

- `quiet`: statements must be empty; no actual goal/plan/responsibility/action/decision or focus change. It does not manufacture a plan.
- `update_plan`: statements must be empty and at least one actual goal, plan or responsibility change must exist. Copying prior objects or merely attaching a newer source anchor cannot masquerade as agenda progress. Server-owned revision alone is ignored when comparing semantic state.
- `contact`: at least one outward statement is required, but a plan is not mandatory. The model still owns tone and content; this contract does not claim to semantically guarantee the value of every contact.

The private reason and declared basis remain in the original protected raw response. They are not converted into a statement, new canonical state object, event result or separate story system. Mismatched output is rejected, never filtered by keywords or replaced with canned text.

## Mechanical source binding, scoped only to v7

Before delegating to fixed V6, V7 parses all explicit semantic fields and verifies each declared source array is nonempty, unique and authorized. The current input source itself must exist exactly once in the runtime context. Only `planIntents[].sourceIds` and `create.goal.kind='new'.sourceIds` receive a mechanically appended current input source if missing. All declared sources are preserved. No goal, summary, authority, condition or deadline is invented, and no duplicate is silently deduplicated.

Empty plan-intent arrays stay empty. Missing goal semantics, empty/duplicate/unauthorized sources and absent current input are rejected. Existing `compileNpcPlanIntents`, V6 source checks, execution channel, lifecycle rules and kernel remain unchanged. Previously invalid paid V6 replies lacking input anchors are still invalid and must not be regenerated or reinterpreted.

## Changes and evidence

Source scope: `npc-model-protocol.ts`, `npc-agent-model.ts`. Added `tests/npc-agenda-review-wire.test.ts`; existing `npc-plan-wire.test.ts` explicitly fixes historical V6 fixtures and keeps only its schema assertion current, while `npc-agent-model.test.ts` updates the latest prompt version assertion. No SQL, infrastructure authority or kernel edits.

- Focused tests (agenda review wire, plan wire, plan compiler, original model and original wire regressions): **89/89 pass**.
- `npx tsc --noEmit`: pass.
- Prettier and `git diff --check`: pass.
- Zero commercial model calls, production changes, broad check/build or database tests.

Status: frozen for root integration. Real cold-start quality, actual model choice between quiet/contact, PostgreSQL runtime acceptance and deployment are root work, not claimed complete by this task.
