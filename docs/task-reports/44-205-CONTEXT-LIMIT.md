# 44-205 长档上下文二次修复

状态：本地修复与回归完成，待第二次部署后真实复验。root 2026-10-24。

## 新反例

部署 `58590b8f` 后，在 `县城黄毛` world `5f296b6e-805e-4923-b888-9f0d47de6108` 向林悦发送：

> 你发个表情给我吧，我想看看你现在什么心情。

真实请求 `command f737c873-8ba8-46c8-915d-280c649b1636` 返回 422 `INVALID_STATE`，receipt 为 `failed`。运行时日志：

```json
{"scope":"npc-agent-preflight","code":"NPC_AGENT_SNAPSHOT_LIMIT",
 "contextSizes":{"state":18625,"sources":8922,"observations":587,
 "conversationProgress":4,"stickerCatalog":669,"responseContract":600,"input":119,
 "worldContext":872,"actor":418,"channel":421,"contextSelection":1434}}
```

总尺寸约 33.7k，超过 `NPC_AGENT_PAYLOAD_LIMIT=32_000`。此前的 questions 裁剪、observations 裁剪和 schema 上限提高只解决 44-205 的李之之样本，未覆盖另一个长档人物。

## 修复

在既有 `prepare` 预算降级链末端，增加“终态历史压缩”，仍复用原 state 对象，不新增字段/表/模型调用：

- 删除终态 goals（fulfilled/withdrawn），保留仍被 active plan 引用的 goal。
- 只保留 active/waiting/blocked plans。
- 删除终态 actions（succeeded/failed/withdrawn），但保留 active plan 的 actionIds/nextActionId 引用。
- 删除终态 responsibilities（fulfilled/withdrawn/expired）。
- decisions 只保留仍存续责任，且最多 8 条。
- questions、observations、episodeFollowUps、recentSelfMessages、stickerCatalog 的既有裁剪顺序不变。
- 若单条 active 目标/当前输入本身超预算，仍在 preflight 明确失败，不做静默截断。

## 验证

- 新增 `tests/npc-agent-model.test.ts`：120 组长终态历史触发预算后，只保留 active g1/p1/r1，旧 goals/plans/actions/responsibilities/decisions 全部不进入 payload，调用成功。
- `tests/npc-agent-model.test.ts` 49/49；`npm run typecheck` 通过。
- 无迁移、无生产写、本报告阶段无真实模型调用。

## 仍未完成

- 需要第二次部署后，用同一林悦命令重试一次，确认 contextSizes 降到 32k 以下并得到正常回复。
- 该压缩只处理终态历史；如果 active state 本身继续膨胀，仍会明确失败，需要后续做长期容量设计，不能用无限截断掩盖。
