# 44-210 群聊玩家表情包

状态：本地代码、类型和聚焦测试通过；未部署、未做真实模型/手机旅程，不能算线上完成。

## 范围与取舍

- 复用现有群消息 `text` 字段保存 `[[sticker:id]]`，不新增 `stickerId` 字段、表、迁移或 API 参数。
- 群聊输入栏增加表情面板，选图后作为**独立群消息**发送；用户已输入的文字草稿保留，不在同一条消息里拼接。
- 消息、待核对消息和群列表预览都识别 marker，显示图片或 `[标签]`，不再暴露原始 `[[sticker:...]]`。
- 发送给 NPC 的群历史在 `planGroupTurn` 边界把 marker 转成 `[表情：标签；语义]`，因此人物收到的是
  可理解的语义，而不是机械 ID。仍复用原来的一次群模型调用，不增加第二次模型。
- 没有增加 NPC 在群聊里主动发图片表情的能力；本轮只解决“用户可发、人物能理解、界面能显示”。

## 文件

- `src/features/phone/groups/group-chat.tsx`
- `src/features/phone/groups/state.ts`
- `src/features/phone/groups/groups.module.css`
- `src/modules/world/application/group-turn.ts`
- `tests/group-sticker.test.ts`

## 验证

- `node --experimental-strip-types --test tests/group-sticker.test.ts tests/group-planner.test.ts tests/group-ui-state.test.ts`
  → **12/12**，包含：
  - marker 在存储中保持文本，UI 解析为 `zan` 图片，预览为 `我：[赞]`；
  - 群模型收到 `[表情：赞；欣赏、称赞]`，看不到 `[[sticker:`；
  - 原群历史、公共事实、私聊隔离、speaker 选择、重试/幂等测试不回归。
- `npm run typecheck` 通过。
- `npm run check` **3997/3997**；`npm run build` 通过（31/31 页面）。
- 未调用商业模型、未写生产世界、未新增 SQL。

## 未完成/边界

1. 群聊只看本地代码和纯测试；尚未在本机真实手机/PC 群聊旅程中点击发送并刷新核对。
2. NPC 群内主动发表情已在 2026-10-25 补上代码与纯测试，但尚未用真实模型/公网群聊验收。
3. 群通知/锁屏摘要仍以文本为主；本轮只改聊天列表预览。
4. 群消息仍受原 `text` 1–4000 字符约束；marker 很短，不影响原发送长度。
5. 需部署后才可对公网群聊验收；本轮按用户要求先本地完成，再最小批次部署。

## 2026-10-25 · NPC 群内主动表情

在不新增数据库字段/表/迁移的前提下，`GroupReply` 增加仅运行时使用的可选
`stickerId`；群模型返回 `text` + `stickerId` 时，领域 reducer 拆成“文字消息”
和“独立表情 marker 消息”两条，若纯表情则 `text` 可为空。`stickerMessageId` 由
运行时分配，保证两条消息 ID 不同；未知 sticker ID、空内容、纯表情带邀约均拒绝。
群模型 payload 增加静态 `stickerCatalog`（id/label/description），提示词只允许
从目录选择，并明确安慰/道歉等语境不要发不合时宜的图。群历史仍用
`stickerMessageMeaning` 把 marker 转成语义，模型看不到原始 `[[sticker:...]]`。
没有新增持久字段、SQL 或第二次模型调用。

验证：`tests/group-sticker.test.ts` 5/5（玩家 marker、NPC 文字+表情两条、纯表情、
未知 ID 拒绝、planner 目录/校验）；`tests/group-planner.test.ts` 与
`tests/group-ui-state.test.ts` 同跑 15/15；`npm run check` 4005/4005；
`npm run typecheck`、`npm run build` 通过。尚未调用真实群模型，不能据此宣称
公网 NPC 群表情已验收。

## 与 44-205 阻塞的关系

本改动不依赖 `44-205-DIRECTOR-CONTEXT` 的 `COMMAND_CONFLICT` 诊断，也不触碰真实用户档。它是独立的
本地群聊 UI/上下文改动，可在下一次部署窗口一起带上，或单独回退，不影响私聊表情链。

### 2026-10-25 · 部署

