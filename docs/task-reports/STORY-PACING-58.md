# STORY-PACING-58 · NPC 主动频率与离开自动暂停

状态：已完成（本地）
负责人：dsh-story55-20261105
日期：2026-11-05

## 1. 调整

### 主动频率

- own-agenda：故事时间 1 分钟、真实时间 3 分钟起，安静连击仍按 ×2 退避，封顶 15 分钟。
- 导演全局复盘：committed 后 10 分钟；已知失败重试仍 15 秒。
- proactive worker：轮询 15 秒，单世界冷却从 60 秒提高到 180 秒，每轮最多 2 个世界。
- 这些只是“最早可考虑”的边界，没有新依据仍保持安静，不是到点必发。

### 离开自动暂停

- 页面隐藏 10 分钟后，前端发送 `mode=away,idle=true`。
- 服务端只在没有其他可见标签页时设置 `paused=true,pause_reason='idle'`，停止后续主动运转。
- 用户回来时 `resume=true` 自动清除 idle 暂停，不会把离开期间补算成故事时间。
- 返回后显示摘要条：“你离开了一段时间，回来看看期间的新消息。”；锁屏/微信未读消息继续作为具体反馈。

迁移：`db/migrations/0131_idle_world_pause.sql` 增加 `pause_reason='idle'`。

## 2. 验证

- API 实测（世界 `243e612a-6d6c-4b23-89a4-c62eea14294b`）：
  - away+idle：`paused=true`、`pauseReason=idle`、`summary=你离开了一段时间…`
  - resume：`paused=false`、`pauseReason=null`、`speed=3`，摘要保留给前端展示
- `npm run check`：4276/4276
- `npm run build`：通过
- 本地 3218 health 200；0131 已应用到 clone/test/dev

## 3. 边界

- 当前覆盖“切到其他页面/标签隐藏”10 分钟；完全关闭标签页时前端定时器不会执行，尚未加服务端兜底。
- 主动消息仍需满足来源、预算和安静/拒绝判断；本批不改变业务内容生成规则。
