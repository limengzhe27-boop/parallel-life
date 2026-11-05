# RETURN-BRIEFING-60：回访补演（本地完成）

## 目标

- 用户离开时不后台推进世界。
- 用户打开手机且离开 ≥3 分钟时，做一次有界补演。
- 从真实未了事项中选 1–3 个，经现有 NPC runtime 提交有来源的新消息。
- 消息时间分布在离开区间内，锁屏只展示真实新消息。
- 幂等、失败不造假、无依据可 0 条。

## 实现

- `db/migrations/0133_return_briefing.sql`
  - `world_clock.last_present_at`
  - `world_return_briefings`（唯一 `(world_id,left_at)`，状态机、租约、beat、message_ids）
  - `claim_proactive_worlds` 增加前台活动租约条件，并排除 running briefing。
- `src/modules/world/domain/return-briefing.ts`
  - 3 分钟门槛、24h 现实/72h 故事上限、beat 分布、来源候选排序。
- `src/modules/world/infrastructure/return-briefing-repository.ts`
  - 创建/领取/记录/完成/失败、按 beat 设置时钟、完成后刷新 presence。
- `src/server/return-briefing-services.ts`
  - 先领取 briefing，再逐个 actor 用 `runNpcAgent` + `PostgresNpcAgentKernel` 提交；
  - 首个高优先级事项 quiet 时做一次严格重试；
  - 已在之前的尝试提交过消息则只 settle，不重复购买。
- `src/modules/world/infrastructure/clock-activity-repository.ts`
  - resume 时计算离开窗口并创建 pending briefing；pending 期间冻结时钟，不恢复。
- API：`POST /api/v1/worlds/[id]/return-briefing`（120s 上限）。
- 客户端：resume 收到 `returnBriefing` 后调用补演，补演期间阻塞心跳；完成后 `load()`、更新时钟、锁屏展示新消息。
- 锁屏：真实未读按 `at` 最新排序，一个联系人一张卡，最多 3 张；旧未读不会被当成新反馈。

## 本地证据（2026-11-05）

- 真实模型补演（clone `ff2f6bbf-7650-4546-92fc-284fe60d0067`）：
  - 5 分钟离开窗口 12:17–12:32；
  - 3 位角色分别在 12:21、12:24、12:28 提交消息；
  - 锁屏显示 3 张新卡，时钟 12:50；
  - 截图：`.local/return-briefing-lockscreen.png`。
- 浏览器完整流程：`clock/activity` pending → `return-briefing` 200（19.3s）→ 锁屏 3 条新消息 → “补演”横幅消失。
- 前台门禁（clone）：
  - 无活动租约时 `claim_proactive_worlds` 不返回目标世界；
  - 插入 live browsing 租约后返回目标世界。
- `npm run check`：4281/4281 通过。
- `npm run build`：通过。
- 真实 PG：`RETURN_BRIEFING_TEST_PORT=55432 node --experimental-strip-types --test tests/integration/return-briefing.test.ts` 通过。

## 未完成 / 阻塞

- 用户 2026-11-05 明确选择「先只保留本地」，因此本轮不部署生产。
- 生产迁移 0133 未应用：Vercel 的 `APP_DATABASE_URL` 等数据库密钥在 `vercel env pull` 中是 `[SENSITIVE]`，本地没有可执行 DDL 的生产连接。
- 生产下一步（以后要做时）：在 Supabase/Neon 生产库应用 0133（需 owner 角色），再推送部署并公网实测。
