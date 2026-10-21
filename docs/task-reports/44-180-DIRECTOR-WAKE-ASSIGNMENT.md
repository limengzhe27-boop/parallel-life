# 44-180 导演独立唤醒与任务派发：第一阶段

## 本轮完成

- 复用现有 `director_runtime_attempts` 账本作为导演复查 cadence，无需新迁移。
- 新增 `director-review.ts` / `director-review-repository.ts`。
- `npcAgentAdvanceServices`：
  - 有 actor candidate 时保持原逻辑；
  - 零 candidate、无 retry、无 handled actor 且 director due 时调用导演；
  - director quiet 也写下一小时复查；
  - 不伪造消息、不强制事件。
- 新增真实 PG `director-wake180`：
  - 零 candidate 世界调用导演一次；
  - actor model 零调用；
  - 复用 `director_runtime_attempts` durable row 作为 cadence；
  - immediate advance 不重复导演调用。
- 新增 pure test `director-review`：due 边界、retry/handled/selected 阻断。

## 验证

- `director-wake180` 真实 PG：1/1
- `director-review`：2/2
- 全量 check：3889/3889
- build：通过

## 生产部署与实机

- 代码提交：`d28659db`；docs `1da4cb98`
- Production READY：`dpl_HiwKFdgBfqfb5R2BfKXX2pECsZp4` / `https://parallel-life-7702cft3f-limengzhe27-boops-projects.vercel.app` @ `1da4cb98`
- 正式 Nu health：200
- 现有渣男体验 entry 实际仍多次返回 `work: []`/`played:0`，没有观察到导演或 NPC 新消息。
- 目前无法读取该世界最近一次 director attempt 的时间；因此不能判断是 cadence 未到期、尚无 eligible event，还是其他 quiet 保护。不能把这次结果算作导演派事件通过。

## 未完成/下一步

- 本轮只验证零候选导演被调用/quiet + cadence 去重，还没有证明导演从作者事件库成功派发一次事件。
- 尚未在现有渣男体验世界验证导演选作者事件 → NPC 自主参与 → 锁屏新消息。
- 下一步接入/验证 authored event/opportunity → actor scoped task；保持导演不写 NPC 最终台词。
- 生产部署与真实世界复测待本提交完成后执行。
