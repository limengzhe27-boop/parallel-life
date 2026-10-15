# MA-ARCH-44-11-DIRECTOR-STORE-P — one persistent director boundary

Status: frozen pending root serial acceptance. No model call, full build or production operation; not end-to-end director/NPC acceptance.

## Ownership and scope

Agent `codex-ma44-director-store-p`, auxiliary2 `01a11a84-9572-7ab0-92fb-967f963dfc20`. Worktree `/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本`, branch `codex/director-store44`, base `5fa1810e` (frozen director contracts plus optional fictional worldSetting/cast). Root alone owns model, parser, application run, actual advance, kernel and final integration/release. No root WIP taken.

Four new files only: migration0075, `world/infrastructure/director-runtime-repository.ts`, `tests/integration/director-runtime.test.ts`, this report. Existing0072/0073/0074, public contracts, source readers, model/application/kernel/dispatcher remain unchanged.

## Interface and protection

`PostgresDirectorRuntimeRepository implements DirectorAttemptStore` with lookup/claim/mark/saveResponse/readCompletion/commit. Additional owner-scoped read-only `readEpisodes(ownerId, worldId): Promise<SharedEpisode[]>` and `readDecision(ownerId,worldId,id): Promise<DirectorDecision|null>` for root's internal snapshot assembly.

`directorSnapshotInputHash(snapshot)` exports SHA256 over recursively canonical JSON object keys (array order retained). Server injects it into its application runner; no application import of infrastructure. The protected snapshot is parsed and deeply detached, including unknown-typed persisted actor-state children, before asynchronous SQL. Attempt/input scalar identities are also captured before SQL. Caller mutation cannot rewrite already-hashed input. Actual persisted actor-state documents must match DB deeply; the store does not reinterpret their domain rules.

Input/response storage budgets are1,000,000 UTF8 bytes each, exported as `DIRECTOR_SNAPSHOT_MAX_BYTES` and `DIRECTOR_RESPONSE_MAX_BYTES`. SQL documents allow2MiB for formatting overhead. Oversize input is known `DIRECTOR_INPUT_TOO_LARGE` before reserve/model; pending coverage is never truncated. A known invalid/nonJSON/oversize response stores a protected `storageError` descriptor (and digest/size if serializable) as invalid_output, not unknown. Valid original raw JSON values/strings, including JSON null, survive durable recovery with the original snapshot. Oversize raw is not claimed to be fully recoverable; its invalid-response evidence is retained.

## SQL and finite lifecycle

0075 adds forced owner-RLS app-only `director_runtime_attempts`, immutable `director_decisions`, and protected `shared_episodes`. No worker/publisher/public grants. Actual pl_app membership plus transaction-local owner is checked before access; pl_worker cannot impersonate the app by setting app.user_id. Decision foreign keys bind owner/world/attempt/engine epoch/world version/input hash, and episode origin/content is checked against the immutable decision's actual opportunity with matching ID. Protected attempt input/core identity and a recorded response/send marker cannot be rewritten.

The same eight statuses as NPCs are used. A reservation is durable before request_sent, and no transaction spans a model call. Single unresolved director attempt per world covers reserved/request_sent/response_received/unknown_after_send. Exact same command/hash/snapshot replays the original attempt even after later world changes; another body conflicts. Unknown never becomes a paid retry. mark cannot manufacture response_received or committed. Known before-send cancellation remains before-send. Reliable late response may recover request_sent/unknown; expired/epoch-changed/world-version-changed response is durably retained as stale_discarded. readCompletion remains owner/token-bound after expiry.

Request_sent checks current original snapshot/CAS and verifies live lease again in its final SQL update. commit verifies live lease and then checks it again in the final status update; expiry during intermediate decision/cursor SQL rolls the entire transaction back. Raw-response final SQL also marks an already-expired lease stale.

## Snapshot authority and complete observed range

- Lock actual owned world, then current engine control, observed/evaluated cursor and actor projections using the existing short-transaction order. Exact world version and engine>=2 required.
- Story instant is strictly valid, no earlier than persisted world time and no later than actual current clock projection. World-setting prose remains authorized fictional metadata supplied by root's builder; no real profiles/interviews are read.
- Boundary equals the actual latest stored boundary; a genuine v0 world may derive its genesis boundary. v0 can initialize observed/evaluated0 with no event; nonzero missing awareness projection is rejected rather than fabricated.
- All actor states deeply equal current persisted state, cover the actual boundary actors and supply current candidate actor CAS. Optional cast must equal the existing fictional world's actual cast projection. Retained episodes must equal current persisted episodes; no fictitious old episode basis is accepted.
- Pending reason count and exact entire document set in `(evaluatedThroughVersion, observedThroughVersion]` must match snapshot.changes. Actual native event and succeeded command prove each pending reason, with no future event time. A first page cannot count as the whole evaluation, including the real default50-page boundary exercised by tests.
- Decision evaluatedThroughVersion must equal the protected snapshot's observed cursor. Snapshot's prior evaluated cursor must still exactly match DB at commit. Use existing same-SQL markDirectorEvaluated; no alternative cursor ledger.

