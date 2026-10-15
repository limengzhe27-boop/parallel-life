# TIME-EXPERIENCE-39

Root owner codex-root-time39, managed history-chat-media worktree / codex/time-experience39. User approved implementation after discussion. Root integrates shared contracts, HTTP/client, phone lifecycle and deployment;39-B owns clock leases/advance;39-W owns atomic waits and history replay. No expired model acceptance allowance reused.

## Product rules and implementation

- Foreground browsing defaults to12x. Typing, pending replies and active scenes switch to1x; after dialogue ends there is30 seconds to read before browsing speed resumes.
- Proactive checks run after75 seconds of inactivity, independently of speed. Eligible source-backed story selection has a90-second real cooldown; generic managed beats use15 story minutes. Empty agendas stay quiet. Partial beats are not discarded by early checks.
- Per-window owner-scoped activity leases renew every15 seconds and expire after45 seconds. Leaving sends a scoped pause; connection loss freezes at the recorded deadline. Returning requires explicit continue or wait. One tab leaving cannot pause another active tab, and old request sequences cannot override newer controls.
- First adoption settles elapsed time at the existing speed, then changes the anchor. Existing absolute appointments and authored source content are untouched. Initial default12 affects new rows only.
- Normal browsing stops at confirmed appointments, with immutable initial appointments merged with actual committed responses/attendance. Confirmation immediately adds the cap in the same transaction. Continuing is explicit.
- Three deterministic waits: half an hour, next confirmed appointment ten minutes beforehand, or next local08:00. Source-backed earlier appointments/eligible dated story boundaries/pending opening or important unresolved requests stop the wait. The wait does not move the player, mark attendance, finish an event or fabricate messages. Receipts persist atomically and are recovered by the same command.
- Private author trials use only their bound world through the scoped allowlist. UI uses one compact time row and optional controls, no engineering fields or large error modal.

## Verification / delivery checkpoint

Integrated full check2447 pass, build passed. Subsequently integrated final fractional-deadline/manual-speed cap patch: child focused9 pass; root final combined real PostgreSQL31 pass (new activity and wait plus old appointment wait). Independent service scenarios cover both owners, multiple tabs, stale requests, offline freeze, rebase, immutable receipts and wait interruption. Deployment/online UI verification pending; not delivered yet.

## Scope limits

This release controls time and opportunities, not a guarantee that any75-second check produces a dramatic event. No new model call or synthetic dialogue substitutes for real runtime. Ordinary unread status is local, so wait protection uses server-verified unresolved requests rather than pretending all unread messages are important. Natural-language-only future timing has no invented timestamp; explicit authored constraints and confirmed appointments provide deterministic boundaries. Business opening-hour authoring, broader autonomous scene progression and generated dialogue quality remain followup tasks. All actual manuscript originals/publications remain unchanged.
