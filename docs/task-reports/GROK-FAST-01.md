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

## 待真实体验

关闭推理是否明显降低首段等待、人物语气是否仍可接受，需要用同一段真实 NPC 上下文
做 A/B；当前只验证参数确实下发，不宣称 36 秒已经消失。
