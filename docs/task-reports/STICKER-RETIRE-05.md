# STICKER-RETIRE-05

2026-10-27，分支 `codex/sticker-retire-05`。用户明确要求旧文字/微笑表情直接删除、历史消息可以替换。

## 完成

- 删除 `public/stickers/*.svg` 20 个旧文字/微笑资产；保留 60 个 `candidates/*.webp` 新图。
- `SELECTABLE_STICKERS` 已只含 60 个新图；NPC、群聊规划器、手机选择器不再提供旧表情。
- 新增 `db/migrations/0120_retire_text_stickers.sql`：
  - 旧 ID 的纯表情消息：`text` 改为原标签（如“加油”“晚安”），删除 `stickerId`。
  - 已有文字的消息：保留文字，只删除 `stickerId`。
  - 同步 `world_messages`、`world_group_messages`、`worlds.state.messages`、`world_initial_snapshots.state.messages`。
  - `world_events` 保持不可变；`STICKER_IDS` 仍含旧 ID，仅用于历史事件解析，模型/UI 不提供。
- 本地 clone 实测：迁移前 5,835 条旧 sticker 消息，迁移后旧 ID 0 条；剩余 460 条为 `selected_*`/`screenshot_*` 新图。
- 测试库函数验证：纯旧表情 → 文字标签；文字+旧表情 → 保留文字；新表情不受影响。
- 定向测试 73/73 通过。

## 未做/边界

- `STICKER_CATALOG` 仍保留旧 ID 的 label/description 元数据，供不可变事件回放解析；资产、可选目录和模型上下文已移除。
- 未部署、未重启本地服务。
