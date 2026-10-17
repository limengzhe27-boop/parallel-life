# NPC42-Q: frozen actor-goal integration review

- Agent: codex-npc42-q-20261015 (auxiliary reviewer).
- Frozen chain: 09bddaec -> a9ba7779 -> d8575f93; official baseline 93e0a016.
- Scope: this report, main-directory mirror and own DEVELOPMENT registry row only. No business source changes.
- Status: pending integration acceptance. Release-blocking budget regression reported to the integrator.

## Mandatory finding: legal long persona can stop normal replies (P1)

`src/modules/settings/domain/publication-content.ts:215` permits 16,384 characters per life module. `src/modules/world/domain/actor-situation.ts:66` throws ACTOR_PERSONA_UNIT_EXCEEDS_BUDGET if no complete newline/sentence unit fits the selected module budget. A legal single paragraph without sentence delimiters therefore fails before a normal NPC model call. The planner invokes this selector for authored persona, so increasing storage capacity does not make this runtime path usable.

Actual exported-function probe, Node strip-types, frozen d8575f93:

| Input | selectActorPersona({drives: input}, topic) | selectCharacterSource(input, topic, 1200) |
| --- | --- | --- |
| 4,001 identical characters, one paragraph | ACTOR_PERSONA_UNIT_EXCEEDS_BUDGET | 4,001 characters |
| 16,384 identical characters, one paragraph | ACTOR_PERSONA_UNIT_EXCEEDS_BUDGET | 16,384 characters |

Related mandatory budget escape: `src/modules/settings/infrastructure/publication-event-goal-context.ts:80` returns the entire first unit when none fits. With a 16,384-character Chinese paragraph both want and stance become 16,384 characters despite requested limits of 1,200 and 1,000. Passing these results in one event goal to the actual reserveActorContext with empty messages/facts reproduces ACTOR_REQUIRED_CONTEXT_EXCEEDS_BUDGET. This is an offline boundary probe, not a database/model/end-to-end test.

Required correction: bounded runtime excerpts with an explicit policy for oversized indivisible units, preserving stored source and avoiding silent omission of whole persona dimensions. Do not claim every turn reads the full manuscript. Add focused regression coverage for legal unpunctuated long modules and combined goal/persona budget, then integrate and verify the actual reply path.

## Other reviewed boundaries

- Multi-actor opening: a shared progress definition is built from receipt-backed completed deliveries; ownGoalBrief selects only the requested actor goal. Source hash, publication origin, message/event/command linkage and snapshot-version checks are present in actor-situation and opening participant loading.
- Refusal/reopening: actorParticipation is indexed by actor; reopening checks that actor. Closure withdraws observable actors and resolves the shared event only when all goal statuses are terminal. Criterion fulfillment requires server-matched observation and own visibility; model closure cannot directly claim fulfilled.
- Evidence: assessment quotes must match a current user/NPC message; applying assessments rechecks the actual committed event with a succeeded receipt in the owner transaction. Quote matching proves provenance, not semantic correctness of model interpretation.
- Private progress: general goals are saved as character-scoped belief/agent_inference. actor-context excludes the private progress prefix. Player memory reads use PLAYER_MEMORY_PREDICATE, which excludes character scope; services also attempts private-ID filtering. No public-memory leak established in these inspected paths.
- No additional mandatory isolation defect established by this bounded source review. This is not a complete proof of runtime correctness. Cadence/time review belongs to the other assigned reviewer.

## Validation and limits

- Ran actual selectActorPersona, selectCharacterSource and reserveActorContext exported functions against 4,001/16,384-character boundary inputs; reproduced both failures above.
- Read exact frozen source for own-goal projection, evidence validation, transactional receipt fencing, private-memory exclusion and shared closure.
- No PostgreSQL validation, live model calls, production writes, browser sessions or draft edits. No check/build run: integrator explicitly requested fast read-only review without broad tests; no source changed.
- Original source draft and published versions were not touched. No deployment performed by this reviewer. Root integrator owns fixes, full checks, real database/model acceptance and deployment.