Root's snapshot builder owns authorization/authenticity of global observation source text and knownBy sets. This store checks existing actors, candidates, current persisted state/cast/boundary, native pending sources and exact protection; it does not infer factual/semantic truth from free text. Allowed output source basis is the frozen union of observations, existing candidate source IDs and existing episode origins, as agreed with root.

## Decisions, nudges and opportunity drafts

All selected/deferred candidate IDs form an exact partition, without duplicates, unknowns or omissions. Strict schemas reject extra fields. Typed nudges require an existing selected candidate, the same actor and a nonempty subset of that candidate's already-authorized sources. Nudge has only actorId/candidateId/kind/basisSourceIds: no global audit reason, title, description or dialogue field can be smuggled through it.

Audit is private global data. Opportunity prose and SharedEpisode titles/descriptions are also protected global planning data; this repository does not send them to NPCs. Root must forward only typed, source-authorized nudges and separately implement any future safe introduction. No prose is considered disclosure permission.

Opportunities only use existing boundary actors/places, existing source basis and conversation/meeting/follow_up activity. They are allowed only in bounded_opportunity mode. Each creates one new SharedEpisode with its opportunity ID, revision0, status proposed, origin `{kind:director, sourceId:DirectorDecision.id}`, and empty sourceEventIds/resultIds/unresolvedResponsibilityIds. ID collision fails, never overwrites. SQL protects origin/content too. No NPC attitude/private state, player fact, location, message or world event is manufactured.

For this release, shared_episodes has no UPDATE grant and SQL only permits proposed drafts. Actual later activation/resolution requires root's separately validated kernel/native-source update and a subsequent migration. This batch does not claim active episode support.

Quiet mode requires no selected candidate, nudge or opportunity, while deferring all existing candidates and saving a real immutable decision, evaluated cursor and committed attempt in one SQL transaction. Quiet has0world events and0NPC execution. Original exact committed decision replay precedes current CAS checks; changed receipt body conflicts.

## Verification / limits

Real dedicated PostgreSQL18.4 on55566; idle port checked before start. Migration checksums through0075 verified, no previous migration edits. Final focused PG59/59 (new director18 +existing AgentRuntimeStore30 +player gate11), typecheck passed, boundaries535 passed, diff check passed. Ignored final log `.local/ma44-director-store-final-pg.log`.

Evidence covers canonical capture, replay and process-independent raw-null recovery; quiet0events and immutable original receipt after later native player event; protected proposed-only draft; candidate partition and typed nudge privacy; invalid actor/place/activity/source/output-extra rejection; complete pending range including51 reasons beyond default50 page; cursor/actor/boundary/cast/clock/version/epoch/token/owner drift; unknown not retried and reliable late recovery; expiry before raw and during final commit; before-send cancellation; known invalid response; late injected SQL failure rolling back decision/draft/cursor/attempt; detached state-child/input mutation; forced RLS/worker denial/protected source immutability.

One preliminary combined run included `world-awareness.test.ts`; that existing test hard-codes port55503 without an override, so it failed only that harness assertion at55566. It was not changed. Actual awareness projection, markDirectorEvaluated, source-event checks, default50 pagination and cursor conflicts were instead exercised directly through the new tests on55566. Do not describe this as a full database suite/full check pass. Root runs the canonical full integration environment later.

No models, browser, production data, author drafts or public worlds were touched. No full check/build/deploy/READY/public QA by this subtask.

## Root next

Root serially integrates0075/source; injects canonical hash into run-director-agent; builds the complete authorized snapshot, applies model preflight limits and handles known persistence conflicts without recategorizing known raw as unknown. Wire the same persistent director into actual advance/observer and single scheduler/NPC kernel; do not create a second agenda or fake NPC director. Root owns actual draft introduction/kernel episode transition, full checks/build/migration deployment/READY/public flow and final multi-role quality acceptance.
