# NEXT-PATCHES-01 · 让"渣男体验"可真实体验的三处最小改动

基线：`origin/main`（本文件提交时）。已上线成果见各任务报告。

## 现状核实（本轮查证结论）
1. `advance` 已修复：`POST /worlds/:id/advance` 从 503 变为 200，故事时间会推进（`ee4538a2`）。
2. 旧 `managed` 世界恢复离线时间累积（`4ad47674`），隔 1–2 天会命中既有"追进"逻辑（`79fba13d` 守门测试）。
3. 未读机制在数据层完整：历史消息 `initialRead: true`，新消息 `false`（`genesis-messages.ts:143/160`、`publication-genesis.ts:375`）；联系人列表已有红点（`messages.tsx:545-563`），打开即已读（`190-219`）。
4. **锁屏通知完全不存在**：全仓无 `Notification` / `serviceWorker` / Web Push。
5. **生图参考**：`media-handler.ts:77-85` 只要请求带 `targetActorId`，就用 `world_person_bindings` 的绑定素材做图生图；NPC 动作也能带（`npc-agent-kernel.ts:814+`），但请求不保证带。

## 补丁 1（P0）· 入口"有人找你"提示
- 位置：`src/features/phone/phone-desktop.tsx`（首页卡）或 `phone-shell.tsx`（入口）。
- 数据：`data.contacts.reduce((n, c) => n + (c.unread || 0), 0)`（同 `messages.tsx:166`）。
- 行为：未读 > 0 时显示一行"有人给你发了 N 条消息"，点击直接打开该人物对话。
- 验收：产生未读后进入手机可见；点开对话后未读归零。

## 补丁 2（P1）· 世界内发图强制带人物参考
- 位置：世界内图片请求文档构造处（聊天/朋友圈/相册分享）。
- 规则：NPC 发图 → `targetActorId = actorId`；玩家发图 → `isPlayer: true`。
- 降级：`world_person_bindings` 无绑定素材时，回执标注"无参考图（文生图）"，不静默走样。
- 验收：请求体含 `targetActorId`；同人物两场景各生成一张，人工比对一致性；无绑定素材时回执有降级标记。

## 补丁 3（P2）· 锁屏/系统通知（新能力，需评估）
- 需 PWA（manifest + service worker）+ Web Push（VAPID）+ 订阅存储 + 服务端在"产生未读"时推送。
- 平台限制：iOS 需安装为 PWA。
- 先做 PWA 化与订阅链路，再接"推进产生未读消息"的推送。

## 真实间隔验收（用户侧）
1. 退出「渣男体验副本」数小时；
2. 再进入：看故事时间是否前进、微信是否有未读红点/新消息；
3. 若时间前进但无消息，按 `agenda.ts:271-294` 的条件（1–2 天、防轰炸）逐条判定。
