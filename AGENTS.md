# 人生剧本项目开发约定

先读 docs/PROJECT_BRIEF.md、主登记目录的 docs/DEVELOPMENT.md 和 docs/ARCHITECTURE_REVIEW.md；按任务读 PRODUCT.md、docs/ARCHITECTURE.md，改 UI 时读 DESIGN.md。用户最新要求优先。仅沿用本项目约定，不继承探索原型的部署地址或数据。

- 保持模块化单体。domain 不依赖框架、网络、数据库；application 面向端口；server 负责组装。
- 真实档案与虚构世界隔离；角色接收经裁剪的可见事实，不接收完整私人访谈。
- AI 只提出变更，运行时校验后由事务保存事件、状态、回执和 Outbox。
- 密钥只能放被忽略的服务端环境文件；不输出到日志、文档、客户端。
- 不把内存仓储接入生产，不以预设故事和假回复冒充 AI 成功。
- 暂未实现的模块保持诚实状态；更新开发清单，不擅自取消多人、时间、多人生需求。
- docs/DEVELOPMENT.md 是唯一任务状态总表。单人和多人都按任务 ID、依赖、领取登记与验收标准推进，不只凭阶段名称判断完成。
- 并行时只有一个集成人负责公共契约与合并；执行者按 DEVELOPMENT.md 的登记短锁规则更新自己的领取/进行中/待验收状态，只改登记文件，用独立工作树和专属报告回传进展，不从旧副本抢领任务。
- 一项任务一个主负责人；同一文件、迁移目标和公共配置不同时写。集成验证后才标完成，单人可自审但须记录证据。
- 开工前先在主表标进行中并登记唯一 Agent ID、工作目录和文件范围；每个关键进展、阻塞和回合收尾更新报告与接续点；写完先标待验收，完成集成验证才勾选已完成。
- 主登记目录当前为 /Users/limengzhe/Desktop/projects/demo/人生剧本；登记使用该目录的 .local/agent-board.lock 短锁。不能因超时自动删除他人锁，也不能复制任务表自行另立状态源。
- 运行 npm run check 和 npm run build。SQL、权限、任务队列变更补真实数据库集成测试；产品界面改动检查手机和 PC。
- **每完成一项交付就要部署上线（用户 2026-09-23 常驻要求）**：先确认生产库迁移已应用，再用与 Vercel 账号关联的提交身份提交并推送，等待部署 READY 后在公网地址实测关键流程；未上线或未验证就不算交付完成，如实写明当前线上版本。详见 docs/DEPLOYMENT.md。
- 禁止自动部署到探索原型的生产项目，禁止默认使用其用户数据库；此项目使用独立环境。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
