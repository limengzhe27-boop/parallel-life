# 44-157 Playable relaunch and real send preflight

Owner: codex-root-relaunch157; integration unified-engine137. User authorized full manuscript copy, publish replacement, remove exact broken save/old listing, primary catalogue. Other players and source author draft retained.

## Actual defects and architectural changes

- Saved production Director request was 66,296 message chars (system 3,778 + user 62,518), rejected by gateway 64k local validation before HTTP. Director preflight checked only user body. Request assembly now shares identical author provenance and identical manuscript copies, retaining node hashes/full original snapshot; validates total system+user. Same saved input now 55,584, gateway preflight passes without commercial call.
- Current accepted player inputs at world v33 had no NPC attempt and no paid send. Reconstructing actual authorized snapshot reproduced NPC_AGENT_SNAPSHOT_LIMIT before claim. Growing system/wire protocol crowded ordinary actor context out of obsolete 32k envelope. Message cap now48k, payload24k and complete request/schema56k retain bounded context below gateway64k; full current snapshot preflight passes. No false dialogue or model retry added.
- Accepted oversized NPC input now leaves a cancelled-before-send durable attempt, without marking sent. Trusted adapter local INVALID_CONFIG carries explicit not_sent; runners store known terminal failure rather than unknown paid send. True transport uncertainty remains fenced.
- Entry/visibility-return reconciles saved send receipts through read-only existing endpoint (bounded3 concurrency), exact identity required. Only committed/known failed unlock; missing/inflight/unknown stays protected, no automatic resends/model calls.
- Published catalogue mounts directly in primary All tab using original publication start endpoint, not duplicate engine. Standalone route retained for existing links.

## Author replacement

Source original draft120:6 actors/18 events/79 history messages/24 moments. Full private original/published backups;68-table exact old-save backup;17 uploaded assets copied byte-for-byte through existing signed upload/finalize, remapped to new work ownership. New draft122374fd-056b-422f-81d7-a92782f06d35 title 渣男体验 · 新版. Original draft retained. Publication and old listing/save retirement pending READY.

## Validation / remaining

check3366 passed; production92 migration checksums match, no SQL change. Actual Director/current NPC reconstructed with fake transport (zero commercial requests); this is not natural-model acceptance. Build/PG/UI/deployment pending at this checkpoint. True continuous opening quality/image generation remains unaccepted commercially; no new quota assumed. Existing daily background/global2 bound remains154; no false claim of minute-level offline narrative.
