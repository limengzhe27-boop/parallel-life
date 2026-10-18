# 44-157 Playable relaunch and real send preflight

Owner: codex-root-relaunch157; integration unified-engine137. User authorized full manuscript copy, publish replacement, remove exact broken save/old listing, primary catalogue. Other players and source author draft retained.

## Actual defects and architectural changes

- Saved production Director request was 66,296 message chars (system 3,778 + user 62,518), rejected by gateway 64k local validation before HTTP. Director preflight checked only user body. Request assembly now shares identical author provenance and identical manuscript copies, retaining node hashes/full original snapshot; validates total system+user. Same saved input now 55,584, gateway preflight passes without commercial call.
- Current accepted player inputs at world v33 had no NPC attempt and no paid send. Reconstructing actual authorized snapshot reproduced NPC_AGENT_SNAPSHOT_LIMIT before claim. Growing system/wire protocol crowded ordinary actor context out of obsolete 32k envelope. Message cap now48k, payload24k and complete request/schema56k retain bounded context below gateway64k; full current snapshot preflight passes. No false dialogue or model retry added.
- Accepted oversized NPC input now leaves a cancelled-before-send durable attempt, without marking sent. Trusted adapter local INVALID_CONFIG carries explicit not_sent; runners store known terminal failure rather than unknown paid send. True transport uncertainty remains fenced.
- Entry/visibility-return reconciles saved send receipts through read-only existing endpoint (bounded3 concurrency), exact identity required. Only committed/known failed unlock; missing/inflight/unknown stays protected, no automatic resends/model calls.
- Published catalogue mounts directly in primary All tab using original publication start endpoint, not duplicate engine. Standalone route retained for existing links.

## Author replacement

Source original draft120:6 actors/18 events/79 history messages/24 moments. Full private original/published backups;68-table exact old-save backup;48 uploaded assets (17 structured IDs plus URL-only moment/avatar refs) copied byte-for-byte through existing signed upload/finalize, remapped to new work ownership. New draft122374fd-056b-422f-81d7-a92782f06d35 title 渣男体验 · 新版. Original draft retained. New publication v1 is live. Old work5f1743c9 is unlisted; exact reported old save81bab37d soft-deleted via original owner repository after68-table backup. Original source author draft120 and other saves retained. Inverting asset mapping/title yields deepEqual to source manuscript.

## Validation / remaining

check3366 passed; production92 migration checksums match, no SQL change. Actual Director/current NPC reconstructed with fake transport (zero commercial requests); this is not natural-model acceptance. Build and real PostgreSQL native service10/10 passed (fixture updated to existing waiting/withdrawn contracts; product guard unchanged). c39482dc78da0d10dae6f869d5fedf1887d31b68 / dpl_DuSY1j4wwGnS2PmNzRkvFss8RjNC READY on formal Nu. Mobile390 and desktop1440 primary published catalogue visually inspected; health/workbench/possibilities200, anonymous publisher works401. Fresh independent visitor catalogue contains only replacement; existing owners may still see their other preserved old saves. No world/model started by catalogue verification. Old-world deletion exposed missing world_delete authorization; connected existing player unit-of-work under row lock (no fence bypass); real PG life management8/8 passed. Supplemental deployment pending at this checkpoint. True continuous opening quality/image generation remains unaccepted commercially; no new quota assumed. Existing daily background/global2 bound remains154; no false claim of minute-level offline narrative.

## Follow-ups kept honest

- Commercial natural opening/event handoff and parallel image generation/delivery are not accepted by this zero-call batch (148/150 and154 remain open).
- Publication check currently reports mediaVerified before all SQL asset guards; final publish correctly rejected foreign URL-only references. Improve pre-publication material ownership diagnostics in a later task; no guard was weakened.
