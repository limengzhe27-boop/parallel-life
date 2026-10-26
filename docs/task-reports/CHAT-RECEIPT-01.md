# CHAT-RECEIPT-01 · 发送确认与回执恢复收紧

- 日期：2026-10-26
- 状态：本地完成，待部署
- 范围：只改发送确认链路；不新增字段、表、事件类型；不改 advance 调度。

## 改了什么

1. **去掉同文本兜底**
   - `world-phone-app.tsx` 发送异常后不再最多 6 次读取整个世界、按 actor+text 猜测消息是否落库。
   - 只认原 `commandId` 的回执；未确认时登记到现有 `restoredSends`，由已有 5 秒退避、最多 12 次的对账循环继续核对。
   - 回执明确 `failed` 时标失败并删除原命令；明确 `committed` 时按原回执合并。

2. **提交后尽早结束等待**
   - `world-message-http.ts` 流式路径复用已经流出的分段消息和事件，不再提交后重新读整个世界投影。
   - 保留一次 `readStreamSegments` 读取，用于权威的 partial/complete 汇总；不把 `complete` 当作“整轮回复完成”。
   - `complete` 直接触发客户端结束等待。

3. **客户端收到 complete 即结束**
   - `client.ts` 收到 `complete` 后不再等 socket 关闭，取消剩余读取并返回回执。
   - 分段仍按消息 ID 合并；`streamSummary` 继续驱动 partial 标注。

## 验证

- `npm run check`：4023/4023 通过。
- `npm run build`：通过。
- 定向测试：`world-client-timeouts`、`restored-send-receipts`、`chat-send-error`、`chat-append-receipt-projection`、`chat-latency-stage1/2` 全部通过。
- 新增测试：`complete` 事件到达后即使流不关闭，发送也立即结束。

## 未做

- 不加锁、不放开发送与 advance 并发。
- 不自动重发、不自动重试付费模型。
- 没有新增数据库迁移。
- 生产 Supabase 未迁移 `0115`（另一并行改动），本批代码不依赖该迁移。

## 待部署

- Vercel/Supabase 环境恢复后部署；部署后需用真实发送验证：提交后断线、partial、连续相同文字、晚到回执。