## Handoff

Integrator was notified of the P1 with source locations and exact results. Source author must resolve runtime budget behavior; reviewer can recheck a frozen correction. Keep NPC42-Q pending acceptance until that correction is reviewed. Do not merge/deploy this frozen chain as a completed long-persona implementation.


## Assigned P1 correction (supersedes the read-only-only scope above)

Integrator explicitly reassigned this reviewer exclusive ownership of two budget selectors, a pure helper and direct tests. Business frozen commit: a6b6702626159d40db180d7e15ef3b23c4b6c3bb. No further business edits after freeze.

### Files and resulting behavior

- src/modules/world/domain/authored-source-excerpt.ts (new): deterministic bounded source excerpts. Keeps opening identity, prefers topic-relevant intact sentences, uses grapheme-safe raw windows only for oversized indivisible units; final hostile combining sequences use code-point boundaries. Counts inserted newline separators in UTF-16 input budget. No model or persistence dependency.
- src/modules/world/domain/actor-situation.ts: all supplied nonempty persona dimensions receive bounded excerpts instead of indivisible-unit errors. Under pressure only, after optional recall is exhausted, up to five decreasing excerpt budgets compact legacy persona, own opening direction, five modules and goal want/stance. Each pass selects from the original in-memory source rather than progressively truncating a prior excerpt. Fitting contexts remain unchanged.
- src/modules/settings/infrastructure/publication-event-goal-context.ts: uses the same bounded helper; no whole-source fallback exceeding the requested limit.
- tests/actor-situation.test.ts: replaces obsolete expected-long-unit-failure test with bounded usable excerpt acceptance.
- tests/authored-source-excerpt.test.ts (new): boundary and pressure regressions.

No database manuscript is modified or shortened. Both latest messages, current user input, actor identity, goalKey/source/status/participation/refusal boundaries remain unchanged. Legacy JSON persona stays parseable; recognized identity and boundary fields are protected verbatim. Text excerpts are not a claim that the model reads the whole manuscript.

### Validation of frozen correction

- 14/14 direct tests passed: 4,001/16,384/24,000-character unpunctuated Chinese, emoji/grapheme windows, topical intact sentences and raw windows, newline accounting, all five dimensions at 16,384 each, four goals with two 4,000-character recent messages, full newline/JSON-escaping pressure, immutable provenance/refusal/identity, and valid legacy JSON persona preserving identity/boundaries.
- npm run build: passed, process exit 0.
- npm run check: final frozen run completed 2,463 tests, 2,459 passed, four ECONNREFUSED 127.0.0.1:55570 errors (two character-image-flow tests and two RLS tests), exit 1. Local PostgreSQL for an earlier task was stopped; no fake replacement or unapproved database startup. Boundary and type checks passed. This is not a green full check.
- No actual PostgreSQL/model/production validation performed for this correction. No UI changes or browser checks. Root integrator must run real database and runtime acceptance and deploy the integrated candidate.

### Remaining explicit limits / integration handoff

- Root owns unified planner system text stating persona, current direction and goal material may be excerpts, not complete authored source. No new public API or ActorContext field added.
- Root must address actor-context.ts early identity fits check: an oversized legacy actor.persona can fail there before reserveActorContext. File is outside this assigned scope; exact early failure was reported to root. Do not claim every possible old persona now works end to end.
- Fixed 18,000 context / 24,000 serialized input limits are retained. Protected metadata, boundary fields or messages alone can make these limits mathematically impossible. Such input still fails explicitly; no source fabrication, boundary removal or silent message truncation is introduced.
- Source selector is a runtime excerpt utility, not a replacement Repository or a model acceptance test. Original draft and published contents were not edited or published by this agent.
- Business commit a6b6702 is ready for root cherry-pick; report remains pending acceptance and deployment evidence belongs to root.
