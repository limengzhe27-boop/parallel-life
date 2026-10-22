# 44-193 服务端主动推进（pg_cron / 租约 / 单角色）

## 结论

页面关闭时的服务端主动推进已真实接通。浏览器页面不是调度器的一部分；生产库的
`pg_cron` 每 30 分钟调用一次，`pg_net` 请求应用路由，Vercel 路由再用应用数据库
认领世界并执行一次单角色主动推进。

不是“每分钟模型循环”：数据库函数限制每天最多 6 次世界推进、每个世界至少
4 小时间隔、每次租约 10 分钟，并在存在未完成/未知 attempt 时跳过该世界。

## 链路

```text
Supabase pg_cron (every 30 min)
  -> pg_net.http_get
  -> POST-equivalent GET /api/cron/proactive
  -> app DB claim_proactive_worlds(1, 4h, 10m)
  -> proactiveAdvance.advanceIfEnabled (maxActors=1, maxCalls=2)
  -> committed world messages, no browser required
```

鉴权使用数据库内只保存 SHA-256 的定时令牌；Vercel 侧不新增环境变量。GitHub
Actions/OIDC 入口保留为备用，但当前 GitHub Actions 账户持续排队，不作为本次证据。

## 真实证据

- 2026-10-22T16:39Z：手工触发服务端 tick，`claimed=2, advanced=1, messages=3,
  failed=1`；失败世界为既有 director `invalid_output`，调度器隔离失败并继续。
- 2026-10-22T16:40Z：`pg_cron` 计划任务真实发起请求，返回同样结构；
  认领的 6 个世界分布在 6 个不同 owner/world，没有重复占用。
- 2026-10-22T16:44Z：新一次 tick `claimed=1, advanced=1, messages=2, failed=0`。
- 2026-10-22T16:45Z：冷却生效，返回 `claimed=0`；说明不是重复推进同一世界。
- 2026-10-22T16:45Z 浏览器 TaskSpace 已不存在；在此前后被推进的是其他世界，
  没有对应页面打开。`pg_cron` 运行记录 `status=succeeded`，`pg_net` 响应 200。
- 2026-10-22T16:55Z：20 回合人感抽样中，3 条纯表情包、14/15 成功回合为多气泡；
  期间一次上游 `unknown_after_send`（无 response/event）导致后续发送被保护挡住，
  未伪装成成功。

## 质量修正

首批自动推进暴露了“没什么新事，先这样”等等待式废话。已增加：

- `proactive-quality.ts`：服务端丢弃无具体由头的主动等待/汇报句，保留具体观察、
  计划、问题和 sticker；
- 主动批次改为 `maxActors=1`，避免一次 tick 多人同时来信；
- 每日 6 次、每世界 4 小时冷却的硬预算。

质量闸门在 `24466288` 已上线并扩展：除无由头等待句外，`暂时没有新的想法/还是先观察/整理好了心情/准备继续关注` 等空计划句也过滤；部署后再次进入世界时版本156未新增这批空计划句；这只是一次未新增样本，不把它当成过滤全覆盖。当日 6 次预算已用完，定时 tick 的质量样本待 UTC 重置后观察。

## 尚未完成

- 上游 `unknown_after_send` 的恢复仍需要用户核对；没有 response 时不能自动重买，
  本次一次 unknown 真实阻断了会话 5 次。
- 多角色主动节奏、长期无人回应后的分支质量仍归 44-186/44-162，不由本任务代为宣称。
- `pg_cron` 依赖 Supabase 扩展已安装；生产迁移 0105、0106、0107、0108 已逐条记录到
  `public.pl_migrations`，后续部署不会重复应用。
