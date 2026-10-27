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

## 追加真实链路验证

- `AGENT_JOURNEY_TEST_PORT=55432 node --experimental-strip-types --test tests/integration/agent-journey.test.ts`：19/19 通过，覆盖真实 departure → in_transit → arrival、并发/暂停/错误来源/重放。
- `actor-initial-position-awareness.test.ts`：6/6 通过，覆盖 version 0 权威位置、到达后覆盖、旧档不重放。
- 这两组使用 `parallel_life_test` 真实 PG，0 付费模型调用。
