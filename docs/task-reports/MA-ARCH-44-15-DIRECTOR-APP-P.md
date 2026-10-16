# MA-ARCH-44-15-DIRECTOR-APP-P — director application/model mock acceptance

Status: frozen pending root serial acceptance. No DB, live model, full check/build, browser or production operation. These tests do not establish real multi-role quality or actual-advance integration.

Agent `codex-ma44-director-app-p`, auxiliary2 `01a11a84-9572-7ab0-92fb-967f963dfc20`. Worktree `/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本`, branch `codex/director-app44`, exact original base `8764d8f9`.

Exclusive changes are three new files: `tests/run-director-agent.test.ts`, `tests/director-agent-model.test.ts`, this report. Existing implementation, ports and SQL were read-only. Root explicitly supplied implementation fixes, replayed as dependencies only: c1daed23 (local29cc3e1a),778dceb3 (local123e7427),b6c44970 (locala315325d). Those source fixes belong to root, not this test contribution. Root cherry-picks only the final three-file test/report commit; its source fixes are already on root.

## Verified workflow

55 application tests cover all8 finite statuses and both initial lookup and lookup/claim race paths:

- Fresh execution preflights/reserves, records request_sent, calls the mocked model once, durably records raw, parses and commits in order.
- Committed original result uses readDecision with zero parse, reserve, preflight or paid request. Incoming current snapshot can change; the original request identity must still match. Changed inputHash/epoch/expectedWorldVersion conflicts before exposing an old result/raw, consistently with durable claim identity.
- response_received recovers the protected original snapshot/raw, including a found JSON null, with no model or fresh preflight. Missing protected evidence is explicit, never a regeneration permission.
- reserved/request_sent/unknown_after_send/invalid_output/stale_discarded/cancelled_before_send cannot be automatically retried or parsed. Unknown remains unknown without a new call. Explicit abort before send records cancelled_before_send.
- Known preflight/budget failure makes no reservation or model request. Genuine post-send unobserved result/write loss records unknown, without parse/commit/hidden retry.
- Known invalid/oversize already-saved response status remains invalid_output; late saved stale response remains stale. They are not relabeled unknown or parsed again.
- Each known version/epoch/revision/cursor/pending-range/actor-state/boundary/episode/candidate/clock/cast/attempt-lease conflict is tested both before send and after protected raw at commit. It becomes stale, not unknown. Another actual episode already owning an opportunity ID is also a known stale conflict; duplicate opportunities inside one result are parser-invalid.
- Claim replay after lookup null is authoritative: committed returns immutable receipt without parse/model, response_received rereads original completion, all other six states stop. No path parses undefined or new caller context after a replay. Missing committed receipt/completion still causes no additional model request.

Mocks use the actual shared transitionAgentAttempt rules, so an illegal lifecycle transition does not get disguised by a permissive fake store. Mock receipts/proposals are explicitly local fixtures, not evidence of real AI output.

## Verified model boundary

17 model/parser tests cover:

- Strict complete selected/deferred candidate partition with no duplicates or unknown/omitted candidates.
- Typed nudge belongs to the selected candidate actor and uses only its preauthorized source subset. No arbitrary intent/text/parameters/title/description channel. Duplicate nudge and nudge/audit source IDs are rejected, matching durable store rules.
- Private global audit remains in the director decision. It is not rewritten into NPC guidance. Existing director-only fictional knowledge is expected in director input; these tests do not falsely forbid the director from observing its authorized global fiction.
- Bounded opportunities only reference existing actors/places, allowed activity and authorized sources, at most2 drafts with unique IDs/participants/places/basis. Extra active/result/event/attitude/player-agreement/dialogue/fact fields are rejected. Parsing a draft creates no world event or NPC action.
- An authoredEventKey without an actually offered typed authored candidate is rejected. A synthetic positive linkage fixture tests the reserved protocol only; it does not claim authored-event collectors or a manuscript library are integrated.
- Output IDs/world/epoch/hash/evaluated cursor cannot be injected; protected attempt/snapshot supply them. Malformed/nonobject/unknown-extra JSON is invalid, without pretending a regex-extracted object succeeded.
- Adapter preflight does not spend; the mocked complete call gets4096 output cap, JSON-object format and original signal, and original raw response is returned once. Whitelisted request fields omit unexpected real profile/interview top-level payloads while preserving authorized fictional setting/cast.
- Oversize request and incomplete observed snapshot fail without model request or hidden changes truncation. More than128 candidates or duplicate IDs are rejected before spending;128 can still express a fully quiet partition with the output schema. The141-case exposed the old structural impossibility (selected max12 +deferred128 could cover only140), corrected in root's source.

## Root-owned implementation defects and regression outcome

Source inspection identified the original lookup-null/claim-replay fallthrough. Root fixed durable-status recovery in c1daed23. Root additionally fixed early cache identity conflict, repeated opportunity sets, authored-link validation and episode-ID stale classification in778dceb3. Strict failing regressions under that dependency still exposed duplicate nudge/audit source acceptance (inconsistent with store) and unrepresentable candidate capacity. Root fixed both inb6c44970. Assertions were retained, not skipped or weakened; P did not edit existing implementation.

## Final evidence

`node --experimental-strip-types --test tests/run-director-agent.test.ts tests/director-agent-model.test.ts tests/run-agent.test.ts tests/npc-agent-model.test.ts`:100/100 passed (new72 =application55 +model17; existing NPC28). `npm run typecheck` passed; module boundaries540 passed; diff check passed. Ignored log `.local/ma44-director-app-final-mock.log`.

0 actual model calls,0 DB access,0 server/worker start,0 production changes and no full check/build. Root is separately deploying phase2 and retains ownership of actual director advance/episode activation integration and real acceptance; this test result must not activate an unfinished engine or publish the user's world.
