# MEM-08 真实数据库、模型、生产部署与闭环验收

状态：[x] 已完成。负责人：主集成人。工作目录：主登记目录。

## 已完成

- 生产环境 Vercel 部署成功：`https://parallel-life-nu.vercel.app`。
- 解决 Linux 运行期跨平台编译问题：为 `package.json` 添加 `@img/sharp-linux-arm64` 与 `@img/sharp-linux-x64` 可选依赖，修正 `.vercelignore` 保持环境文件隔离同时不影响构建清单。
- 东京同机房低延迟闭环：
  - Vercel 区域：`hnd1`（东京羽田）
  - Supabase 区域：`ap-northeast-1`（东京）
  - 模型：`deepseek-flash`（流式输出延迟 4.5~5.7 秒）
- 全链路端到端线上实测：
  1. `GET /api/health`：返回 HTTP 200 OK。
  2. `POST /api/v1/session`：成功颁发安全 Cookie 与 CSRF 令牌。
  3. `GET /api/v1/interview`：成功拉取会话工作区与现实档案。
  4. `POST /api/v1/interview/messages`：流式打字对话成功，生成候选事实 `suggested`，不越级写入 Profile。
  5. `POST /api/v1/memory/candidates` (action: confirm)：对候选事实进行显式确认，经验类原子写入 `profile.events`，愿望/兴趣类原子写入 `profile.facts`，版本原子递增。
  6. 重复确认/驳回幂等性与来源回执均验证通过。

## 验证证据

- `npm run check:boundaries`：134 个源文件架构边界通过。
- `npm run typecheck`：0 错误。
- `npm test`：81/81 单元测试通过。
- `npm run test:db`：14/14 项真实 PostgreSQL 数据库测试通过。
- 线上接口实测：真实会话、AI 流式响应、候选生成、用户二次确认全流程通过。
