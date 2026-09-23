# 小安接手单：后端验收与上线准备

更新时间：2026-09-23

## 当前状态

- 访谈消息、档案候选资料、来源消息校验、问题版本绑定、跳过/主题屏蔽已经写入当前工作树。
- 候选资料确认时才会原子写回真实 Profile；访谈 Handler 不再直接写正式事件。
- 分支记忆已接入第一道确认：用户明确同意后，分支记忆才会生成 `suggested` 候选，之后仍需在“我的”中确认。
- 手机 UI 已包含锁屏、通知、微信/消息、日历、相册、便签和返回分支入口；上传照片的持久化 API 已接入代码。
- `npm run check`、`npm run build`、`npm run format:check` 已通过；真实 PostgreSQL 集成测试目前因本机 `127.0.0.1:55432` 返回 `EPERM` 无法运行。
- Vercel 当前没有成功发布新版本：CLI 返回 `fetch failed`。现有线上地址仍是旧的 UI 预览，不能当作完整产品环境。

## 请小安优先处理

1. 读取 `AGENTS.md`、`docs/DEVELOPMENT.md`、`docs/MEMORY_INTEGRATION_PLAN.md`、`docs/task-reports/MEM-02.md`、`docs/task-reports/MEM-03.md`。
2. 检查并准备 0009–0016 迁移在 Neon/PostgreSQL 的真实验收：顺序、RLS、复合来源约束、回执类型、重启恢复、跨用户隔离。
3. 对 `MemoryCandidateRepository.createFromBranch` 做代码审查，确认第一道同意与“我的”第二道确认之间没有越权写回；补来源角色/归属校验（如数据库模型需要）。
4. 补 MEM-06/MEM-08 的真实数据库集成测试，无法连接时记录阻塞，不伪造通过。
5. 验证独立环境变量方案：`APP_DATABASE_URL`、`WORKER_DATABASE_URL`、`BLOB_READ_WRITE_TOKEN`、`BLOB_STORE_ID`、`YIBU_API_KEY`、`APP_PREVIEW_ONLY`；不要使用探索原型项目的数据。
6. 更新 `docs/DEVELOPMENT.md` 与对应 task report。MEM-02、MEM-03、MEM-06 在真实数据库验收前保持“待验收/进行中”。

## 不要做的事

- 不重复改 `src/app/outer-ui.css`、`src/features/interview`、`src/features/discovery`、`src/features/phone` 的视觉实现。
- 不把候选资料直接写入正式 Profile，不把助手消息当作用户来源。
- 不把当前旧 Vercel UI 预览写成完整线上可用，不提交或打印任何密钥。
