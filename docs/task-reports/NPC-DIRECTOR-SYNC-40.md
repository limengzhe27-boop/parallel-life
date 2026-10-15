# NPC-DIRECTOR-SYNC-40

Status: in progress, initial read-only audit; no business changes or production operations.
Owner: codex-npc-director-sync40-01a11a84. Main registry is canonical. Sole integration/deployment remains 01a0c73b.

## Human-authorized outcome
Independent fictional NPC agents enact dialogue with distinct personality and persistent current objectives. A director observes committed outcomes and orchestrates the global story. Shared event progress and one world clock, no NPC-local timeline, no fabricated achievements or player consent, no full/private cross-character knowledge leaks. Avoid repetitive generic replies. Do not modify author screenplay or publish another world.

## Baseline and findings
Audited main 3d3442cc and unintegrated director a439903. TIME-EXPERIENCE-39 is being publicly accepted by integrator; clock/activity/wait/contracts/services/phone remain exclusively owned there.

1. Main already calls an individual WorldTurnPlanner for each NPC. Opening director creates actor-specific briefs and stores them in publication_opening_deliveries (0068). Merely adding another model process would not repair continuity.
2. Ordinary publicationCharacterPlanner only loads authored modules, posts, and readPresentedActorStory. The latter reads old publication_story_nodes only, not opening_deliveries. The real opening brief is not retained as an ongoing actor context after the initial opening orchestration.
3. All five authored modules form one optional supplement. If it exceeds ACTOR_CONTEXT_LIMIT 18000, the entire persona supplement silently disappears. Base recent/history memories may consume the budget before identity/active situation.
4. Candidate a439903 provides persistent actor goals, prepareContext, evidence-bound progress and scoped intact source-unit selection; do not independently duplicate or overwrite this engine. Candidate requires integration and real provider acceptance, not assumed live.
5. resolveTurn/main uses world version CAS and central projected story time for both incoming/outgoing messages. Preserve these fences and 39 clock semantics; NPC utterances must not independently advance time or assert physical results.

## Proposed delivery split / next step
Await integrator baseline and exact file release. Proposed exclusive new actor-situation domain helper and read-only repository, publication-character-planner.ts, turn-planner.ts, direct tests. Public port shape/new SQL only by integrator. First supplement actor-scoped opening direction with actual post-opening observations under version/time/source/forget guards; reserve persona and current situation before optional history/posts; make director observe confirmed shared progress without giving omniscience to characters. Reuse candidate persistent progress engine rather than introduce a second ledger.

## Acceptance
Meaningful deterministic tests for long persona and budget reservation, independent actor provenance, future/stale/forgotten/cross-owner isolation, same-event different actors, stale generation rejection and accepted vs actual action distinction. Real PostgreSQL on dedicated port for new reads, full npm check/build and coordinated production READY/public real dialogue exercise. No mock-model test is evidence of actual NPC naturalness. No paid model quota consumed yet.

## Implementation checkpoint
Actor-specific opening direction is read only after delivered receipt/message/event, immutable origin and derived actor-set hash, and current version validation under shared world lock. Future sources and forgotten evidence excluded. Own director direction is labeled intent, not canonical fact; actual newer records override it. Complete persona units selected per dimension and reserved before optional old recall/posts. No manuscript mutation. No public contract/SQL/clock changes; one explicitly loaned ActorContext field.

Real PG55566:9/9 (shared version/time, actor isolation, stale/foreign owner, future, tampered hash/message, forgotten source, long-conversation retention, actual planner wiring/forged supplement removal). Focused deterministic10/10, full check/build pending. These synthetic model stubs do not prove real dialogue quality.

## Independent human authorization / ledger
Human question: This task may use at most12 real text model requests and2 independent temporary test saves to verify personality/opening continuity/cross-actor progress; existing human saves unchanged, test work unlisted and saves paused afterwards. Previous opening quota closed, separate authorization required by integrator.
Human reply in this conversation: 授权本次独立验收（推荐）
Current actual consumption: text0/12, saves0/2. Root informed; only one shared ledger, no duplicate spending. No images.

## Follow-on41
I releases publication-story-service.ts, resolve-turn.ts/actor-context.ts after root39 final97368929. Keep40 separate frozen commit. User overall requirement is NOT completed by40 alone;41 must supply committed director observation and common progress with NPC-scoped views without integrating unaccepted autonomous candidate. No timeline/clock69-71 rewrite.

Final scoped validation: npm run check2452/2452; npm run build successful; real PG9/9; Prettier and diff checks clean. Authorship and immutable source maintained. Direct old test SQL stubs updated only to recognize the new required version/source read. Runtime and real model QA still pending coordinated deployment.
