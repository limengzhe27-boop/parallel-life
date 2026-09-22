# 如果 · Parallel Life

当前交付是可运行的架构骨架，尚不是可体验完整人生的产品。故事来自后续个人 Agent 访谈，不包含预设导演剧情。

## 文档入口

- [新 Agent 项目说明](docs/PROJECT_BRIEF.md)：产品目标、当前边界、架构地图、环境和接手方式
- [通用 Agent 启动提示词](docs/AGENT_START_PROMPT.md)：可直接复制给其他开发 Agent
- [任务报告模板](docs/TASK_REPORT_TEMPLATE.md)：开发中接续、交付与验收记录
- [产品需求](PRODUCT.md)
- [设计规范](DESIGN.md)
- [系统架构](docs/ARCHITECTURE.md)：模块、数据、AI、事件、时间、多人、权限、部署
- [架构复核](docs/ARCHITECTURE_REVIEW.md)：已修复问题、设计修订和待验证假设
- [开发任务总表](docs/DEVELOPMENT.md)：单人/双人/多人执行、依赖、领取、完成标记与验收；唯一进度来源
- [数据库基线](db/migrations/0001_foundation.sql)：未执行，需要独立 PostgreSQL

## 目录

```text
src/app/                     页面与 HTTP 入口，目前只有首页和 health
src/server/                  服务端配置、依赖组装
src/modules/profile/domain/  现实档案、推荐、资料授权契约
src/modules/world/domain/    世界、事件、提案校验、纯状态演算
src/modules/world/application/ 角色上下文与回合用例、仓储端口
src/modules/world/infrastructure/ 测试专用内存仓储
src/modules/ai/               模型接口与 yibuapi 文本适配器
src/modules/media/domain/    图片任务、私有素材契约
db/migrations/               PostgreSQL 迁移草案
tests/                       领域与适配器测试（不调用收费模型）
scripts/                     模块依赖检查
docs/                        架构和开发路线
```

## 本地运行

Node.js >=22.18。依赖使用精确版本与 package-lock.json 锁定；Next.js 已根据本轮实际依赖审计更新至 16.3.5，其余基础版本参考现有探索原型。升级需独立测试。

```sh
npm install
npm run dev
```

打开 http://127.0.0.1:3000 查看骨架首页。GET /api/health 是存活检查，不验证数据库和模型。配置模型时复制 .env.example 为 .env.local，仅填写服务端变量；首页、构建和测试均不需要密钥。此阶段没有聊天 HTTP 接口，也不会自动调用模型。

```sh
npm run check
npm run build
```

## 已实现与边界

已实现领域类型、运行时提案解析、单角色回合用例、状态演算、角色上下文过滤、测试仓储的原子提交与版本冲突、回执去重、文本模型适配器，以及基础 Web 入口。

**尚未实现** PostgreSQL 适配器、会话认证、持久化任务与 worker、真实 AI 访谈、图片生成、手机应用、时间分支及真人协作。SQL 尚未在数据库执行；网关适配器仅做模拟协议测试。MemoryWorldRepository 仅用于测试，重启丢失，禁止作为生产存档。

重复成功命令不会再次调用模型；并发尚在运行的重复命令可能重复调用模型，只有一次提交状态。需要阶段 B 的数据库任务预约和租约才能控制生产中的重复调用。模块检查是静态基础检查，不代替代码审查和端到端安全测试。

## 本轮验证（2026-09-22）

- 最新复核后 npm run check 通过：19 个源文件的模块边界检查、TypeScript 严格检查、18 项测试。新增三项回归测试先复现旧问题，再验证修复。
- npm run build 通过：Next.js 16.3.5 正式构建。
- 构建后本地启动：首页和 /api/health 均 HTTP 200，状态为 architecture-scaffold。
- 修复框架依赖版本后，安装时 npm audit 报告 0 项已知漏洞（仅代表本次依赖数据库结果）。
- 未执行数据库迁移，未调用真实付费模型，未进行完整产品的浏览器视觉验收。
