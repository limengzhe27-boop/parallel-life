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

---

# 追加：为什么世界"不启动"的根因与修复规格（P0-0）

## 根因（已核实）
1. 编导内容有 `threads[]` + `openingCharacterId` / `openingThreadId`（`authoring-planner.ts:24-26` 定义）；
2. 世界创建时这些 `threads` **只用于开场叙述**（`world-planner.ts:156-157`），**没有落成持久对象**；
3. `publication-genesis.ts:284` 写死 `invitations: []`，`facts`/`choices` 也为空；
4. 而"谁主动联系玩家"完全依赖 `buildAgenda()`：它只认 appointments / facts / choices / 记忆承诺 / "静默 1–2 天"（`agenda.ts:271-294`）。
→ 结果是 `facts: 0 / appointments: 0 / choices: 0`，agenda 永空，`selectSpeaker` 返回 null，**没人开口、事件不推进**。

## 修复规格（框架内，不新增第二套状态）
在 `publication-genesis` 物化编导线：
- `threads[i]` + `involvedCharacterIds` → **appointment**（status `proposed`，at = 故事起点 + 短偏移，幂等 key = `thread:<id>`）；
- `threads[i].question` + `possibleOutcomes` → **开放问题**（标记等待玩家回应，进入 agenda 的 `awaiting_reply`）；
- `candidates` 且 `direction.mode='required'` → 必演绎队列（见 `DIRECTOR-OBLIGATORY-BEATS-01.md`）；
- 开场 `current` 消息保持 `initialRead: false`（未读）。
约束：只物化编导真正写过的内容；幂等（同 key 只生成一次）；不新造状态机。

## 验收
1. 新建世界 `appointments`/`facts`/`choices` 至少各 1 条（来自编导内容）；
2. 进入世界后 30 秒内 `selectSpeaker` 可选中至少一人（有合法理由）；
3. 一次 `advance` 产生 ≥1 条 NPC 消息且 `initialRead: false`；
4. 首页出现"有人给你发了 N 条消息"；
5. 测试锁死"编导没写却凭空多出约定"。
