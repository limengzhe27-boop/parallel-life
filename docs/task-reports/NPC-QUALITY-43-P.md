# NPC-QUALITY-43-P

Owner: codex-npc43-p (chat 01a11a84-9572-7ab0-92fb-967f963dfc20). Sole integration, deployment and paid QA caller: root in 设计平行人生体验原型.

Baseline: 66da58f9, business 0aa90f6c. Worktree publication-story-02, branch codex/npc-quality43. Scope frozen with root before implementation: world types/validation/turn-planner/actor-goal-repository; publication-event-goal-context; direct tests and this report. No SQL migrations, public API/UI, services, author manuscript or production changes.

## Behavior

- Explicit producer-only source protocol: `source=current_user` or `current_reply`, with goalKey/target/kind and closure only for closure. Source and quote are mutually exclusive, arbitrary fields rejected. Current reply must be the unique raw message.received carrying the actual current actor ID, before adapter actor normalization. Multiple/foreign replies cannot supply this source. Director cannot bind a player utterance. Server derives a contiguous Unicode-safe original excerpt within 240 UTF16 units, then applies the unchanged canonical shape, target/kind, goal scope and quote validation. Canonical proposals do not accept source fields. Legacy quote errors remain errors, never silently rebound.
- Optional invalid annotation groups remain wholly excluded; the real valid dialogue can still save. AI classifications do not establish executed physical actions, completion, other actor results or consent beyond the source-bound private semantic candidate. Existing transactional receipt/version/source/privacy guards remain intact.
- Personal phase and sharedEventPhase separated. One actor withdrawn/fulfilled means its own resolved/finished; another active actor stays active. Shared phase exposes scheduling only, no other actor decision or private dialogue. Deferred actor waits without treating all actors as finished.
- The actor prompt treats closed wants as historical, answers a new arrangement question with a possible concrete next plan, avoids repeated refusal acknowledgment and does not claim finished work or invent crises. No forced text replacement, second generation or hard failure for repeated dialogue. Actual improvement requires the fresh real-model QA, not the deterministic prompt assertion.

## Verification and next step

- Direct contract/planner: 14/14 passed. Includes mixed legacy fields, wrong source/target, foreign actor, ambiguous replies, director impersonation, Unicode bounds and canonical-only parsing.
- Actual PostgreSQL 18.4 on isolated port 55566: actor-situation integration 14/14 passed; new binding traverses real turn commit and progress ledger, A declined/withdrawn vs B engaged/active, same shared event, no private-direction leak, legacy bad group saves dialogue but does not advance ledger, explicit retry/clock/source fences retained. Updated outdated baseline assertion that expected whole-dialogue rejection after 0aa safe fallback; subsequent test world versions follow the actual committed dialogue.
- `npm run check`: boundaries/typecheck and 2469/2469 tests passed.
- `npm run build`: passed; compilation, type check and page generation complete. All business changes now frozen for root integration review.
- Fresh direct human authorization call_309fbe3c3387463b82cc037998268859 is max16 text calls/1 independent temporary save; root's exclusive ledger is history-chat-media/.local/npc43-qa/quota.json. This implementer consumed 0 model calls/0 saves, does not reopen closed task42 budget. Root owns READY deployment, actual model acceptance and downlist/pause cleanup. Until that evidence lands, this is pending acceptance, not completed delivery.
