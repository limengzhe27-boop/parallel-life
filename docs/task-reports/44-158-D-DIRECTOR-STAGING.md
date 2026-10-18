# 44-158-D — Director strict references and participant staging

Owner: codex-director158-d. Sole integrator: root. Base 09a96362; branch codex/director158-d; isolated worktree /Users/limengzhe/.codex/worktrees/director158-d/人生剧本.

## Implemented

- Director adapter uses catalog-bound `json_schema`/strict mode rather than json_object. Per-attempt candidate/actor/place/source/event references are finite enums from the same immutable snapshot used for decoding. Empty domains forbid array entries; native turns cannot generate opportunities/nudges. Unknown/wrong namespaces remain invalid; no model fallback/retry or place-hash alias recovery. Schema over 24,000 chars fails preflight without paid send.
- `director-wire-v2` requires `stagingIntents` for each selected opportunity. Canonical staging has actorId, fixed `future_task` kind and <=600-char task; parser and transactional commit validate exactly one task for each participant, with no extra actor. v1/canonical saved responses remain readable with their original optional staging semantics. Provider nullable optionals decode only as omitted syntax, not new decisions.
- Immutable Director opportunity JSON carries tasks; no SQL migration or new engine/state table. An existing per-actor episode request projects only that actor's task as `director_intent` / `plan`, explicitly `future_proposal_only`. It binds request/decision/world/actor/version and basis into the source content hash; authored source ref is checked against the instance-bound manuscript. Forget lineage, epoch, source and origin guards remain. Global manuscript/description/playerImpact/audit and other actors' tasks are not forwarded.
- Existing author hint grammar and own-topic selections remain optional legacy paths. Authors do not need new special syntax to let Director propose future character interaction. NPC chooses engage/quiet/defer/decline independently from own persona and authorized facts. Projection never adds factual knowledge, attitudes, executed actions, positions or player consent.

This is deliberate future narrative proposal authority, not factual disclosure authority. Its free-text task is treated as a new proposal and must not claim unseen private facts or dictate attitudes; original model response remains unmodified for audit. Kernel remains authoritative for decisions and execution.

## Necessary validation

- `node --experimental-strip-types --test tests/director-agent-model.test.ts`: 26/26 passed.
- `npx tsc --noEmit`: passed.
- `npm run check:boundaries`: 630 files passed.
- New actual local PostgreSQL journey on dedicated 55618: `DIRECTOR_STAGING158_TEST_PORT=55618 node --experimental-strip-types --test tests/integration/director-staging158.test.ts`: 1/1 passed.
  - Original published-world compile/start/advance pipeline, plain authored director_event without hint blocks or actorTopics.
  - One protected Director call → two addressed requests → two independently validated NPC calls. One NPC quiet, other engage; event active, no completed result.
  - Each NPC receives own future task only with Director source/version. Other task, global manuscript, opportunity prose and audit absent. Unknown self position stays unknown; no actual-player-position source is injected; world facts do not gain task content.
- Existing actor-episode-intent PG regression: 28 of 29 subcases passed, including source/hash/body tampering, private-strategy isolation, forget during paid result, unknown fencing, no duplicate request purchase and SQL rollback recovery. One existing expectation at line1042 fails because the zero-send guard now keeps `cancelled_before_send` receipt instead of no attempt. This task does not modify that unrelated assertion or production recovery semantics. Parent suite reports 28 pass / 2 fail including aggregate parent; do not claim full suite passed.

No commercial model calls, production data changes, migrations, deployment or broad repeated check/build. Root performs final integration gates and deployment. Local tests initially exposed fixture-only receipt column/actor-order mistakes; corrected, then targeted journey passed. Private PG55618 was stopped after checks.

## Remaining / integration

Root owns semantic wake after new authenticated related contact, old paid invalid fencing, outbox migration0093, latency and final public release. This branch never revives old invalid version0 into current version8, does not rewrite old response or call a model to retry. Gateway strict-schema support and natural quality still require scoped real acceptance; controlled PG proves transaction/privacy/choice mechanics, not natural AI performance.
