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

## Deployment receipt

Business 04db62dde3b505526a68070d70858108e90540c0, dpl_4Lyn4ohNHdwXM74JZWJiNxfbjxnK exact READY and formal alias parallel-life-nu.vercel.app verified. Final check3354/build passed. Public health/workbench200 and anonymous publications/publisher works401; original paused synthetic trial old/new clock protocol200, still paused. No new paid calls. Local browser TaskSpace210 synthetic UI mobile390x844 / PC1365x900 screenshots inspected, no model or generation run; finished/closed. This UI check is not live media performance evidence.

Full old-save opening and commercial automatic image journey remain unaccepted, tracked in canonical DEVELOPMENT.md. Current old-save Director quiet is retained; no forced authored opportunity or hidden paid retry introduced. Prior artificial +2h records have not been bulk removed without source reconciliation.

## 2026-10-23 生产 Grok 真实索图（通过）

- 生产 `YIBU_IMAGE_MODEL` 已切到 `grok-imagine-image-2.0`，新部署 `dpl_DMbYz9sv2HTZjAt7N1VBEYK3chPk` READY，正式域名 health 200。
- 合成验收世界 `县城黄毛`，微信林悦真实输入“发一张你现在的照片给我。”；NPC 先回复“你等着，我给你拍张照片。”，随后产生 `media_f564...` 媒体消息。
- 媒体消息 `photoId=a6e9d682-8ff5-4dd7-a68e-55440823521e`，`mediaStatus=ready`，标题“【留影】林悦的生活随拍”，`mediaType=image`；world version 229→232。
- 授权资产 URL `/api/v1/assets/{photoId}?worldId=...&revision=1` 返回 **200 / image/jpeg / 327366 bytes**；手机聊天内真实显示林悦照片。
- 截图：[44-155-real-grok-image.png](assets/44-155-real-grok-image.png)。
- 0 unknown；未手工插入图片/消息；测试世界已暂停。

这证明“普通聊天 → 原媒体任务/队列 → Grok 真实生成 → 存储 → ready → 手机显示”的生产链路已打通。仍不等于 `44-158-LIVE` 的长期延迟/多轮/人物一致性全部通过。
