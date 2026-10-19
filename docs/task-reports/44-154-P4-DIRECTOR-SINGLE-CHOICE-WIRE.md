# 44-154-P4 · Director single-choice wire v5

Owner `codex-batch-lease-review-154-p4`; branch/worktree `codex/director-choice154-p4` / `/Users/limengzhe/.codex/worktrees/director-choice154-p4/人生剧本`, based on `5b8a061e`.

## Delivered

`director-wire-v5` has only `protocol`, `events`, `candidates`, `opportunities`, `audit`. The model no longer outputs a redundant `mode` or a second authored `consider` flag.

- An authored event chosen now is represented by one actual opportunity with its authored origin. Multiple actors belong to that opportunity rather than duplicate opportunities for the same event.
- Events not chosen now must appear in `events:[{eventRef,reason}]`, explicitly deferring them. Authored opportunity refs plus deferred refs must cover the current eligible/unoccupied catalogue exactly once, without gaps or overlap.
- Mode is mechanically derived: opportunities => `bounded_opportunity`; otherwise selected real candidates => `coordinate`; otherwise `quiet`.
- Each actual authored opportunity mechanically yields its `consider` assessment, using its model-authored description as the assessment reason. No opportunity, player agreement, execution or story fact is invented. Event hashes, qualification and source remain server-bound through the original validator.
- The new transport normalizes into the fixed V4 wire shape and follows all original source, actor, staging, capability, qualification and opening-boundary checks. It does not re-enter a model or create a second engine.
- Strict provider grammar removes mode and event decision fields and retains immutable reference enums. Prompt version is `director-runtime-v16-single-authored-choice`, preserving the base V15 player-facing participation guidance.

## Compatibility

V1–V4 protected raw remains on its original fixed parsing paths. In particular V4 `quiet + consider + no opportunity` remains invalid; this change never retries or repairs those paid failures. V3, V4 and V5 keep the same attempt-namespaced opportunity ID binding. Pre-wire/V1/V2 IDs remain unchanged.

## Evidence and handoff

Changed only `director-model-protocol.ts`, `director-agent-model.ts`, current schema/example assertions in `tests/director-agent-model.test.ts`, plus new `tests/director-single-choice-wire.test.ts` and this report.

- Focused single-choice + original Director model + run-Director tests: **95/95 pass**.
- TypeScript check: pass.
- Prettier and diff checks: pass.
- Zero PostgreSQL, commercial model, production, broad check/build or deployment operations.

Root owns integration, real database/model acceptance and deployment. This task does not claim autonomous contact quality or end-to-end story progression is proven. Existing invalid/unknown paid attempts are not changed.