代码 `45324ce4` 已推送，Production `dpl_HnrwvuohStdf4wTHykMwCj2fRNJc` READY，
新账号正式别名 `parallel-world-eosin.vercel.app` health 200。线上已包含玩家群表情、
NPC 语义上下文、可选 NPC 主动表情与 `group-v2-sticker`。仍未做真实手机/PC 群聊
旅程，也未调用真实群模型；因此只算部署完成，不算产品体验验收。

## 2026-10-25 · 本地真实链路复验：发现并修复 4 个阻断

此前只有单元测试与类型检查，群聊 NPC 表情从未经过真实 HTTP/DB/浏览器。本轮用本地
`parallel_life_dev` + 真实 Next 服务 + 真实 worker + 确定性网关桩
（`.local/stub-fetch.mjs` 只把 `https://yibuapi.com` 重写到本地桩，不改业务代码），
以官方人生 `county-yellow-hair` 建立世界 `dbbf79e4-e51c-434e-a8bc-911a6a3ca700`、
群 `148db397-c93b-4269-9e35-0f906b173243`，从 390×844 锁屏进入微信→群聊→表情面板
真实点击发送。桩不是真实模型，只用于验证协议/DB/UI；不冒充模型质量验收。

第一次发送就暴露了 4 个真实缺陷，全部在本地复现并修复：

1. **立即执行器把群任务当成 NPC 任务**：`runGroupOwnedTask` 的 `world` handler 先调用
   `nativeNpcTaskHandler`，epoch≥2 世界返回 true 并走导演协议，群回合根本没到群 planner，
   任务以 `INVALID_DIRECTOR_PROPOSAL`/`AI_FAILED` 失败。改为该入口只调用
   `groupTaskHandler`（任务已在该函数里校验 `input.channel==='group'`）。
2. **DB 触发器拒绝表情投影**：0038 的 `group_projection_guard` 只匹配
   `reply.text = message.text AND reply.messageId = message.id`。表情消息文本是
   `[[sticker:id]]`、id 是 `stickerMessageId`，因此任何 NPC 表情/纯表情都抛
   `INVALID_GROUP_MESSAGE_AUTHOR`。新增 `0113_group_sticker_message_author.sql`
   仅替换该函数：在原作者分支之外允许
   `text='[[sticker:'||stickerId||']]' AND coalesce(stickerMessageId,messageId)=message.id`；
   不新增表/字段/权限，玩家分支保持原样。
3. **epoch-2 世界围栏**：群回复事务更新 `worlds` 时没有声明
   `app.agent_world_id/app.agent_engine_epoch`，抛 `ENGINE_EPOCH_CONFLICT`；而 leased
   worker 又不能直接读 `agent_runtime_worlds`（42501）。新增
   `0114_runtime_engine_epoch.sql`：`SECURITY DEFINER` 只返回单个世界的整数 epoch，
   授权 `pl_app,pl_worker` 执行；`group-task-handler` 在 lease 校验并复核版本后设置同一
   事务配置，再写投影。与玩家群发送的授权路径一致。
4. **文字/表情顺序不确定**：`loadGroup` 只按 `source_version,id` 排序，同一事件的文字与
   表情 id 都是随机 UUID，顺序可能颠倒。改为同一版本内非表情消息优先
   （`left(text,10)='[[sticker:'` 升序），再按 id；仍然没有新增列。

修复后同一页面真实点击验证：

- 纯表情回合：world v13 `group.turn_resolved`，reply `text:'' / stickerId:wole`；
  投影一行 `[[sticker:wole]]`，UI 显示图片 `alt=我裂开了`，无文字泡。
- 文字+表情回合：reply `text:'我看了下，周六下午可以。' / stickerId:xswl`；
  投影两行且顺序为文字在前、`[[sticker:xswl]]` 在后；UI 两个独立气泡（文字 + 图片）。
- 玩家侧仍走既有 `[[sticker:id]]` 单条消息，列表预览和待核对状态不变。

回归：新增 `tests/integration/group-sticker-npc.test.ts`（真实 PG）：epoch-2 下不带
声明必须 `23514/ENGINE_EPOCH_CONFLICT`；声明后文字+表情+纯表情三条消息落库且顺序正确。
`npm run check` **4005/4005**、typecheck 通过。

限制：桩模型不是真实群模型，不能据此宣称 NPC 表情语义质量通过；0113/0114 只应用到本地
测试库，生产尚未迁移、代码尚未推送部署；真机/PC 真实模型验收仍待供应商额度恢复。
