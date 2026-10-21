# 44-180 导演独立唤醒与任务派发：第一阶段

## 本轮完成

- 新增 `0105_agent_director_reviews.sql`：
  - 持久 `next_review_at/last_reviewed_at/review_count`；
  - RLS owner 隔离。
- 新增 `director-review.ts` / `director-review-repository.ts`。
- `npcAgentAdvanceServices`：
  - 有 actor candidate 时保持原逻辑；
  - 零 candidate、无 retry、无 handled actor 且 director due 时调用导演；
  - director quiet 也写下一小时复查；
  - 不伪造消息、不强制事件。
- 新增真实 PG `director-wake180`：
  - 零 candidate 世界调用导演一次；
  - actor model 零调用；
  - `agent_director_reviews` row 存在；
  - immediate advance 不重复导演调用。
- 新增 pure test `director-review`：due 边界、retry/handled/selected 阻断。

## 验证

- `director-wake180` 真实 PG：1/1
- `director-review`：2/2
- 全量 check：3889/3889
- build：通过

## 未完成/阻断

- `0105` 尚未应用到**真正线上应用数据库**。此前可用的 `DATABASE_URL_UNPOOLED` 指向的库查询到 0 worlds/agent data，和正式 Nu 现有世界不一致，因此不能确认它是线上应用库。
- 代码未推送到生产 main；当前 Production 仍是 `840aa236`。
- 尚未在现有渣男体验世界验证“导演选作者事件 → NPC 自主参与 → 锁屏新消息”。
- 现有渣男体验此前 entry receipt 为 `work: []`；需要真实库和 0105 后再复测。

## 下一步

1. 确认线上实际数据库连接；
2. 应用 0105；
3. 推送 director wake 代码并部署；
4. 真实渣男体验验证零候选导演调用；
5. 再接入 authored event/opportunity 与 actor scoped task。
