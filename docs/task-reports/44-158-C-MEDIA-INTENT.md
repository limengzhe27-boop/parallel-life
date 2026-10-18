# 44-158-C — Explicit semantic media intent compiler

Owner codex-media158-c; root is sole integrator. Independent branch codex/npc-media158-c, base3195af41, worktree /Users/limengzhe/.codex/worktrees/npc-media158-c/人生剧本. Only the new compiler, focused test and this report are changed. No shared protocol/model/kernel or SQL edits.

## Interface

`NativeMediaIntentSchema` is a strict discriminated union:

- `{kind:'not_requested'}` / `{kind:'decline'}`: no execution field and no generated state, return null.
- `generate_image`: goalSummary, planSummary, parameters containing only sceneDescription and purpose (portrait/scene/memorial/evidence), basisSourceIds.
- `generate_video`: goalSummary, planSummary, parameters containing only actionDescription and purpose (scene_moment/character_action), basisSourceIds.

`compileNpcMediaIntent(context,raw)` returns the existing nested `{goal,plan,action}` Execution syntax or null. It does not return an executed action, response text or completed result. Root can feed that Execution through the original decoder, AgentProposal schema and kernel.

`nativeMediaIntentIds(context,kind)` exports stable goalId/planId/actionId; IDs hash world/actor/current input source/kind/media-slot0 with a versioned prefix. `NPC_MEDIA_CURRENT_REF='media:current'` is a declared wire alias; root must explicitly bind a statement's dependency only when an active intent exists. No automatic statement or keyword interpretation is included.

## Boundaries

- An active kind is the NPC's explicit unconditional do-now choice, never inferred from user input or dialogue. The compiler cannot turn decline into willingness, fill descriptions or choose a broader goal.
- Action capability must already be allowed. All basisSourceIds are explicit, unique and present exactly once in the supplied authorized source scope, and must include the current input source. Wake/coordination may use their current system source. Missing current basis is rejected rather than inserted.
- New goal/plan/action IDs may not collide with any authoritative or model-view goal/plan/action/responsibility/decision ID. Existing or redacted state cannot be overwritten; compiler never fulfills a goal or consumes a responsibility.
- Own actor is the only action target. There are no invented conditions, deadlines, dependencies, media outputs or consent decisions. Required waiting must be expressed elsewhere instead of selecting the unconditional active media branch.
- Parameters are limited to fields actually consumed by the current executor. No aspectRatio/style/duration/recipient fields are silently accepted. media.share is intentionally absent because actor-visible asset catalog and actual share delivery are not yet proven.
- No mutation of context/raw/state. Returned source arrays are independent copies. Original attempt replay/unknown fences remain the caller's authority; existing nested/canonical saved responses must retain their original meaning in root's compatibility decoder.

## Validation

- `node --experimental-strip-types --test tests/npc-media-intent.test.ts`: 7/7 passed.
- `npx tsc --noEmit`: passed.
- Focused tests cover decline/no intent, original AgentProposal+kernel acceptance, no result/goal completion, video and ignored-parameter rejection, explicit sources/current wake source, deterministic IDs and scope separation, authoritative/redacted collisions, capability denial and model-supplied execution/extra IDs rejection.

Pure compiler only: no database changes, network, commercial model/image/video calls, production writes or deployment. No broad repeated check/build; root owns full integration, necessary original execution PG acceptance and release.

## Integration remaining

Root/158-R integrates the simpler native branch into npc-model-protocol and removes the old deep media form from the new model output. Preserve legacy nested response decoding by shape/version, reject duplicate/conflicting media executions, map media:current only on explicit active choice, and keep submitted-versus-ready UI/goal semantics. Do not claim natural willingness or real image generation is proven by these deterministic tests.
