# 44-155 Chat media execution and existing-world event continuation

Owner: codex-root-chat155; sole integrator. Worktree unified-engine137, baseline e910b748. User authorized collaboration; opening_fix owns entry probe/test, Xiaoan read-only audit. No new paid text/image/video calls, no production world writes.

## Changes

- Normal private message receipt drains the existing durable Outbox, then Next.js `after()` executes at most two queued media tasks emitted by that exact committed event/owner/world, inside the configured HTTP lifetime. Uses existing `runOwnedTask` and SQL worker leases. No unrelated owner tasks or terminal/unknown automatic retries. A platform interruption leaves durable task/recovery state rather than pretending an image exists.
- Phone reads pending media projections every three seconds while visible; narrative version need not change for an image to become ready. This is read-only polling, not repeated image generation.
- Removed keyword-only media effects from the epoch2 kernel. NPC must propose an allowed media action; a refusal produces no paid image task. Existing generate/share action execution, validation, Outbox, asset delivery and isolation remain authoritative.
- Removed the entire `authoredAppointments` materialization path and helper. Required author events no longer create arbitrary +2h calendar appointments. Explicit manuscript invitations retain their original time and source. Existing history/appointments are not bulk deleted or rewritten: old manufactured records need source-specific reconciliation before changing a real player's choices.
- Phone entry now permits pending work for the actual private interlocutor, while unrelated NPC/global Director work remains deferred during focused conversation. Paid-invalid/unknown attempts are not retried. Existing legacy authored eligibility/narrative pipeline remains the only entry path; no replay of genesis.
- NPC response context distinguishes actor-visible responsibility IDs from question/episode request IDs and states current player negotiation overrides older hints. Kernel remains the authority; no missing responsibility/action is invented to accept an invalid response.

## Evidence

- `npm run check`: 3354 passed. `npm run build`: final result recorded at handoff.
- Original real PG phone entry suite: 10 passed; exact-focus tests: 5 passed.
- New real PG chat media selection/dispatch test: 1 passed, includes other-world/event and terminal/unknown exclusion.
- Real PG actor media capability suite: 6 passed, including refusal never generating media, valid image/video requests and asset-share validation. Controlled executor/provider fixtures, not commercial model quality proof.
- Production read-only schema verification: 92 checksums match, 121 world state/version hashes preserved during read. No migration added.
- Latest read of reported original world 81bab: one committed Director response, zero opportunities and zero pending episode requests; actor committed calls grew from 13 to 14 while reading, and temporary request_sent completed naturally. This is active user traffic, not a stuck call; no cancellation/reset performed. Compact world.messages is not used as a message-count proof.

## Incomplete / acceptance boundary

These changes remove identified transport/execution/focus bugs. They do not prove natural commercial generation and opening performance in the reported old save. Its prior quiet Director decision is retained; no context deletion or forced re-evaluation just to manufacture speech. The original full opening journey remains pending bounded real-model acceptance. No fresh image validation allowance is assumed, and prior closed allowances are not reused. Background all-world minute-level scheduling remains task154, unchanged. Existing potentially fabricated +2h appointment cleanup remains pending provenance reconciliation, not a blanket delete.
