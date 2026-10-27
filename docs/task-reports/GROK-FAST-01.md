# GROK-FAST-01 · NPC grok-4.7 关闭推理

- 日期：2026-10-27
- 范围：仅 NPC 文本模型选择；不改 prompt、上下文、schema、数据库或场景逻辑。

## 改动

`src/server/composition.ts` 的 `npcGatewayConfig` 原先只对 `grok-4.3` 设置
`reasoningEffort: 'none'`，现在同时覆盖 `grok-4.7`。

效果：

- NPC 请求带 `reasoning_effort: none`；
- 导演、基础文本、作者模型保持原配置；
- 不改变模型、输入内容、输出 schema 或业务状态。

## 验证

- `tests/grok-fast-config.test.ts`：NPC 使用 `grok-4.7` 时请求体为 `grok-4.7 + none`，
  导演仍为 `grok-4.7 + undefined`，场景仍按原规则。
- `npm run check`：4139/4139 通过。
- `npm run build`：通过。
- 3218/3219、队列 worker、主动 worker 已用最新构建重启；3218 世界读取 200。

## 真实体验结果

同一世界、同一人物的三次发送（本地克隆、`grok-4.7`、`reasoning_effort: none`）：

| 发送 | 首段事件 | 耗时 |
|---|---|---:|
| 06:32:15 | 06:32:34 | 18.8 秒 |
| 06:32:52 | 06:33:10 | 17.6 秒 |
| 06:33:28 | 06:33:49 | 20.8 秒 |

对比改动前同一世界约 36–39 秒，**首段等待下降约 45–50%**。

剩余约 18–21 秒仍主要是：约 2.5 万 tokens 的上下文、14.6KB 严格输出 schema、
`stream:false` 等完整响应。关闭推理没有、也不可能消掉这部分。

下一步应继续砍上下文和 schema；只靠 reasoning 参数已经到边界。

