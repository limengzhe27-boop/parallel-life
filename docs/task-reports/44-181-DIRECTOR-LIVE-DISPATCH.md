# 44-181 真实导演派发到 NPC 主动消息

日期：2026-10-23。生产域名 `https://parallel-world-eosin.vercel.app`，业务代码
`8f625c5c`。本轮使用隔离 guest 世界，不写用户原档。

## 验收世界

- 作品：`渣男体验` `50faae30-fb8a-4ade-b757-cd588ae46a4d` v1；
- 世界：`e1642bb2-f6b7-4730-8de1-491e310daf04`，guest owner；
- 该世界从零创建，没有旧 `unknown_after_send` / stale attempt 围栏；
- 玩家先给青青发一条真实消息（version 7），制造新的私聊证据。

## 真实导演链

1. 调用 owner 显式 `/director/review`。
2. 导演 attempt `6dd20c43-6b28-4fbc-b209-77ed9c73944b` 真实 committed。
3. 决策模式为 `bounded_opportunity`，不再 quiet：
   - opportunity `director-opportunity:4a3f69ce44dc17ee32d46e1a9175c32d2c5ab2a21218ad1a1fec755dd4da6e2e`
   - 作者事件 `event_28910809fd5d1f8b`（开场六线）
   - 六个 actor 各有一条 `future_task`，不是手种台词。
4. 六个 `agent_episode_requests` 被创建；其中刘胜男的请求
   `episode_request:3a8b4b05...` 被消费。
5. 演员真实调用后提交 `turn.resolved` v8：

```text
origin: director
actor: 刘胜男（612b2559-606a-483a-8875-c64eda902d97）
message: 今晚我安排了出差，你打算跟我一起走还是留在这儿？说说你的想法吧。
messageId: f3fa2ac4-202b-44c1-a52c-99bbe87c59a4
```

6. 公网 world API 读取 version 8，消息存在，角色为 assistant，时间来自故事
   时钟；不是客户端拼出的假消息。

## 边界

- 这次没有逐条催完六个人；导演把六个入口都排成可拒绝的参与机会，实际只消费
  了刘胜男一条。其余五个请求仍 pending，这是合法的部分完成，不是全量成功。
- 旧的 `渣男体验副本` 仍有历史 `unknown_after_send` / stale actor projection；
  它不属于这个干净验收世界。旧档的 immutable 恢复继续归 44-161，不在本行
  冒充已修复。
- 本次没有真实用户档写入，没有手工插入消息，没有绕过 kernel/重试 unknown。

## 结论

44-181 的“真实导演派发 → NPC 主动消息”链路已在干净 `渣男体验` 世界打通并验收。
旧档 stale/unknown 兼容是独立兼容问题，不改变本行的范围结论。
