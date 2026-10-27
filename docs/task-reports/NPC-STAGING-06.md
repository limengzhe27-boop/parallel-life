# NPC-STAGING-06

2026-10-27，分支 `codex/sticker-retire-05` 追加导演地点提示。

## 内容

- 导演 opportunity 的 `placeIds` 以“这次机会涉及的地点：名称（id）”附在 actor 自己的 opportunity 文本后。
- 只使用导演已经校验过的 `placeIds`；不新增地点、不替 NPC 决定前往、不声称到达。
- 明确提示：决定前往只能沿已有路线提 `travel.begin`，出发不等于到场。
- 不向 actor 提供其他参与者的任务或全局描述。

## 验证

- `tests/actor-opportunity-context.test.ts`、`director-wire15-handoff.test.ts`、`director-unified-actor-tasks15.test.ts`：9/9 通过。
- 这一批未新增模型调用、未改 schema/kernel、未部署。

## 边界

- 目前只是给 NPC 地点依据；真正“导演指定地点 → NPC 自主 travel → 到场”仍需要 actor 的路线与后续 arrival 链路验证。
