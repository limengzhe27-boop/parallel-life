# 本地开发和集成

主登记目录以 DEVELOPMENT.md 为准。单人直接在此目录开发：Node >=22.18，npm ci。当前已有独立 PostgreSQL、Worker 和真实网关，默认 Web 端口 3218。本地 Git 已初始化，没有远程仓库；本地提交不是部署。

## 文件负责人

公共配置、依赖锁、src/contracts、src/server/composition.ts、迁移编号由集成人 codex-main-01a0c73b 串行维护。其他 Agent 领取时登记具体文件，不把角色默认目录当独占目录；先查看父/子目录是否重叠。公共字段变化先合入基线，消费者再同步。凭据只在被忽略的服务端环境，不复制旧项目数据库。

## 并行操作

1. 集成人在主表短锁内登记任务、独立分支和目录、端口、独立数据库及私有资源前缀；依赖须已完成。
2. 保存干净基线后，使用 `git worktree add ../parallel-life-任务ID -b task/任务ID` 建立工作树（示例路径需在授权写目录内；可改为本项目 .local/worktrees/任务ID）。每个工作树 npm ci，不共用 node_modules 或 .next。
3. 各工作树单独配置忽略的 .env.local。端口从 3220 开始分配，不与主目录 3218 冲突。数据库名/端口和照片目录也独立，不能只换网页端口；不得直接运行主目录的数据库初始化或测试。
4. 每次领取/更新读取主目录的任务表，工作树中的文档只是版本副本。不要把工作树旧任务表整文件合回主目录。无共享文件系统时通过集成人登记。
5. 交付前运行 npm run check、npm run build 和任务对应的真实数据库/浏览器验证；提交业务修改和专属报告，主表只标待验收。
6. 集成人检查 diff、权限边界、契约兼容，串行合并指定提交；依赖安装、迁移和构建不得与同目录其他任务同时运行。发生冲突时读两方实现，不整文件覆盖。
7. 在统一基线跑集成验证，再标完成并释放登记。保留报告与提交。移除工作树前检查其未提交内容，不强制删除。

当前为单人开发，不实际创建无用途的工作树。仅在用户指派其他任务或明确启动并行开发后分配资源。

## 独立本地环境（B-01 已实现）

先 `npm run db:local`，保持该终端运行；首次自动创建 .local/postgres、独立 parallel_life_dev/parallel_life_test 数据库，以及非管理员 pl_app/pl_worker 角色。仅监听 127.0.0.1:55432，关闭后保留数据。随机凭据放在忽略的 .local/runtime.json，服务端配置自动补入 .env.local，不覆盖已配置值。素材目录 .local/assets 不在 public 下，后续仅通过鉴权 API 访问。随后执行 npm run db:migrate，再分别启动 npm run worker 和 npm run dev。只启动数据库不会启动网页或模型调用。

本地使用真实 PostgreSQL 原生运行时 [embedded-postgres](https://github.com/leinelissen/embedded-postgres)，不依赖系统 PostgreSQL 或 Docker。安装需要该包的二进制符号链接安装脚本。部署时使用独立托管 PostgreSQL 与 S3 兼容私有存储，不能把本地随机凭据、测试库或 .local 目录打包上传。生产运行参数缺失时必须失败，不能回退内存仓储。

本地素材采用持久私有磁盘类 PrivateDiskStore，目前仅由鉴权 API 读取；上线时抽取存储端口并实现 S3 适配器和短时授权访问，在 R-03 验证。此选择减少本地依赖，不改变素材权限和归属。


## 当前启动与停止顺序

1. `npm ci`：本机原生 PostgreSQL 包的安装脚本须可执行；不要把其他平台的 node_modules 拷过来。
2. `npm run db:local`：保持终端一运行。会创建 `.env.local` 中缺失的本地变量；已有值不覆盖。网关变量按 `.env.example` 单独填写，勿打印凭据。
3. `npm run db:migrate`：执行开发库迁移。已应用文件有校验和，不能改历史文件；新增结构用新编号。
4. `npm run worker`：保持终端二运行。Worker 以 pl_worker 登录，Web 使用 pl_app，均不是管理员。
5. `npm run dev`：终端三启动 Web，访问 `http://127.0.0.1:3218`。默认使用 webpack，避免本机已复现的 Turbopack 中文语法诊断崩溃。

正式预览先停止 Web，再 `npm run build` 和 `npm run start`。开发服务和构建不能同时写同一个 `.next`。关闭时在各终端按 Ctrl+C；不要删除数据目录。工作树改端口时同时配置 APP_ORIGIN，不能只改网页端口。

## 验收和故障定位

- `npm run check`、`npm run format:check`、`npm run build`；真实库改动加 `npm run test:db`。测试库与开发库独立，切勿把集成测试改指向开发库。
- `/api/health` 是 Web 存活状态；访谈长时间排队时核对 Worker 是否运行，不应把排队改成假成功。
- Worker 失联后过期租约进入 unknown，用户可明确重试；不自动重发可能已计费的调用。
- 页面连接失败时先核对 Web、数据库和 APP_ORIGIN；消息保存在数据库，未发送草稿只在当前页面内存，刷新不会恢复未发送草稿。
- Cookie 有效期为 30 天；当前游客没有跨浏览器找回功能，正式账号在 G-01/G-02 开发。
- `node tests/evals/vertical-slice.mjs --live` 会调用两次真实模型；普通测试不调用。所有真实评测采用合成经历，不把用户原始照片用于自动验收。
