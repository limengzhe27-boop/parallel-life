# 44-205 文字暂缓后的重复邀约

状态：本地代码与回归完成，待部署后做一次原档真实模型复验。root 唯一集成。

## 真实复现（只读，不改原档）

现有 `渣男体验` world `4953ca0f-56c4-4e92-9279-324031142356`，version `280`，李之之：

- 玩家 `20900b33-00af-4889-a763-15194244f487`，`2026-10-15T15:27:40.306Z`：
  “我在忙，晚点再说。”
- NPC 同轮 `..._seg_0`，`15:28:01.636Z`：“知道你忙，我等你哈~”
- NPC 同轮 `..._seg_1`，`15:28:02.680Z`：“别忘了我让你周末帮我准备美食的事哦，嘿嘿。”

这不是后续自动唤醒，而是同一次回复里的第二条 statement 继续追问旧邀约。此前纯表情路径已在 v66 修过，文字路径未覆盖。

## 修复

只使用既有 `stickerId`、`message.received`、state、decision、responsibility 和调度候选，不新增字段/表/迁移/模型调用。

1. `npc-agent-model.ts` prompt `npc-agent-v68-defer-boundary`：
   - 玩家明确说忙、晚点、想休息或暂时不想谈时，先接受边界。
   - 若已有对应责任，改为 `deferred`，保留原来源并追加本轮来源。
   - 本轮和之后的自动唤醒不再提同一邀约、计划或问题，直到玩家主动重提。
2. `agent-schedule-collectors.ts`：
   - 已持久化的玩家 `deferred` decision 会阻止同一责任、同一 appointment 和绑定该 action 的 plan 再被 code-timed 源唤醒。
   - appointment 对应责任已是 `deferred/withdrawn/fulfilled/expired` 时也不再重复提醒。
   - 只读既有状态，不做关键词匹配，不增加统一冷却。
   - `declined` 不被当作 `deferred`：拒绝仍可让本人重新考虑自己的下一步，保留原语义。

## 验证

- `tests/agent-schedule-collectors.test.ts` 49/49；新增：
  - deferred 状态或 deferred decision 抑制同一 confirmed appointment；
  - deferred 状态或 decision 抑制绑定责任的 ready plan。
- `tests/npc-agent-model.test.ts` 通过；prompt version 与 defer 句子有断言。
- `npm run check` **3992/3992**。
- 无新增迁移、无生产写、本报告阶段未调用真实模型。

## 仍未完成

- 部署后需在 `县城黄毛` 测试世界用真实模型说一次“我在忙，晚点再说”，确认不再出现同轮旧邀约追问。
- 历史中已经发生的错误消息不手工删除或改写；本修复只阻止后续重复。
- 未用关键词硬拦所有“忙/晚点”，因此模型若完全不遵守 v68 仍可能复现；以真实模型结果为准。
