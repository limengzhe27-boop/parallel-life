# Supabase 接入步骤

当前项目保留 PostgreSQL 仓储和 RLS 角色模型，Supabase 只替换托管数据库与私有对象存储。不要把 Service Role Key 放进浏览器变量，也不要复用探索原型项目的数据。

## 一次性准备

在 Supabase 免费项目中取得以下三项：

- Project URL，例如 `https://<project-ref>.supabase.co`
- `secret` API key（只保存到服务端；旧控制台也可能显示为 `service_role`）
- 直连 PostgreSQL 的连接串（Database Settings → Connect，优先 Direct connection；不要使用匿名客户端连接串）

在项目根目录创建被忽略的 `.local/supabase.env`：

```dotenv
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SECRET_KEY=<secret-key>
SUPABASE_DB_URL=postgresql://postgres:<db-password>@<db-host>:5432/postgres?sslmode=require
SUPABASE_STORAGE_BUCKET=private-assets
APP_ORIGIN=https://parallel-life-nu.vercel.app
```

可选地提供 `SUPABASE_APP_DB_URL` 和 `SUPABASE_WORKER_DB_URL`。如果不提供，脚本会在同一数据库主机上创建并使用 `pl_app`、`pl_worker` 受限角色；Vercel/Railway 使用连接池时，应按 Supabase Connect 页面规则填写这两个变量。

## 初始化

运行：

```bash
node .local/setup-supabase.mjs
```

脚本会创建 `pl_app`/`pl_worker`（均为 `NOBYPASSRLS`）、执行全部数据库迁移，并确保 `private-assets` 是私有桶且只接受 WebP。它会把 Web/Worker 的运行时变量写入 `.local/supabase-runtime.env`，文件权限为 `0600`，不会提交 Git。若控制台仍提供旧的 `service_role`，脚本也兼容 `SUPABASE_SERVICE_ROLE_KEY`。

可先验证两个受限角色：

```bash
node .local/verify-supabase.mjs
```

## Vercel 配置

把 `.local/supabase-runtime.env` 中的变量分别写入 Vercel Production 环境，并将 `APP_PREVIEW_ONLY` 设为 `0`。`YIBU_API_KEY`、`YIBU_BASE_URL`、`YIBU_TEXT_MODEL` 也必须只作为服务端变量配置。访谈短回合走 SSE，不需要常驻 Worker；世界创建和批量生图仍需要独立 Worker 进程，不能假设 Vercel 函数会常驻。

如果 Vercel CLI 已登录，可以在项目根目录运行：

```bash
node .local/configure-vercel.mjs
vercel --prod --yes --force
```

脚本会从 `.local/supabase-runtime.env` 读取数据库和 Storage 配置，从 `.env.local` 或当前 shell 读取 Yibu 网关变量，并逐项写入当前已关联的 `parallel-life` 项目；值不会打印到终端。若 `.env.local` 中的 `YIBU_API_KEY` 是 `[SENSITIVE]` 占位符，请先在当前终端执行 `export YIBU_API_KEY='你的网关密钥'` 后再运行脚本。
