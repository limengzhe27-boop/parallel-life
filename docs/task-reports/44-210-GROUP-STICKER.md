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
2. NPC 群内主动发表情仍是后续能力；当前人物群回复只发文字。
3. 群通知/锁屏摘要仍以文本为主；本轮只改聊天列表预览。
4. 群消息仍受原 `text` 1–4000 字符约束；marker 很短，不影响原发送长度。
5. 需部署后才可对公网群聊验收；本轮按用户要求不推送、不部署。

## 与 44-205 阻塞的关系

本改动不依赖 `44-205-DIRECTOR-CONTEXT` 的 `COMMAND_CONFLICT` 诊断，也不触碰真实用户档。它是独立的
本地群聊 UI/上下文改动，可在下一次部署窗口一起带上，或单独回退，不影响私聊表情链。
