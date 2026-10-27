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

## 追加：地点提示带一跳到路线

- 读取 actor 当前权威位置；对每个机会地点给出直达 routeId/分钟，或明确“当前没有直达路线”；位置未知时明确不能直接出发。
- 不新增地点、不替 NPC 选择、不把 route 当成已出发。
- `tests/actor-opportunity-context.test.ts`、`director-wire15-handoff.test.ts`、`director-unified-actor-tasks15.test.ts`：9/9 通过。

## 受控 travel kernel 复核（未全绿）

- `AGENT_TRAVEL_KERNEL_TEST_PORT=55432 tests/integration/agent-travel-kernel.test.ts`：6/8。
- 通过的包括“实际私有 NPC 调用提交 departure、scene exit、in_transit，不移动玩家”及重放/回滚/未知/失败路由。
- 未通过：`authored genesis position ...` 的 action-result evidence 未包含 `self-position:genesis:*`；未修改测试或放宽断言，留待下一轮定位。
- `episode-journey-evidence` 在本地测试库因 director proposal boundary 失败，未作为本轮通过证据。

## 基线复核

- 在独立 worktree `cd94c5d5`（本轮 compact/source 变更前）运行同一 `agent-travel-kernel`，也是 6/8，且同样只有 `authored genesis position` 的 evidence 断言失败。
- 结论：该失败不是本轮 scene presence / compact schema / source 裁剪引入；实际私有 NPC departure 子项在本轮和基线都通过。

## 追加：地点提示到一跳到路线的单测

- 新增测试覆盖：actor 当前在 room、机会涉及 room/park，提示包含公园名称、`room-park` routeId 和 15 分钟；不泄露其他 actor task。
- 结合既有“实际私有 NPC departure 提交 journey/scene exit/in_transit”测试，形成 director 任务 → actor 地点/路线依据 → travel kernel 的受控链路。
- 仍未做一次真实付费 NPC 自主选择 travel 的样本；genesis evidence 基线失败仍保留。
