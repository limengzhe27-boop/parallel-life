# OPENING-LIVE-37 — live multi-actor opening

Root owner: codex-root-opening-live37. Based on accepted 2fcb4822; unrelated pending director candidate excluded.

## Problem and change

Existing published opening selected one actor and marked the entire node presented. Real player evidence had one new NPC message, not zero, but the other five authored participants had no pending sends. Phone bootstrap also used the ordinary long interval.

A source-bound opening batch now calls the project director once, stores one scoped intent for each eligible authored actor, and delivers actual NPC turns separately. Each request performs at most one text model call. Real event/message receipts persist per actor; successful previous opening messages can be adopted only by exact committed source. Existing historical dialogue is not treated as a new AI reply. Unknown results require explicit recovery; late successes reconcile before another paid call. Owner RLS, command/version fencing and paused automatic operation remain enforced.

Phone checks this batch before ordinary beat throttling, reads actual committed messages after progress, and handles other-tab receipts even when its POST played=0. Visibility/sending gates are rechecked after reads; world changes fence pending callbacks. A compact inline status replaces large error UI. No raw director briefs or private script text are added to the public opening status.

## Verification before rollout

- Integrated check: 2428 pass, no failures/skips; build passed.
- Real PostgreSQL opening test: 5 pass (four scenarios plus suite), including ownership, exact legacy adoption, late receipts, ordinary version advances and explicit recovery.
- Independent read-only review confirmed cross-tab refresh and hidden/sending gates after narrow fixes.
- Production migration 0068 applied; all 68 migration checksums verified.
- Author original draft119 and approved copy draft4/publication1 unchanged.

## Deployment and live acceptance

Business implementation 78238762 is Production READY as dpl_F5XJtzG7HihN4XMz2GwCEG6YV78Y, https://parallel-life-3h2g6f2yw-limengzhe27-boops-projects.vercel.app. Formal https://parallel-life-nu.vercel.app assigned and checked before paid QA, as user requested.

Fresh scope used 10/12 text calls and exactly 2 independent synthetic player saves, no images or personal data. First player: actual director plan then native phone automatically delivered six actual NPC turns (six actors, six source events/messages, complete batch). A real player message received a contextual reply. Second player had a separate plan, distinct actors and one actual arrival, with the other five still queued; cross-owner opening GET404. Completed opening POST played0 and exact phone messages/version unchanged; reload retained history and new messages without replay. Real UI checked at1440 and390, no horizontal overflow, composer visible. Both saves paused and temporary work unlisted; browser original app session restored and TaskSpace196 finished. Approved real copy remains listed publication1/draft4; original remains unpublished draft119. No calls were made against the human's existing save.

Evidence retained only in ignored .local/opening37-qa: bounded ledger, exact API readback, SQL source counts, dedup receipt and two layout screenshots. Runtime write count first8 = six generated arrivals plus user+NPC reply, not historical messages. This scoped acceptance does not imply flawless writing: one generated key-return line reversed ownership wording; language/causal quality remains a separate followup rather than manually rewriting the test output.

## Limits and followup

This fixes multi-actor opening delivery, not all later dramatic branches or the separate autonomous scene director candidate. An opening whose authored hard eligibility changes during its batch stops honestly rather than bypassing it. Uncertain upstream results remain recoverable, never fabricated. Long-content and other pending product work remain in the canonical DEVELOPMENT registry.
