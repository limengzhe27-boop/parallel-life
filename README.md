# 如果 · Parallel Life

> 最新界面改版：用户已否定现有 PC 双栏、宽屏推荐和文案。现有功能验证不代表视觉验收；现已按 [全程手机方案](docs/PHONE_FIRST_REDESIGN.md) 实现入口、访谈、档案和推荐改版，待用户视觉审阅；世界桌面 U-06 由另一任务开发。


已经可以体验第一阶段「认识自己」：真实 AI 访谈、可确认和修改的档案、本人及重要人物照片、人生事件与自评曲线。数据保存到本项目独立 PostgreSQL，刷新和重新启动网页服务后可以恢复。

现已接通「另一种可能」：根据已确认资料真实生成三个方向，解释依据与取舍，可补充要求修改、自定义，并选择资料/人物照片保存独立人生设定。世界生成和虚拟手机里的角色生活继续按任务表推进；故事从访谈产生，不写死导演剧情。

## 直接体验

本地地址：[http://127.0.0.1:3218](http://127.0.0.1:3218)。手机上全屏，电脑上居中 480px App。底部固定「聊聊 / 如果 / 我的」：个人对话整理资料，人生分支集中展示，现实档案独立查看与编辑。打开即进入聊天；首屏可选填姓名和生日，没有独立欢迎页。当前是本浏览器的游客会话，正式登录和跨设备恢复属于 G 系列。

## 本地启动

需要 Node.js >=22.18，依赖使用精确版本与 package-lock.json。首次安装执行 `npm ci`。

1. 终端一：`npm run db:local`。保留进程，自动准备独立开发/测试数据库及忽略的本地配置。
2. 终端二：`npm run db:migrate`。只操作本项目开发库；已执行迁移按校验和跳过。
3. 在服务端 `.env.local` 配置 `.env.example` 所列的网关变量。当前工作目录已配置，不打印、不提交凭据。
4. 终端二：`npm run worker`。保留进程，负责真正的 AI 回应。
5. 终端三：`npm run dev`。打开上面的本地地址。

正式模式：先停止同目录 Web，再 `npm run build`，然后 `npm run start`。数据库和 Worker 仍需运行。构建时不要同时运行同目录开发服务器；两者共用 `.next`。

关闭服务保留 `.local` 中的数据和照片。不要删除 `.local` 来“重启”；换浏览器或清除 Cookie 会失去当前游客入口。

## 开发与协作入口

- [项目说明](docs/PROJECT_BRIEF.md)：给第一次接手的 Agent
- [开发任务总表](docs/DEVELOPMENT.md)：唯一进度来源、依赖与领取登记
- [通用启动提示词](docs/AGENT_START_PROMPT.md) · [任务报告模板](docs/TASK_REPORT_TEMPLATE.md)
- [本地与并行开发](docs/LOCAL_DEVELOPMENT.md)
- [产品需求](PRODUCT.md) · [设计规范](DESIGN.md)
- [架构](docs/ARCHITECTURE.md) · [架构复核](docs/ARCHITECTURE_REVIEW.md) · [API 契约](docs/API.md)

## 实现位置

|目录|内容|
|---|---|
|src/app、src/components、src/features|访谈页面、响应式界面、HTTP 客户端与入口|
|src/contracts|前后端共用运行时校验契约|
|src/modules/discovery|真实人生方向、明确选择的资料/照片快照与恢复|
|src/modules/profile、identity、media|档案、游客身份和私有照片|
|src/modules/tasks、src/workers|持久化任务、租约、取消和明确重试|
|src/modules/world|世界内核和 PostgreSQL 事务仓储；尚未接成角色生活接口|
|src/modules/ai、src/server|网关适配及服务端组装|
|db/migrations|已经在本地开发/测试库执行的迁移；后续修改增加新文件|
|tests、scripts|自动检查、真实库测试、显式真实模型评测与开发工具|

## 验证与交付边界

- `npm run check`：模块边界、类型和 35 项单元测试，不调用收费模型。
- `npm run test:db`：10 项真实 PostgreSQL 集成测试，数据库进程须运行；只使用独立测试库。
- `npm run format:check`、`npm run build`：格式及正式构建。
- `node tests/evals/vertical-slice.mjs --live`：显式运行两次收费文字评测，使用合成经历，要求 Web/Worker 运行。`--storage-only` 只检查照片与权限。

手机、桌面、档案/照片恢复、断网保留、暂停重试与两种经历的真实档案已验证，细节见 [V-01 报告](docs/task-reports/V-01.md)。`GET /api/health` 只表示 Web 进程存活，不代表数据库、Worker 或网关就绪。

当前未发布公网，尚未做上线备份恢复、托管对象存储、图片生成一致性、长期角色评测、账号/真人联机和支付验收。MemoryWorldRepository 只用于测试，生产请求不会回退到内存或假 AI。

人生方向入口：[/possibilities](http://127.0.0.1:3218/possibilities)。推荐、补充限制后的修改、手机/桌面设定保存与刷新恢复已验证，见 [D-01](docs/task-reports/D-01.md)、[D-02](docs/task-reports/D-02.md)、[D-04](docs/task-reports/D-04.md)。保存设定不会启动世界生成；D-03/D-05 等待图片链路完成。

本轮手机改版：35 项单元、类型、边界和正式构建通过；390/768/1440 与 390×500 短屏检查通过，实体设备键盘另行验收。素材及生成提示词见 [原创插画说明](public/art/README.md)。

本轮按 [已确认信息架构](docs/INFORMATION_ARCHITECTURE.md) 接续。H-01/U-06 桌面导航已合入，开发预览为 /ui-preview/phone；正式环境返回404，不把界面样板当成已创建世界。40 项单元检查及正式构建作为本轮验收；真实世界创建和四 App 数据联动仍待接通。

最新入口修正：取消聊天前的独立欢迎页。姓名/生日在个人对话首屏选填；我的提供姓名或昵称、生日、出生时间、所在城市、职业、家乡的可编辑资料卡。手机使用可用视口全宽全高，电脑居中最大480px，不强制固定长宽比例。
