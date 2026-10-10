# Parallel Life · 开发任务总表与协作规则

版本：1.3｜更新日期：2026-09-22｜集成人：当前主任务中的 Codex（codex-main-01a0c73b）。

**这是项目唯一的任务状态总表，适用于一个人、两个 GPT 或多个开发者。** 角色是分工建议，一个人可顺序承担所有角色。当前主任务负责集成；用户另开“辅助”任务已交付 H-01 待验收。已初始化本地 Git 和独立数据库。

主登记目录：`/Users/limengzhe/Desktop/projects/demo/人生剧本`。登记短锁：该目录的 `.local/agent-board.lock`。位置变化时由集成人统一更新并通知其他 Agent，不允许各工作树自行设立第二份主表。

依据：[产品需求](../PRODUCT.md)、[系统架构](ARCHITECTURE.md)、[架构复核](ARCHITECTURE_REVIEW.md)、[设计规范](../DESIGN.md)。用户最新要求优先；改变范围时同步相关文档和受影响任务，不默默取消旧需求。


**当前接续入口（2026-10-10）：** 先读 [第 9 节未完成工作索引](#9-当前未完成工作与接续索引2026-10-10) 及 [BACKLOG-01 复盘证据](task-reports/BACKLOG-01.md)。下面早期“当前进度/最新优先级”是历史基线；实际状态按第 9 节对照原任务行和最新部署，不能据旧段落重复开发。

## 1. 当前进度与状态规则

已实现：真实 AI 访谈、档案编辑与来源、本人/人物照片、人生事件/自评曲线、手机/桌面界面、独立 PostgreSQL、游客会话和持久化任务。V-01 首阶段集成验收已通过。完整平行手机、世界生成、多人/时间/权益仍待后续任务；“类型已定义”不代表业务已实现。

接手顺序：读架构与本文 → 查看领取登记 → 选择依赖满足的任务 → 登记负责人/文件范围 → 开发与验证 → 交付 → 集成验收 → 更新状态。

最新优先级：按 PHONE_FIRST_REDESIGN.md 进行 U-03 至 U-07 改版，D-04 需返工。H-01 保留另一位 Agent 归属，U-06 是其建议接续任务。暂不按旧视觉扩展新应用。先检查范围与资源登记，不重复搭建已经完成的基础。可领取不代表正在执行。

|标记|含义|更新规则|
|---|---|---|
|[ ] 待开发|尚未开始，可能仍有未完成依赖|依赖、文件和环境条件满足后领取|
|[ ] 进行中|负责人已登记，正在实施|一个任务只有一个主负责人|
|[ ] 待验收|已交付，等待集成检查|独立工作树通过检查也先进入此状态|
|[ ] 阻塞|被具体外部条件卡住|记录原因、恢复条件及可继续工作；普通依赖等待不算阻塞|
|[x] 已完成|本行范围与验收标准满足，已进入统一基线|必须有交付证据与集成检查；单人可自审|
|[ ] 需返工|结果不满足标准或出现回归|记录复现，修复后重新验收|

不因对话结束标记完成。新需求增加稳定编号；回归可将已完成项改为需返工并登记原因。不删除历史编号，不把暂缓当取消。任务编号不表示工时权重，不能用完成条数推算产品完成百分比。

## 2. 分工、文件归属与资源隔离

|角色|主要职责|默认修改范围|
|---|---|---|
|集成 I|契约、依赖协调、公共配置、总表、合并与验收|src/contracts、公共类型、src/server/composition.ts、根配置、本文|
|服务端 B|身份、存储、任务、世界、权限与 API|src/modules 下业务代码、src/server、src/app/api、db、src/workers|
|界面 F|手机/PC、导航、输入、照片、状态反馈|src/app 中除 api 外的页面、src/components、src/features、样式|
|AI/媒体 A|访谈/推荐/导演、输出解析、生成适配、模型评测|领取时限定 src/modules/ai、media 或相关模块的具体文件；tests/evals|
|验收 Q|数据库、浏览器、多账号与故障恢复验证|各任务独立的 tests/integration/任务ID、tests/e2e/任务ID、验收记录|

**默认范围不是整目录的独占许可，领取时必须写具体路径。** B 与 A 的范围有交集，应先拆到具体文件。F 不改 API，B 不改页面。公共类型变更由 I 协调，前后端不能分别定义不兼容的数据模型。

公共文件/资源同时只有一个写入者：package.json、package-lock.json、tsconfig.json、next.config.ts、AGENTS.md、PRODUCT.md、DESIGN.md、架构文档、本文、共享契约、数据库迁移编号、公共测试配置。执行者向 I 说明所需变更，I 协调后修改；普通实现选择不需要反复找用户批准。

例外是本文中本人任务的领取与进度，可按登记短锁规则自行更新；不能借此改任务定义或他人状态。文件范围包含父目录/子目录时也视为重叠，不只比较路径是否完全相同。

### 并行前提

1. Git 初始化并保存架构基线，检查密钥、依赖和构建产物被忽略。本地版本管理不等于上传远程。
2. 每个写代码的并行任务用独立工作树/分支、独立端口；测试数据库或 schema 也隔离。工作树不隔离外部数据库或 API 配额，实际付费生成由 I 统一安排。
3. 两任务只有在依赖满足、写入文件和外部资源不冲突时才可并行。不同角色或相邻编号不自动表示可并行。
4. 未准备隔离环境时，代码写入串行；可并行做明确互不相交的文档/只读工作。
5. 主目录的本文是权威版本。其他工作树中的副本不实时同步，不能只凭旧副本自行抢领任务。

### 登记与合并规则

I 可预先分配任务；未分配的任务也可由执行者按下面的登记短锁流程领取。执行者只更新自己任务的进行中、进展、阻塞或待验收状态；任务定义、依赖、公共文件归属、交接和最终已完成标记由 I 协调。详细进展保存在专属 docs/task-reports/任务ID.md。文档不会自动跟踪工作，执行者必须主动更新。

单人开发时自己就是 I，可完成自审并记录。多人交付时先到“待验收”，I 审阅、合并、检查后才标完成。并行期间契约变更先合入基线，再由受影响任务同步。负责人暂时离线不等于可重复领取，需明确交接或收回。没有负责人正在运行时，不声称系统会自行继续开发。

### 登记短锁：避免同时领取

这是所有参与者共同遵守的文件登记协议，不是自动任务调度或操作系统级代码写入隔离。它用于串行更新主任务表；业务文件仍靠工作树和范围登记隔离。独立电脑之间不能靠各自本地锁协调，须通过同一集成人登记。

1. 确认主登记目录真实存在。仅对其 `.local` 父目录使用 `mkdir -p`；对 `.local/agent-board.lock` 使用普通 `mkdir`，**不得加 `-p`**。操作系统返回成功才算取得锁。禁止先“检查不存在”再直接写表。
2. 若创建失败且锁存在，读取 holder 信息，结束本次登记，稍后重试或向集成人协调；不能覆盖表、另建主表或删别人锁。权限/路径错误先报告，不冒充成功。
3. 成功后立即在锁目录写 `owner.json`：唯一 Agent ID、当前会话标识、UTC 获取时间、本次操作、任务 ID。该文件只用于协作，不能写密钥。
4. 持锁后重新读取主表。检查任务未领取、依赖均已完成，且与所有未释放登记的文件和外部资源无交叉。已有本人领取则接续，已有他人领取则选别项。范围冲突或 I 角色未授予时不能领取。
5. 同一持锁期间更新任务行及登记行：状态“进行中”、负责人、工作目录、具体路径、资源、时间和下一步。写完重新读回检查；成功后才算领取。不得先开始开发再补登记。
6. 核对 owner.json 仍为本人本次登记后，只删除自己写的 owner.json，再用 `rmdir` 释放锁。其他文件或所有者不一致时停止并报告，禁止递归强删。不在持锁时做开发、构建、模型调用或等待用户。
7. 后续状态更新也遵循相同流程，并核对任务负责人仍是自己。已交付任务标“待验收”，保留负责人至集成完成。I 验收后标“已完成”、补证据并移入已完成记录，释放文件/资源登记。

锁只是几秒的表格编辑保护，**锁释放不等于任务释放**。Agent 崩溃留下锁或半写记录时，不按时间自动抢占；集成人确认原登记者已停止后核对文件、恢复一致状态，再记录接管。未确认的锁保持只读，不能仅因 owner.json 缺失或更新时间较旧而删除。

### 开发中、阻塞与结束时怎么标记

|时点|主表动作|专属报告内容|
|---|---|---|
|真正开工前|领取并标进行中|基线、依赖、文件/资源范围和验收计划|
|完成子步骤或结束当前轮次|保持进行中，更新时间/接续点|已实现内容、当前文件、检查结果、下一条操作|
|需要扩大文件范围|先在锁内检查冲突，再由 I 协调范围|为什么需要改公共文件、影响谁|
|遇到外部阻塞|标阻塞，保留负责人|原因、恢复条件、能继续做的部分|
|代码/文档已交付|标待验收|提交或文件、实际检查、缺口和集成建议|
|集成检查通过|I 标已完成并勾选，移入历史|最终证据、集成人、日期、对后续任务的影响|
|明确交接/放弃领取|I 记录接管人或恢复待开发，保留历史|已有修改、未提交内容与交接条件|

报告使用 [模板](TASK_REPORT_TEMPLATE.md)，启动提示词见 [通用提示词](AGENT_START_PROMPT.md)。进行中/阻塞/待验收任务都不能被另一个 Agent 自行重新领取。首次接手时优先读 [项目说明](PROJECT_BRIEF.md)。

## 3. 单人、双人和多人执行路线

### 单人

按硬依赖的拓扑顺序推进，建议：
准备与契约 → 存储/身份/任务 → 真实访谈和档案 → 推荐/建世界 → 手机与角色 → 导演/时间/多人生 → 账号/真人 → 权益与成品验收。

每次先做一条可运行链路，再扩大范围。M-01 图片能力验证尽早插入，不必等所有 UI。具体任务无需等整阶段结束，只要自己的依赖已完成即可。

### 两个开发者 / GPT

|阶段|开发者 1：I+B，按需兼 A|开发者 2：F，按需兼 Q|汇合验收|
|---|---|---|---|
|准备|P-01、P-02、P-03，分配文件边界|读基线，接口约定后领取 P-04|共享契约|
|认识我|B 系列、C-01/C-02/C-03；插入 M-01|U-01/U-02、C-04/C-05|V-01|
|创造人生|M 系列、D-01/D-02/D-03|D-04、H-01|V-02|
|平行手机|W 系列、H-02/H-06|H-03/H-04/H-05/H-07|V-03|
|持续生活|L-01/L-02/L-03/L-04|L-05 与交互验证|V-04|
|多人和交付|G/E 服务端、R 基础运维|G/E 界面、双账号与多尺寸验证|V-05、R-04|

这是分工方向，**仍须遵守每行任务的硬依赖**，不是同一阶段所有任务都能立即启动。UI 可先用明确的测试夹具开发；正式联调不能使用假回复冒充真实模型。

### 三人及以上

可增加 A 专门做模型/图片验证和适配，Q 做专项验收；再增加人员时按具体独立任务切分，不复制多套架构。保持一个 I。没有满足依赖的工作时先做只读审查，不在等待期间自行重写公共接口。

### 关键汇合顺序

V-01 真实访谈与保存恢复 → V-02 个性化人生创建 → V-03 手机应用与角色联动 → V-04 长期游玩/分支/时间 → V-05 双账号相遇 → R-04 最终交付。

这些门槛均需实际链路验证。只完成单个页面不等于通过汇合验收。

## 4. 完整任务清单

角色为建议类型，具体人见第 6 节登记。依赖中的逗号表示全部满足；“—”表示没有其他任务前置。证据“—”表示尚未交付。

### A · 已有成果与本次任务框架

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|A-01|[x] 已完成|I|—|确定产品范围、手机/PC 和设计基线；保留多人、时间、多人生|PRODUCT.md、DESIGN.md；用户已确认|
|A-02|[x] 已完成|I|A-01|工程、模块检查、首页/health、文本适配器可构建；不宣称真实 AI 接通|README.md、src/app、src/server、src/modules/ai；构建及本地 HTTP 验证|
|A-03|[x] 已完成|B|A-02|世界类型、角色上下文、回合、事件演算、测试仓储；验证原子性、版本冲突和隔离|src/modules/world、tests/world.test.ts；仅测试仓储|
|A-04|[x] 已完成|I|A-03|修复编号冲突、权限检查遗漏、无回复成功；保留架构未实现项|ARCHITECTURE_REVIEW.md；18 项测试与构建通过|
|A-05|[x] 已完成|I|A-04|建立本文，覆盖范围、依赖、单人/多人、领取与完成标记；检查编号、依赖和链接|本文；64 项编号唯一、依赖无环、引用与链接有效，README/AGENTS 入口已同步|
|A-06|[x] 已完成|I|A-05|建立 Agent 项目说明、领取/状态更新流程和通用启动提示词；检查文档一致性与防重复登记规则|PROJECT_BRIEF.md、AGENT_START_PROMPT.md、TASK_REPORT_TEMPLATE.md；65 项依赖/链接及短锁竞争检查通过；详见 [报告](task-reports/A-06.md)|

### P · 开发准备与契约

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|P-01|[x] 已完成|I|A-06|初始化本地 Git 并保存基线；检查敏感文件未追踪；需要并行时创建独立工作树/端口登记|[报告](task-reports/P-01.md)；66035ae；42 个已追踪文件的忽略与凭据检查通过|
|P-02|[x] 已完成|I|P-01|共享 API/DTO：身份、访谈、任务、档案版本、事实/认知、邀约、世界版本、素材修订；运行时校验和前后端共用类型|[报告](task-reports/P-02.md)；共享运行时校验、22 项测试及构建通过|
|P-03|[x] 已完成|I|P-02|落实写入边界、公共配置负责人、工作树启动和集成步骤；单人/并行都能按文档运行|[报告](task-reports/P-03.md)；LOCAL_DEVELOPMENT.md；单人/并行步骤与主表一致|
|P-04|[x] 已完成|F|P-02|建立 UI 客户端接口和测试夹具，含空态/加载/失败/冲突；正式环境不自动回退假数据|[报告](task-reports/P-04.md)；29 项单元、边界/类型与构建通过|

### B · 服务端基础

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|B-01|[x] 已完成|B|P-02|准备独立 PostgreSQL、私有存储与服务端配置；明确本地/测试/部署环境和可访问性，不用旧项目用户数据|[报告](task-reports/B-01.md)；独立 PostgreSQL 18.4；22 项测试及构建通过|
|B-02|[x] 已完成|B|B-01|修订迁移：账号、访谈、档案、通用任务、世界/初始快照、投影、事件、素材；补分支及回执约束并在真实测试库验证|[报告](task-reports/B-02.md)；真实 PostgreSQL 约束/回滚/隔离测试、22 项测试与构建通过|
|B-03|[x] 已完成|B|B-02|游客身份/会话、写操作保护和所有权检查；浏览器不能指定 ownerId，两个游客数据隔离|[报告](task-reports/B-03.md)；24 项单元测试、2 项真实库集成测试与构建通过|
|B-04|[x] 已完成|B|B-03|真实仓储事务：事件/状态/回执/Outbox 原子提交；验证越权、回滚、并发冲突和重启恢复|[报告](task-reports/B-04.md)；24 项单元、3 项真实库测试与构建通过|
|B-05|[x] 已完成|B|B-04|通用任务/Worker：访谈无 worldId、原子领取、租约、旧 Worker 拒绝提交、重试/unknown/取消；重复操作不重复运行|[报告](task-reports/B-05.md)；25 项单元、4 项真实库测试与构建通过|
|B-06|[x] 已完成|B|B-05|统一 API 错误、任务查询、限流、请求标识、生成额度和脱敏日志；无任务越权或密钥泄漏|[报告](task-reports/B-06.md)；25 项单元、5 项真实库测试与构建通过|
|B-07|[x] 已完成|B|B-03|私有照片上传/读取/删除；类型、尺寸、像素、EXIF、权限与引用校验；跨用户不可读|[报告](task-reports/B-07.md)；30 项单元、8 项真实集成与构建通过|

### U · 手机与 PC 基础界面

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|U-01|[x] 已完成|F|P-04|设计变量、按钮、输入、卡片、对话、抽屉、通知；焦点/禁用/错误/减少动效状态齐全|[报告](task-reports/U-01.md)；手机/桌面组件、弹窗焦点/Esc、30 项测试与构建通过|
|U-02|[x] 已完成|F|U-01|手机全屏/PC 双栏和手机居中布局；返回、安全区、软键盘、390/768/1440px 可用且无横向溢出|[报告](task-reports/U-02.md)；390/768/1440 布局、档案后退和构建通过|

### C · 认识现实中的我

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|C-01|[x] 已完成|A|B-06|真实文字网关与访谈任务：多轮结构化输出、延迟/错误记录、模板版本化；不吞错或切换假回复|[报告](task-reports/C-01.md)；真实文字 2 次：14.7/8.1 秒；来源与个性化审阅通过|
|C-02|[x] 已完成|B|C-01|访谈消息先保存，自然追问并输出有来源的档案建议；失败保留输入、退出恢复；无固定职业或恋爱故事|[报告](task-reports/C-02.md)；29 项单元、6 项真实库测试及构建通过|
|C-03|[x] 已完成|B|C-02|档案确认、编辑、删除与版本合并；慢 AI 不覆盖用户改动，未知信息不编造|[报告](task-reports/C-03.md)；30 项单元、7 项真实库测试与构建通过|
|C-04|[x] 已完成|F|U-02|聊天和实时档案界面：发送/重试、照片入口、编辑抽屉、PC 并排；按夹具完成交互，真实联调在 V-01|[报告](task-reports/C-04.md)；真实 AI 浏览器链路及默认 fetch 回归；31 项测试和构建通过|
|C-05|[x] 已完成|F|C-04|人生事件/曲线、补充与修改经历；自评和未知区分，无虚构评分；照片与重要人物关联|[报告](task-reports/C-05.md)；32 项单元、8 项真实库、构建及手机/桌面事件人物照片通过|
|V-01|[x] 已完成|Q|C-03,C-05,B-07|真实访谈全链路：两种经历产生不同档案，上传/编辑/退出/恢复/失败重试，手机和 PC 均通过|[报告](task-reports/V-01.md)；首阶段真实访谈闭环验收通过；32 项单元、8 项真实库、手机/PC 与恢复通过|

### U 增补 · 全流程手机改版

结构需求已确认，配色与逐屏文案为本轮提案。见 [改版与专用提示词](PHONE_FIRST_REDESIGN.md)。以下未领取任务不代表已派发。

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|U-03|[ ] 待验收|I|U-02|全程窄幅 App 视口、公共视觉变量、入口及内部弹层；桌面不出现双栏或外侧面板|[报告](task-reports/U-03.md)；审计20项已追加；冻结手机壳受控集成，44项测试与构建通过；视觉待用户审阅|
|U-04|[ ] 待验收|I|U-02|手机内访谈/档案、文案、照片与事件布局改版；真实功能、草稿与恢复不回退|[报告](task-reports/U-04.md)；聊天直接进入，姓名生日内嵌选填；我的补充六项资料；四种视口与40项检查、构建通过|
|U-05|[ ] 待验收|I|D-01|推荐及资料选择手机改版，与 D-04 一起验收；短文案/封面/详情层次清楚且不伪造生成|[报告](task-reports/U-05.md)；恢复固定聊聊/如果/我的；我的整页与聊天共享档案，所有已保存分支集中展示；40项检查及手机PC验证通过|
|U-06|[ ] 待验收|F|U-02|沿 H-01 成果调整世界桌面和手机内部辅助导航；兼容共享视口，不重复外壳；独立预览与短屏验证|最新返修 103af3b（接续 eaeb180/a2bbcdb/89951e4）；顶部状态区、锁屏/解锁、三场景通知横幅；40 项测试/构建及四尺寸浏览器回归通过；lock-* / home-banner-* 截图；待 I 合并验收|
|U-07|[ ] 待开发|Q|U-03,U-04,U-05,U-06|合并后四屏及状态视觉审阅，手机/平板/PC、短屏/键盘/返回/恢复验收；未经用户认可的视觉不勾选|—|

### M · 图片能力与私有素材（尽早验证）

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|M-01|[ ] 待开发|A|P-02|在已授权范围小规模实测参考图：人物一致性、协议、延迟、失败与费用；不满足则记录缺口并调整方案，不伪称通过|—|
|M-02|[ ] 待开发|A|M-01,B-06,B-07|媒体适配器：先登记后提交、授权素材引用、结果复用、unknown 不自动重付；安全下载与脱敏日志|—|
|M-03|[ ] 待开发|B|M-02|素材持久化、requestId 幂等、独立 assetRevision；图片失败可恢复，完成时不让并发聊天版本失效|—|

### D · 推荐与创造人生

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|D-01|[x] 已完成|A|V-01|从档案生成多个“如果”、依据和差异；可讨论、修改、自定义；不同经历产生不同推荐|[报告](task-reports/D-01.md)；来源与版本校验、不同经历真实推荐、35 项单元和9项真实库通过|
|D-02|[x] 已完成|B|D-01|采纳方向并保存带入资料/照片的授权快照与版本；不带入完整私聊，不自动继承后续档案变化|[报告](task-reports/D-02.md)；明确选择的设定快照、版本/权限与10项真实库通过，视觉另列U-05|
|D-06|[x] 已完成|I|D-02|文字世界创建先行：持久任务、授权设定、身份人物与开场、世界快照与手机只读入口；图片与角色持续回合仍按原任务接续|[报告](task-reports/D-06.md)；文字世界创建、快照与手机读取全链路打通；生产真实大模型与东京Supabase端到端通过（生成身份、4位角色关系、初始微信对白、3篇备忘录，World Phone 正常载入）|
|D-08|[x] 已完成|I|D-06|世界生成可用性：输出上限按调用可指定、截断可见、模型输出容错解析且不降低字段校验；生产与本地一致通过|2026-09-23 dsh-main-20260923：[报告](task-reports/D-08.md)；上线实测发现世界创建 `INVALID_AI_OUTPUT`，根因是固定 4096 上限被推理+正文撑爆（`finish=length`）且严格 schema 拒收多余字段；改为世界 8192/方向 6144 + 容错解析 + `AI_TRUNCATED` + 结构不合法时一次纠正重试（超时仍不重试）；合格率 1/3、2/5 → 4/4；95 项检查与构建通过；**生产全链路实测通过**|
|D-07|[ ] 待验收|I|D-06|从个人对话一键生成分支并直接进入手机：复用既有 approveSeed/createWorld/同步任务路径，不新增假数据、不跳过用户确认；生成中显示真实状态，失败可就地重试|[报告](task-reports/D-07.md)；复现旧入口静默跳走（0 条确认资料时模型输出不合格且错误被吞）；已改为有依据才可点、失败原地可见可重试，并抽出纯函数+5 项回归测试；93 项检查+构建通过；本地与**生产**均实测：46–49s 生成并进入世界、世界内 6–7s 收到角色回复；390px 无横向溢出；待用户实机确认|
|D-09|[x] 已完成|I|D-06|访谈任意失败后的重试必须可用：handler 只登记 suggested 候选、不直写 Profile；失败必须有脱敏诊断，业务错误不再伪装成 AI_FAILED|[报告](task-reports/D-09.md)；复现用户"重新回应必然失败"（DomainError: New memory candidates must start as suggested，整事务回滚）；修复后本地与**生产（用户本人会话）**端到端通过：重试 12s 成功 → 5 条候选待确认 → 确认 3 条写入档案 → 分支入口解锁 → 25s 生成世界并进入手机 → 手机内角色真实回复；95 单元 + 14 真实库测试通过|
|D-10|[x] 已完成|I|D-09|资料沉淀：只提炼长期有价值的信息，噪声与基础资料重复不落档案，同一件事合并来源而不新增；提炼后**自动写入**，不再要求逐条采纳|[报告](task-reports/D-10.md)；新增可测试的提取质量判定（噪声/问句/假设/卡片覆盖/用户拒绝）+ 提示词 v1.3.0（每轮上限 3 事实 1 事件）+ 两条路径直写档案；102 单元 + 14 真实库测试通过；本地与**生产**验证：自动写入、待确认 0、同类别近重复 0；另清理 Neon（唯一数据库为 Supabase）|
|D-11|[x] 已完成|I|D-10|手机内消息按真实状态显示（发送中/已发送/失败可重试）、便签如实说明只存本机、去掉伪造日程通知与跨联系人日历卡、修正开场时间戳二次偏移|[报告](task-reports/D-11.md)；生产实测：阻断发送接口 1.5s 内显示「发送失败」+重试、恢复后重试成功（服务端 version 2 / 7 条消息）；103 单元测试与构建通过|
|D-12|[x] 已完成|B|D-11|便签真实持久化：服务端命令 + 路由 + 迁移（投影表与事件）+ UI 接线，替换当前仅本机缓存；含幂等、所有权与版本冲突的真实库测试|[报告](task-reports/D-12.md)；迁移 0017 已应用于本地与生产 Supabase；107 单元 + 15 真实库测试通过；生产实测：创建→重载仍在（v1）→更新（v2）→旧版本 409 拒绝，手机列表刷新后可见；便签不进 world 快照|
|D-13|[x] 已完成|B|D-12|世界事实容量（AUD-09）：事实改为独立投影 + 内存窗口按字符预算有界 + 快照不携带事实 + 超限时明确报错；含真实库容量测试（远超 256KB 仍可持续提交，旧事实仍可查）|[报告](task-reports/D-13.md)；迁移 0018/0019 已应用于本地与生产并回填既有事实；16 轮×8 条×3000 字（≈390KB）连续提交全部成功、快照 facts 为 0 且 1.2KB、128 条事实全部可查；110 单元 + 16 真实库测试通过；生产实测回合正常（version 5→6，快照 1217 字节）|
|D-14|[x] 已完成|B|D-13|访客创建按调用者限流（AUD-15）：按调用者分桶（加盐哈希地址）+ 保留更宽的全局上限 + 被全局拒绝时归还调用者额度，避免单一调用者耗尽全站新用户额度|[报告](task-reports/D-14.md)；迁移 0020 已应用于本地与生产；113 单元 + 17 真实库测试通过（同调用者达限被拒、他者不受影响、被拒不消耗全局、重复建号不耗额度）；生产实测 200 并记录哈希桶，函数行为探测符合设计|
|D-15|[x] 已完成|I|D-14|一批审计整改：`npm run verify` + CI 交付门槛与预览开关单点化（AUD-17）、Worker 停机 drain 与 unknown 语义（AUD-12）、缺失索引与分支列表 N+1（AUD-13）、非法 world id 返回 404（AUD-08）|[报告](task-reports/D-15.md)；117 单元 + 17 真实库测试通过；迁移 0021 已应用于本地与生产；生产复测通过：非法 world id → 404、未知 uuid → 404、分支列表 200（首次部署构建报 ERROR，重新触发后已生效）|
|D-16|[x] 已完成|I|D-15|Phase 0 执行层（AUD-03）：outbox 消费者（领取/派发/幂等/有限重试）+ `media` handler（诚实失败不造假图）+ 世界回合索图产生 `media.requested` + owner 级派发入口；修复媒体 scope 契约误当 uuid 的生产 bug|[报告](task-reports/D-16.md)；迁移 0022 已应用于本地与生产；134 单元 + 18 真实库测试通过；生产实测：索图 → outbox job → 派发 submitted → media 任务 queued → 执行后 failed 且 job 记 NOT_IMPLEMENTED、请求仍待处理、素材数 0|
|D-17|[x] 已完成|I|D-16|Phase 1 记忆接线：队列允许 memory 任务、共享写入器（同句合并来源）、访谈抽取写入 profile 作用域记忆（带真实来源、零额外模型调用）、用户纠正/遗忘接口；并修复并发安全加固迁移导致两个运行角色失去触发器/CHECK 函数权限的生产回归|[报告](task-reports/D-17.md)；迁移 0024/0025 已应用于本地与生产；152 单元 + 21 真实库测试通过（新增角色权限守卫测试）；生产 `GET /memory/records` 200、错误 id 404|
|D-18|[x] 已完成|I|D-17|Phase 1 收尾（世界侧）：世界回合在同一事务内把角色印象写入 character 作用域、把本轮事件写入 branch episode，来源为真实消息/事件 id，重复表述合并来源|[报告](task-reports/D-18.md)；154 单元 + 22 真实库测试通过（新增 world-memory：作用域、来源类型、重复合并）；无新增迁移|
|D-19|[x] 已完成|I|D-18|检索统一：角色回合按作用域加载记忆（自己 + 本世界 episode，私有 profile 隔离）、遗忘记录屏蔽其来源、superseded 不计入，并接进世界回合|[报告](task-reports/D-19.md)；154 单元 + 23 真实库测试通过（新增 memory-retrieval：作用域隔离、遗忘屏蔽、回合确实收到记忆）；无新增迁移。Phase 1 完成，仅剩手机端记忆界面|
|D-20|[x] 已完成|A|D-19|Phase 2 时钟 + 导演骨架：`world_clock`/`world_beats` 迁移、纯函数时钟（1:1/倍速/暂停/离线≤3 拍+摘要、故事时间追上现实）、沉默最久优先且不连续同一人的选人、舞台指示不冒充用户、每拍走同一条回合流水线、`POST /worlds/:id/advance`。对应 L-04 部分能力与 W-04 前置|[报告](task-reports/D-20.md)；迁移 0026 已应用于本地与生产；162 单元 + 24 真实库测试通过；生产实测 6 小时级缺勤场景：3 拍、版本 7→10、时钟与故事时间落库|
|D-21|[x] 已完成|I|D-20|展示版架构与全流程图文档：分层架构图、6 Agent + 2 引擎名册、7 个场景时序（访谈沉淀/分支/建世界/NPC 回合/索图/离线导演/记忆纠正）、真实↔虚构数据边界、现状与未完成、以及交给 GPT 出图的 8 张图精确描述|[AGENT_FLOW.md](AGENT_FLOW.md)|
|D-22|[x] 已完成|I|D-20|导演接 agenda：节拍由未了结的事驱动（欠回应的人优先 → 未定约定的参与者 → 才回到沉默最久），舞台指示写明具体那件事；纯函数 `buildAgenda`|[报告](task-reports/D-22.md)；165 单元 + 24 真实库测试通过（含"proposed 约定决定第一拍"）；无新增迁移|
|D-23|[x] 已完成|I|D-22|导演记忆化与世界时钟控制面：承诺进入 agenda（欠回应>未定约定>承诺>沉默）、离线摘要写入 branch 记忆、`GET/POST /worlds/:id/clock` 暂停与倍速（不动上次跳动，不造时间）|[报告](task-reports/D-23.md)；167 单元 + 24 真实库测试通过；无新增迁移|
|D-24|[x] 已完成|I|D-23|L-03 导演控制面：`world_direction` brief（主题/节奏/聚焦角色）+ 纯函数校验、节奏作为节拍硬上限、聚焦进入选人、导演要求进入舞台指示、`preview` 只描述影响不落库、**历史改写被拒并指向分支**|[报告](task-reports/D-24.md)；迁移 0027 已应用于本地与生产；172 单元 + 24 真实库测试通过|
|D-25|[x] 已完成|I|D-24|文档事实校准（修正 AUD-18 的过度声明与过时计数）+ 手机端四项接线方案（时间控件/导演面板/记忆界面/索图结果，含协作注意事项）|[报告](task-reports/D-25.md)；真实计数 172 单元 + 24 真实库、27 迁移；AGENT_FLOW 计数与状态已同步|
|D-26|[x] 已完成|I|D-25|预期（目标态）架构与预期效果文档：预期体验与 9 条可验收效果、目标分层架构图与三条红线、真实/虚构两侧目标时序（Mermaid）、导演目标工作循环、记忆模型、效果指标表、与现状的差距（映射 M-01..M-03 / G-01..G-05 / E / R / AUD）、4 张出图提示词|[AGENT_TARGET.md](AGENT_TARGET.md)|
|D-27|[x] 已完成|I|D-26|展示用 Agent 流程图集（纯 Mermaid，11 张：总览/职责/信息路径/分支到人生/世界内对话/导演循环/时间/记忆一生/隔离/指挥导演/三条底线），刻意不含接口路径与技术实现细节，附每图一句话说明|[AGENT_DIAGRAMS.md](AGENT_DIAGRAMS.md)|
|D-28|[x] 已完成|I|D-27|手机端接线的客户端能力：新增 `world-clock` 契约（时钟/推进/导演 brief/影响）与 6 个客户端方法（时钟读写/推进/导演读写含 preview 与 move/记忆列举与纠正遗忘），手机投影契约未动；UI 挂载因并发大改手机壳而推迟，已定位到 5 个落点|[报告](task-reports/D-28.md)；172 单元测试与构建通过；UI 挂载步骤与验收口径见报告|
|D-29|[x] 已完成|I|D-28|导演能力用户可用：手机端真实导演面板（真实故事时间/暂停/1×/2×/让世界走一会儿/导演要求 主题·节奏·聚焦/先看影响再应用/历史不改写提示），替换原视觉稿；并复核"聊天→分支→建世界→进入体验"链路端到端通过|[报告](task-reports/D-29.md)；172 单元 + 24 真实库测试与构建通过；生产实测：面板可用且显示真实故事时间（时钟读取已接通）；**暂停/倍速/推进的交互级验证未通过（点击后未显示已暂停，原因未定位），列为待验证**；无新增迁移|
|D-30|[x] 已完成|I|D-29|对话中主动推荐分支 / 一句话创建并进入：新增可测试的分支意图路由（进入 / 创建 / 推荐 / 无关），访谈页按意图分流——明确要创建则先推演再**直接建世界并进入体验**，只说看看则只展示；修好"帮我创建一个分支/我想试试另一条/有什么分支"等说法原先无反应的问题|[报告](task-reports/D-30.md)；176 单元（新增 22 用例）+ 24 真实库测试与构建通过；浏览器点击级验证待补|
|D-31|[x] 已完成|I|D-30|修复"说创建分支却打开已有分支"：创建意图不再被"已有世界就打开"的捷径吞掉（顺序修正），并新增 `chooseUnbuiltDirection` 跳过已采用过的方向、全采用过则重新推演、仍无可用才让用户选｜[报告](task-reports/D-31.md)；177 单元测试（含"创建分支绝不能重开已有的人生"回归用例）与构建通过；点击级验证待补|
|D-32|[x] 已完成|I|D-31|**根因修复**"对话中让它直接生成分支不生效"：服务端要求"已确认事实或非空 brief"且画像版本必须一致，而 UI 传的是**可能过期的 profileVersion + 空 brief** → 分别 `VERSION_CONFLICT` / `INVALID_INPUT` 且被折叠成静默失败。现改为实时版本 + 用对话内容生成 brief + 冲突自动重试一次 + 可行动的失败文案｜[报告](task-reports/D-32.md)；真实库回归直接复现根因并证明修复（空 brief 被拒 → 带对话 brief 被接受 → 过期版本冲突）；178 单元 + 25 真实库测试与构建通过；点击级验证待补|
|D-33|[x] 已完成|I|D-32|根因（UI 侧）修复"已有世界时创建分支只提示进入已有分支"：① `approveSeed` 用了**过期的 discovery 版本**（`data?.version` 在 `setData` 之前读取）→ VERSION_CONFLICT；② **失败提示只在"没有世界"的分支里渲染**，已有世界时任何错误都不可见 → 用户只看到"进入体验"卡片。现改为显式传递刚返回的版本、进度与错误在任何状态都可见、并放宽识别措辞（"创建一个新的分支"）|[报告](task-reports/D-33.md)；用户真实数据诊断：服务端 202 正常且尚有 2 个未采用方向；178 单元 + 25 真实库测试与构建通过；点击级验证待补|
|D-03|[ ] 待开发|B|D-06,M-03|世界创建任务：动态身份、人物、关系、初始事件/手机内容；version=0 快照，阶段进度持久化，失败可续接|—|
|D-04|[ ] 待验收|F|C-05|推荐卡、自定义/修改、资料确认与保存设定；推荐任务状态、失败重试及恢复；世界生成进度单列 D-05|[报告](task-reports/D-04.md)；已按 U-05 重做，保留真实接口；待用户视觉审阅|
|D-05|[ ] 待开发|F|D-03,D-04|世界生成各阶段的真实进度、失败恢复与进入手机；恢复时对应同一个创建任务，未完成阶段不伪装成功|—|
|V-02|[ ] 待开发|Q|D-03,D-04,D-05|两套真实访谈分别创建不同人生并进入手机；失败可续接，重启恢复人物和素材|—|

### W · 世界和角色运行

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|W-01A|[x] 已完成|B|B-04|角色认知与邀约语义前置：新回合只能记录自己的认知及待确认邀约，旧事件可重放；领域/仓储测试，不开放确认API|I自审：58项检查、生产构建、独立真实库并发/重连/回滚通过；[报告](task-reports/W-01A.md)；W-01完整验收与确认API仍待接续|
|W-01|[ ] 待开发|B|V-02|事实/角色认知/个人记录、来源与可见范围；邀约提议/确认/取消；角色不能把个人说法直接写成公共事实|—|
|W-02A|[x] 已完成|A|B-04|角色上下文前置：授权后检索旧消息、保留来源、总长度硬限制；纯应用层单测，不替代W-01/W-02验收|I自审：6项新增边界测试，55项检查与构建通过；[报告](task-reports/W-02A.md)；仅上下文前置完成，不代表W-02/W-03完成|
|W-02|[ ] 待开发|A|W-01|带权限的长期记忆、来源摘要、相关检索与总预算；长对话不越限、不串人物秘密|—|
|W-03|[ ] 待开发|B|W-02|真实角色回合：保存输入、校验、事务、回执；拒绝代用户行动、冒名说话或无回复成功|—|
|W-04|[ ] 待开发|A|W-03|导演按事件调度关键角色，频率/冷却/知识范围受控；不让全体角色每轮都调用模型|—|

### H · 平行手机应用

消息和联系人属于同一应用，朋友圈为社交页。各项包含实际交互，不能只画静态壳；明确使用夹具的 UI 项由 V-03 负责真实联调验收。

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|H-01|[x] 已完成|F|U-02|手机桌面/壁纸、应用打开/返回、通知定位、PC 辅助面板和滚动位置恢复|I自审：89951e4/a2bbcdb已合入并通过导航/滚动与手机PC检查；最新锁屏归U-06继续待验收|
|H-02|[ ] 待开发|B|W-01|授权应用查询投影、分页/版本刷新；消息/日历/相册引用同一事件，不各自生成剧情|—|
|H-03|[ ] 待验收|F|H-01|消息列表、联系人、人设摘要、聊天输入、未读/重试和关联内容跳转；契约夹具可独立开发|6f77460（接续103af3b）；四应用UI/异步回执/草稿与失败恢复；43项检查、构建、四尺寸浏览器通过；原工作树专属报告与apps-*截图；待I真实对接/合并|
|H-04|[ ] 待开发|F|H-01|朋友圈列表/详情、评论/点赞和自己的动态编辑；不伪造真人参与|—|
|H-05A|[x] 已完成|I / B / F|B-07|用户上传图片进入当前人生相册：私有存储、幂等、跨世界隔离、缩略图详情与刷新恢复；不包含图生图|I自审：63项检查、3项真实库、手机/PC上传与恢复、生产构建通过；[报告](task-reports/H-05A.md)|
|H-05|[ ] 待验收|F|H-01|日期相册、照片详情、生成/失败/重试和事件跳转；手机/PC 浏览|6f77460（接续103af3b）；四应用UI/异步回执/草稿与失败恢复；43项检查、构建、四尺寸浏览器通过；原工作树专属报告与apps-*截图；待I真实对接/合并|
|H-06A|[x] 已完成|I / B|W-01A|日历接受/改期/取消真实事务、事件回执、权限隔离及手机接入；不包含后续AI事件推进|I自审：62项检查、3项真实库、手机/PC与生产构建通过；[报告](task-reports/H-06A.md)|
|H-06|[ ] 待开发|B|H-02,W-03|朋友圈互动、日历接受/改期/取消、便签编辑命令；真实存储和权限，相关角色只获知应知变化|—|
|H-07|[ ] 待验收|F|H-01|日历、便签、邀约确认与编辑；契约夹具先行，提议不显示为已接受|6f77460（接续103af3b）；四应用UI/异步回执/草稿与失败恢复；43项检查、构建、四尺寸浏览器通过；原工作树专属报告与apps-*截图；待I真实对接/合并|
|V-03|[ ] 待开发|Q|W-04,H-03,H-04,H-05,H-06,H-07,M-03|真实聊天邀约→日历确认→事件推进→朋友圈/相册/便签联动；通知、未读和失败恢复一致|—|

### L · 导演、时间与多人生

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|L-01|[ ] 待开发|B|V-03|人生列表/切换/重命名/归档、删除和恢复策略；人物、消息、时间和素材权限不串人生|—|
|L-02|[ ] 待开发|B|L-01|历史分支：从基线与事件恢复指定版本，新建人生；旧历史不改写、资源引用受控|—|
|L-03|[ ] 待开发|A|L-02|导演对话调角色/主题/冲突/节奏；区分后续安排与历史改写，重大改写展示影响并建分支|—|
|L-04|[ ] 待开发|B|L-01|时间锚点、暂停/倍速/跳下一事件、离线分块摘要；关键选择停下，多端/重复恢复不重复推进|—|
|L-05|[ ] 待开发|F|V-03|多人生、现实/平行轨迹、导演面板、分支预览和时间界面；当前人生/日期清晰，可先用夹具|—|
|V-04|[ ] 待开发|Q|L-03,L-04,L-05|真实长程游玩、退出恢复、时间跳转、剧情调整、分支与切换；记录一致性与成本|—|

### G · 账号、跨设备与真人相遇

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|G-01|[ ] 待开发|B|B-06|正式账号/登录、游客归并、退出/恢复；会话和归属可验证，不因归并读取他人资料|—|
|G-02|[ ] 待开发|B|G-01,L-01|跨设备同步与冲突处理；未发送草稿与服务端存档区分，旧设备不覆盖新版本|—|
|G-03|[ ] 待开发|B|V-04,G-02|真人参与授权、共享虚构角色卡、成员与撤销；不共享私人访谈/照片|—|
|G-04|[ ] 待开发|B|G-03|共同场景事件/版本、共享时钟/加速规则；幂等分发到各人生、断线接续|—|
|G-05|[ ] 待开发|A|G-04|导演安排自然相遇和缺席/退出策略；每人保持主角身份，真人/AI 参与信息清楚|—|
|G-06|[ ] 待开发|F|V-04|登录/归并、跨端恢复、参与许可、共享预览、共同场景和退出界面；契约夹具可先行|—|
|V-05|[ ] 待开发|Q|G-05,G-06|两个真实账号共同互动；私密数据不可见，并发/重连/拒绝/撤回/退出/共享时间通过|—|

### E · 时间权益与支付

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|E-01|[ ] 待开发|B|V-04,G-01|服务端权益、额度与消费记录；时间权限实际生效，重复请求不重复扣减；不伪称真实购买|—|
|E-02|[ ] 待开发|I|E-01|准备具体收费、支付渠道、订单/退款规则，由用户确定商业选择；未确定时如实保留待办/阻塞|—|
|E-03|[ ] 待开发|B|E-02|支付服务端与界面、签名回调、订单幂等、发权益/退款回收；渠道测试环境验收，实际收费启用另记|—|

### R · 成品质量与发布

|ID|状态|角色|硬依赖|任务与完成标准|交付证据|
|---|---|---|---|---|---|
|R-01|[ ] 待开发|B|V-03|监测告警、成本限制、过载行为、备份恢复、资料导出/删除范围；故障演练记录|—|
|R-02|[ ] 待开发|Q|V-05,E-03,R-01|手机/PC、键盘/读屏、长对话、图片、弱网和跨端完整回归；无假成功、隐私检查通过|—|
|R-03|[ ] 进行中|I|R-01|独立部署环境：Web/Worker/数据库/存储、迁移/密钥/就绪检查/回滚；不用旧项目生产环境|—|
|R-04|[ ] 待开发|I|R-02,R-03|上线与正式地址/关键流程验证、运维和已知问题交接；必要的发布/商业决定明确后执行|—|
|R-05B|[x] 已完成|I|R-05|Vercel latest release; verify deployed UI and honest preview boundary|codex-main-01a0c73b; docs/task-reports/R-05B.md|
|R-05|[x] 已完成|I|—|用户要求提前上传GitHub并部署：独立私有仓库，确认托管目标与后台资源；不冒充完整生产验收|[报告](task-reports/R-05.md)；按用户所选范围完成私有GitHub上传与Vercel网页预览；parallel-life-nu.vercel.app验证通过，完整后台仍由R-03接续|

若收费规则尚未确定，可在已通过 V-01/V-02/V-03 等门槛后交付有界体验版本，记录开放范围。非商业部分仍可开发和专项验收；不能因此勾选 E-03、R-02 或声称“全部产品完成”。

## 5. 通用完成标准

架构复核问题已落实到任务：访谈无 worldId → B-02/B-05；档案被旧回复覆盖 → C-03；长期记忆和输入预算 → W-02；媒体完成影响聊天 → M-03；事实/认知与邀约语义 → P-02/W-01；聊天投影与快照膨胀 → B-02/B-04；初始基线与分支恢复 → D-03/L-02；SQL 完整性 → B-02。不得因为 A-04 已完成就跳过这些业务实现。

每行仅按其列出的范围完成。明确使用夹具的 UI 任务可在界面范围内完成；V 类未通过前，不能说真实产品链路已跑通。

|类型|完成证据|
|---|---|
|文档/契约|文档、数据约定、依赖和链接有效；纯文档不必重跑产品测试|
|业务代码|相关测试、类型/模块检查、构建；输入/权限、失败和恢复完整|
|数据库/任务|真实 PostgreSQL 的事务、RLS、并发、幂等和恢复；内存测试不能替代|
|AI/媒体|实际模型、输入类型、结果/失败、延迟、有依据的用量记录；模拟网关不等于真接通|
|UI|对应尺寸的浏览器检查、输入/返回、加载/失败/恢复；测试与真实结果区分|
|联机/支付|真实双账号或支付渠道测试环境验证；实际收费/上线是否启用另记|
|部署|实际地址、版本、接口和关键流程、回滚方案；本地成功不等于上线|

新代码运行 npm run check、npm run build 和与改动相称的专项检查。仅文档执行结构与链接检查。没有新改动、失败或疑问时，不重复昂贵模型调用和全量测试。

失败时记录复现并保持待验收/需返工，不能删测试或放宽权限伪造完成。外部阻塞写明条件并继续独立工作。

## 6. 领取登记与交付记录

**当前由 codex-main-01a0c73b 集成，用户另开的 Agent 已交付 H-01 待验收。** 实时范围与接续点见下表。

### 当前领取登记（按登记短锁流程更新）

|任务 ID|负责人/任务标识|角色|工作目录|允许写入|独占资源|进展/下一步|
|---|---|---|---|---|---|---|
|USER-ACCEPT-01|codex-main-useraccept01-20261010|根协调 / 文档|主登记目录|docs/DEVELOPMENT.md 本人行和第10节、docs/task-reports/USER-ACCEPT-01.md|无端口/数据库/模型；登记短锁串行|2026-10-10：文档待I集成；第10节10项已上线限定范围+8类未来能力，原报告/路径/差异核对通过，无业务变更。与头像批次串行部署；用户体验结论全部保持待反馈。 I限定文档技术验收：受控899167c/8d0635f已发布原报告，A12最新追加本次记录提交。12项已上线范围/7类未来组，用户A01–A12均待体验；Q仅分析完成，NOTES-WORLD父未实现。|
|LOCK-02|codex-f-lock02-20261009-01|F|/Users/limengzhe/.codex/worktrees/lock-02-notifications/人生剧本|src/features/phone/phone-shell.tsx、phone.module.css、notification-state.ts（如需）、notification-projection.ts；tests/notification-projection.test.ts；docs/task-reports/LOCK-02.md；本人本行登记|3241/55447及浏览器已停止释放；无模型/生产资源|2026-10-09：独立提交675fa87，待I集成caller；360check/build、390/1440及长内容/空态/壁纸失败验证通过；未部署，真实全量通知仍依赖I去除源slice(0,4)|
|NAR-02J|codex-main-nar02j-20260929|I / 单人|主登记目录|src/features/phone/world-phone-app.tsx、src/features/phone/auto-advance.ts、tests/phone-auto-advance.test.ts、docs/{DEVELOPMENT,DEPLOYMENT}.md、docs/task-reports/NAR-02J.md|本地浏览器 390/1440；生产 Supabase 迁移只读核验；Vercel 发布|2026-09-29：已集成验收；应用 6a5c6ac、Production q7cudpjg7 Ready；232 项测试、构建、双端、迁移 29/29，公网 health/首页/分支/访客入口 200|
|NAR-02K|codex-main-nar02k-20260929|I / 单人|主登记目录|world/{domain/{clock,agenda,types,validation,character-policy,reducer},application/{advance-world,actor-context,ports},infrastructure/{turn-planner,postgres-world-repository,clock-repository}}.ts、memory/{application/compile-context,infrastructure/memory-store}.ts、相关 tests、docs/{DEVELOPMENT,DEPLOYMENT}.md、task-reports/NAR-02K.md|本地单元与真实库；生产 Supabase 迁移只读核验；Vercel 发布|2026-09-29：已集成验收；应用 bb79d50、Production miughxi5y Ready；240 常规/36 真实库、build、29 迁移和公网入口通过；旧共享 episode 旁路关闭、旧导演尝试可恢复；剩余边界见报告|
|NAR-02L|codex-main-nar02l-20260929|I / 单人|主登记目录|src/contracts/world-build.ts、src/modules/world/{domain/{types,relationships,reducer},application/resolve-turn.ts,infrastructure/{world-planner,build-handler,postgres-world-repository,turn-planner}.ts}、相关 tests、docs/{DEVELOPMENT,DEPLOYMENT}.md、task-reports/NAR-02L.md|本地单元/真实库；生产迁移只读核验；Vercel 发布|2026-09-29：已集成验收；241 常规/36 真实库、build、29 项生产迁移及合成真实模型通过；bc6a74f/9k8wmhbjq Ready，公网入口通过|
|NAR-02M|codex-main-nar02m-20260929|I / 单人|主登记目录|db/migrations/0030_scheduler.sql、src/modules/world/infrastructure/scheduler-repository.ts、src/server/scheduler.ts、src/app/api/cron/worlds/route.ts、vercel.json、scripts/local-{config,db}.mjs、.local/setup-scheduler.mjs、相关 tests、docs/{DEVELOPMENT,DEPLOYMENT}.md、task-reports/NAR-02M.md|本地与生产 PostgreSQL、Vercel Cron 环境与部署|2026-09-29：已集成验收；242 常规/37 真实库及构建通过；生产迁移 30/30，5e1b75e/mrcsx96x7 Ready，公网定时入口鉴权通过，当前无到期世界|
|NAR-02I|codex-main-nar02i-20260929|I / 单人|主登记目录|src/modules/world/domain/{types,validation,reducer,character-policy}.ts、src/modules/world/application/actor-context.ts、src/modules/world/infrastructure/{turn-planner,build-repository}.ts、src/contracts/world-build.ts、src/features/phone/{world-app-data.ts,apps/types.ts,apps/notes.tsx}、src/app/ui-preview/world/page.tsx、tests/{world,actor-context}.test.ts、tests/integration/{world,world-build}.test.ts、tests/world-app-data.test.ts、tests/world-turn-planner.test.ts、docs/{DEVELOPMENT,DEPLOYMENT}.md、docs/task-reports/NAR-02I.md|本地 PostgreSQL 55432；生产 Supabase 迁移只读核验；Vercel 发布|2026-09-29：已集成验收；应用 37f1499、Production f8cb0hg2z Ready；34 项真实库、构建、真实模型抽样、390/1440 双端、迁移 29/29，公网 health/首页/分支/访客入口 200|
|NAR-02H|codex-main-nar02h-20260928|I / 单人|主登记目录|src/modules/world/infrastructure/build-repository.ts、src/contracts/world-build.ts、src/features/phone/{world-app-data.ts,apps/types.ts,apps/notes.tsx,apps/apps.module.css}、src/app/ui-preview/world/page.tsx、tests/{integration/world-build,world-app-data}.test.ts、docs/{DEVELOPMENT,DEPLOYMENT}.md、docs/task-reports/NAR-02H.md|本地 PostgreSQL 55432；生产 Supabase 迁移只读核验；Vercel 发布|2026-09-28：已集成验收并上线；应用 12696d1、Production 16zvvx6zr Ready，公网 health/首页/分支/访客入口 200；226 常规 + 34 真实库、构建、双端通过|
|NAR-02G|codex-main-nar02g-20260928|I / 单人|主登记目录|src/modules/world/domain/{types,validation,reducer}.ts、src/modules/world/infrastructure/{turn-planner,build-repository}.ts、src/contracts/world-build.ts、src/features/phone/{world-app-data,apps/types,apps/notes}.tsx、相关测试、docs/task-reports/NAR-02G.md、docs/DEVELOPMENT.md、docs/DEPLOYMENT.md|本地 PostgreSQL 55432；生产 Supabase 迁移只读核验；Vercel 发布|2026-09-28：已集成验收并上线；应用5034228、6rhukapfg READY，正式域名200，390/1440无横向溢出；报告记录剩余边界|
|U-06|codex-f-01a0c7c8|F|/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/H-01|docs/task-reports/U-06.md（既有代码已受控集成至主目录；当前无活跃写入）|—|2026-09-28：I核对早期交付已受控集成，归还主目录手机代码写入范围；保留原待验收状态，不冒称用户已确认|
|D-04|codex-main-01a0c73b|I / 单人|主登记目录|src/features/discovery、src/features/api/client.ts、docs/task-reports/D-04.md|本项目本地环境，串行写入|2026-09-22：已按 U-05 重做，保留真实接口；待用户视觉审阅|
|U-05|codex-main-01a0c73b|I / 单人|主登记目录|共享导航与布局、interview/discovery、设计文档及报告|本项目本地环境，串行写入|2026-09-22：恢复固定聊聊/如果/我的；我的整页与聊天共享档案，所有已保存分支集中展示；40项检查及手机PC验证通过|
|U-04|codex-main-01a0c73b|I / 单人|主登记目录|interview、phone-first样式、欢迎预览、设计文档与报告|本项目本地环境，串行写入|2026-09-22：聊天直接进入，姓名生日内嵌选填；我的补充六项资料；四种视口与40项检查、构建通过|
|D-06|codex-main-01a0c73b|I / 单人|主登记目录|world创建契约/仓储/Worker、迁移0006、server/API、discovery/phone入口、测试与文档|本项目本地环境，串行写入|2026-09-22：文字世界创建、快照和手机读取已实现；41单元、11真实库与界面样板通过；Worker被自动审批拦截，待外传授权后真实模型实测|
|H-03|codex-f-01a0c7c8|F|/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/H-01|docs/task-reports/H-03.md（既有代码已受控集成至主目录；当前无活跃写入）|—|2026-09-28：I核对早期交付已受控集成，归还主目录手机代码写入范围；保留原待验收状态，不冒称用户已确认|
|H-05|codex-f-01a0c7c8|F|/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/H-01|docs/task-reports/H-05.md（既有代码已受控集成至主目录；当前无活跃写入）|—|2026-09-28：I核对早期交付已受控集成，归还主目录手机代码写入范围；保留原待验收状态，不冒称用户已确认|
|H-07|codex-f-01a0c7c8|F|/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/H-01|docs/task-reports/H-07.md（既有代码已受控集成至主目录；当前无活跃写入）|—|2026-09-28：I核对早期交付已受控集成，归还主目录手机代码写入范围；保留原待验收状态，不冒称用户已确认|
|U-03|codex-main-01a0c73b|I / 单人|主登记目录|src/components 外层布局、src/app/layout.tsx 与 outer-ui.css、interview/discovery/preview、设计规范与报告；phone目录不改|本项目本地环境，串行写入|2026-09-22：I已受控接入6f77460四应用与开场投影；49项检查及通知直达/草稿/短屏验证通过；UI就绪，W-03/H-06真实写入仍待开发|
|AUD-01|dsh-main-20260923|I / 单人|主登记目录|本地环境启动、合成经历真实调用、docs/task-reports/AUD-01.md|本项目本地 PostgreSQL 55432 与 3218 端口；真实网关调用仅用合成文本|2026-09-23T12:40Z：已完成；迁移 0001–0016 已应用，全链路真实调用证据见报告；本地服务保持运行供用户体验|
|D-08|dsh-main-20260923|I / 单人|主登记目录|src/modules/ai/**、src/modules/world/infrastructure/**、src/modules/discovery/infrastructure/**、src/modules/tasks/application/**、src/contracts/**、tests/**、docs/task-reports/D-08.md|真实网关调用仅用合成经历；本项目 Supabase 生产库只读诊断|2026-09-23T13:10Z：已完成并上线；输出上限与容错解析修复，合格率 4/4；生产部署后完整链路实测通过|
|D-33|dsh-main-20260923|I / 单人|主登记目录|src/features/interview/proposal-thread.tsx、src/features/interview/branch-intent.ts、tests/**、docs/**|生产只读诊断（0 次模型调用）|2026-09-24T22:50Z：已修复并上线|
|D-32|dsh-main-20260923|I / 单人|主登记目录|src/features/interview/branch-intent.ts、src/features/interview/proposal-thread.tsx、tests/branch-intent.test.ts、tests/integration/discovery.test.ts、docs/**|本地 PostgreSQL 55432（无新迁移）|2026-09-24T22:20Z：根因已修复并上线|
|D-31|dsh-main-20260923|I / 单人|主登记目录|src/features/interview/branch-intent.ts、src/features/interview/proposal-thread.tsx、tests/branch-intent.test.ts、docs/**|—|2026-09-24T21:40Z：已修复并上线|
|D-30|dsh-main-20260923|I / 单人|主登记目录|src/features/interview/branch-intent.ts、src/features/interview/interview-app.tsx、src/features/interview/proposal-thread.tsx、tests/branch-intent.test.ts、docs/**|—|2026-09-24T21:00Z：已完成并上线；浏览器点击级验证待补|
|D-29|dsh-main-20260923|I / 单人|主登记目录|src/features/phone/director-panel.tsx、src/features/phone/world-phone-app.tsx、docs/**|本地 PostgreSQL 55432（无新迁移）；生产真实模型调用 0 次（面板读取与暂停）|2026-09-24T20:00Z：已完成并上线，生产实测通过|
|D-28|dsh-main-20260923|I / 单人|主登记目录|src/contracts/world-clock.ts、src/features/api/client.ts、docs/**|—|2026-09-24T19:00Z：客户端能力已上线；UI 挂载待做|
|D-27|dsh-main-20260923|I / 单人|主登记目录|docs/AGENT_DIAGRAMS.md、docs/DEVELOPMENT.md|—|2026-09-24T18:30Z：文档已交付并上线|
|D-26|dsh-main-20260923|I / 单人|主登记目录|docs/AGENT_TARGET.md、docs/DEVELOPMENT.md|—|2026-09-24T18:00Z：文档已交付并上线|
|D-25|dsh-main-20260923|I / 单人|主登记目录|docs/**|—|2026-09-24T17:30Z：文档已修正并上线|
|D-24|dsh-main-20260923|I / 单人|主登记目录|src/modules/world/domain/direction.ts、src/modules/world/infrastructure/direction-repository.ts、src/modules/world/application/advance-world.ts、src/app/api/v1/worlds/[id]/direction/**、src/server/services.ts、db/migrations/0027_world_direction.sql、tests/**、docs/**|本地 PostgreSQL 55432 与生产 Supabase（迁移 0027）|2026-09-24T17:00Z：已完成并上线|
|D-23|dsh-main-20260923|I / 单人|主登记目录|src/modules/world/**、src/modules/memory/infrastructure/memory-store.ts、src/server/services.ts、src/app/api/v1/worlds/[id]/clock/**、tests/**、docs/**|本地 PostgreSQL 55432（无新迁移）|2026-09-24T16:30Z：已完成并上线|
|D-22|dsh-main-20260923|I / 单人|主登记目录|src/modules/world/domain/agenda.ts、src/modules/world/domain/clock.ts、src/modules/world/application/advance-world.ts、tests/**、docs/**|本地 PostgreSQL 55432（无新迁移）|2026-09-24T16:00Z：已完成并上线|
|D-21|dsh-main-20260923|I / 单人|主登记目录|docs/AGENT_FLOW.md、docs/DEVELOPMENT.md|—|2026-09-24T15:40Z：文档已交付并上线|
|D-20|dsh-main-20260923|A / 单人|主登记目录|src/modules/world/domain/clock.ts、src/modules/world/application/advance-world.ts、src/modules/world/infrastructure/clock-repository.ts、src/app/api/v1/worlds/[id]/advance/**、src/server/services.ts、db/migrations/0026_world_clock.sql、tests/**、docs/**|本地 PostgreSQL 55432 与生产 Supabase（迁移 0026）；生产真实模型调用 ≤3 次/次推进|2026-09-24T15:20Z：已完成并上线，生产实测通过|
|D-19|dsh-main-20260923|I / 单人|主登记目录|src/modules/memory/infrastructure/memory-store.ts、src/modules/world/application/resolve-turn.ts、src/server/services.ts、src/app/api/v1/worlds/[id]/messages/route.ts、tests/**、docs/**|本地 PostgreSQL 55432（无新迁移）|2026-09-24T14:30Z：已完成并上线|
|D-18|dsh-main-20260923|I / 单人|主登记目录|src/modules/world/infrastructure/postgres-world-repository.ts、tests/integration/world-memory.test.ts、docs/**|本地 PostgreSQL 55432（无新迁移）|2026-09-24T14:00Z：已完成并上线|
|D-17|dsh-main-20260923|I / 单人|主登记目录|src/modules/memory/**、src/modules/profile/infrastructure/interview-handler.ts、src/app/api/v1/memory/records/**、src/contracts/memory.ts、src/server/services.ts、db/migrations/0024_memory_task_kind.sql、db/migrations/0025_runtime_function_grants.sql、tests/**、docs/**|本地 PostgreSQL 55432 与生产 Supabase（迁移 0024/0025）|2026-09-24T13:30Z：已完成并上线，生产实测通过|
|D-16|dsh-main-20260923|I / 单人|主登记目录|src/modules/tasks/**、src/modules/media/**、src/modules/world/application/resolve-turn.ts、src/server/services.ts、src/server/worker-composition.ts、src/app/api/v1/outbox/drain/**、src/app/api/v1/worlds/[id]/messages/route.ts、src/contracts/api.ts、db/migrations/0022_outbox_consumer.sql、tests/**、docs/**|本地 PostgreSQL 55432 与生产 Supabase（迁移 0022）；生产真实模型调用 1 次（索图回合）|2026-09-24T12:20Z：已完成并上线，生产联动证据齐全|
|D-15|dsh-main-20260923|I / 单人|主登记目录|src/modules/tasks/application/**、src/workers/main.ts、src/modules/world/infrastructure/build-repository.ts、src/app/api/v1/worlds/[id]/route.ts、src/contracts/preview.ts、scripts/ci-db.mjs、.github/workflows/verify.yml、package.json、tests/**、db/migrations/0021_missing_indexes.sql、docs/**|本地 PostgreSQL 55432 与生产 Supabase（迁移 0021）|2026-09-24T03:25Z：已完成；部署构建报 ERROR，已用后续提交重新触发并复核|
|D-14|dsh-main-20260923|I / 单人|主登记目录|src/modules/identity/**、src/server/services.ts、src/app/api/v1/session/route.ts、db/migrations/0020_guest_limits_by_caller.sql、tests/**、docs/task-reports/D-14.md|本地 PostgreSQL 55432 与生产 Supabase（迁移 0020）|2026-09-24T03:10Z：已完成并上线，生产实测通过|
|D-13|dsh-main-20260923|I / 单人|主登记目录|src/modules/world/**、db/migrations/0018-0019、tests/world-retention.test.ts、tests/integration/world-facts.test.ts、docs/task-reports/D-13.md|本地 PostgreSQL 55432 与生产 Supabase（迁移 0018/0019）|2026-09-24T02:55Z：已完成并上线，生产实测通过|
|D-12|dsh-main-20260923|I / 单人|主登记目录|src/contracts/notes.ts、src/modules/world/**、src/app/api/v1/worlds/[id]/notes/**、src/features/phone/**、db/migrations/0017_world_notes.sql、tests/**、docs/task-reports/D-12.md|本项目本地 PostgreSQL 55432 与生产 Supabase（迁移 0017）；真实模型调用仅用合成经历|2026-09-24T02:45Z：已完成并上线，生产实测通过|
|D-11|dsh-main-20260923|I / 单人|主登记目录|src/features/phone/**、tests/world-app-data.test.ts、docs/task-reports/D-11.md|串行写入；未新增迁移|2026-09-24T02:30Z：已完成并上线，生产实测通过|
|D-10|dsh-main-20260923|I / 单人|主登记目录|src/modules/profile/**、tests/fact-quality.test.ts、tests/integration/interview.test.ts、skills-lock.json、.agents/skills/**、docs/**|本地 PostgreSQL 55432 + 生产 Supabase；真实模型调用仅用合成经历|2026-09-24T02:10Z：已完成并上线；沉淀策略与 Neon 清理均已发布|
|D-09|dsh-main-20260923|I / 单人|主登记目录|src/modules/profile/infrastructure/interview-handler.ts、src/modules/tasks/application/run-worker.ts、docs/task-reports/D-09.md|本地 PostgreSQL 55432 + 生产 Supabase（只读诊断）；真实模型调用仅用合成经历与用户本人会话|2026-09-24T02:00Z：已完成并上线；用户卡点已消除，生产端到端验证通过|
|D-07|dsh-main-20260923|I / 单人|主登记目录|src/features/interview/**、tests/branch-entry.test.ts、src/app/phone-first.css、docs/task-reports/D-07.md|串行写入；复用既有 API，未新增迁移|2026-09-23T13:10Z：待验收；入口门控+失败可见可重试已完成并随本次发布上线；生产实测通过；待用户实机确认视觉|

开始时登记基线提交（Git 建立后）、依赖、具体文件、端口/数据库资源与验收方式。单人也登记。临时需要改公共文件由 I 协调并更新允许范围，避免覆盖他人工作。

### 每项交付记录必须包含

- 任务 ID，负责人/任务标识，工作树。
- 起始基线与交付提交；无 Git 时写“尚无 Git，以文件和验证记录为准”。
- 交付物、修改文件和实际验证结果。
- 真实模型、数据库、浏览器分别是否已验证。
- 未完成项、已知问题、接口变更和兼容方式。
- 集成人、集成提交、最终状态与日期、对后续任务的影响。

详细记录可放专属 docs/task-reports/任务ID.md，总表保留结论和链接。无证据不能编造提交、模型成功或测试结果。记录不含 API Key、私人照片内容或完整访谈。

### 已完成交付记录

|任务|执行/验收人|结果与证据|完成日期|
|---|---|---|---|
|D-33|dsh-main-20260923 / 用户报告 + 根因定位|修复 UI 侧两处根因（过期 discovery 版本、失败提示被条件挡住）；用户真实数据诊断证明服务端正常；178 单元 + 25 真实库测试通过；[报告](task-reports/D-33.md)|2026-09-24|
|D-32|dsh-main-20260923 / 用户报告 + 根因定位|修复分支请求的前置条件不匹配（实时画像版本 + 对话 brief + 冲突重试 + 明确失败文案）；真实库回归复现根因；178 单元 + 25 真实库测试通过；[报告](task-reports/D-32.md)|2026-09-24|
|D-31|dsh-main-20260923 / 用户报告 + 自审|修复创建分支被"打开已有分支"吞掉；177 单元测试通过（含回归）；[报告](task-reports/D-31.md)|2026-09-24|
|D-30|dsh-main-20260923 / 自审|对话中分支意图分流（创建/推荐/进入）；175 单元 + 24 真实库测试通过；浏览器点击级验证待补；[报告](task-reports/D-30.md)|2026-09-24|
|D-29|dsh-main-20260923 / 自审（生产实测）|导演面板真实可用（时间/暂停/倍速/推进/导演要求/影响预览）；分支链路端到端复核通过；[报告](task-reports/D-29.md)|2026-09-24|
|D-28|dsh-main-20260923 / 自审|手机接线的客户端能力（契约 + 6 方法）；UI 挂载推迟并给出落点与验收口径；[报告](task-reports/D-28.md)|2026-09-24|
|D-27|dsh-main-20260923 / 自审|展示用 Agent 流程图集（纯 Mermaid 11 张，面向领导与用户，不含技术路径）；[AGENT_DIAGRAMS.md](AGENT_DIAGRAMS.md)|2026-09-24|
|D-26|dsh-main-20260923 / 自审|预期架构与预期效果（[AGENT_TARGET.md](AGENT_TARGET.md)），含目标架构图、导演循环、记忆模型、可验收效果指标与 4 张出图提示词|2026-09-24|
|D-25|dsh-main-20260923 / 自审|文档事实校准（AUD-18 过度声明、计数过时）+ 手机端接线方案；[报告](task-reports/D-25.md)|2026-09-24|
|D-24|dsh-main-20260923 / 自审|L-03 导演控制面：主题/节奏/聚焦 + 影响预览（不落库）+ 历史改写拒绝并指向分支；172 单元 + 24 真实库测试通过；迁移 0027 已上生产；[报告](task-reports/D-24.md)|2026-09-24|
|D-23|dsh-main-20260923 / 自审|导演记忆化（承诺驱动）+ 时钟控制接口（暂停/倍速/读取）+ 离线摘要入记忆；167 单元 + 24 真实库测试通过；[报告](task-reports/D-23.md)|2026-09-24|
|D-22|dsh-main-20260923 / 自审|导演 agenda：未了结的事优先决定谁说话；165 单元 + 24 真实库测试通过；[报告](task-reports/D-22.md)|2026-09-24|
|D-21|dsh-main-20260923 / 自审|展示版架构与全流程图（[AGENT_FLOW.md](AGENT_FLOW.md)），含 8 张图的 GPT 出图描述|2026-09-24|
|D-20|dsh-main-20260923 / 自审（生产库核对）|Phase 2 骨架：世界时钟 + 有界导演节拍（≤3 拍、不连续同一人、舞台指示、每拍走回合流水线）；162 单元 + 24 真实库测试通过；生产实测版本 7→10、时钟落库；[报告](task-reports/D-20.md)|2026-09-24|
|D-19|dsh-main-20260923 / 自审|检索统一：记忆按作用域与遗忘屏蔽进入角色上下文，并接进世界回合；154 单元 + 23 真实库测试通过；[报告](task-reports/D-19.md)|2026-09-24|
|D-18|dsh-main-20260923 / 自审|Phase 1 收尾（世界侧）：回合认知与事件进入记忆库（character/branch 作用域 + 真实来源 + 重复合并）；154 单元 + 22 真实库测试通过；[报告](task-reports/D-18.md)|2026-09-24|
|D-17|dsh-main-20260923 / 自审（生产库核对）|Phase 1 记忆接线 + 修正/遗忘 API + 修复运行角色函数权限回归；迁移 0024/0025 已上生产；152 单元 + 21 真实库测试通过；[报告](task-reports/D-17.md)|2026-09-24|
|D-16|dsh-main-20260923 / 自审（生产库核对）|Phase 0 执行层：outbox 消费者 + 媒体 handler + 回合索图接线；生产实测完整链路（派发 submitted → 任务 queued → 执行后诚实失败，0 假图）；并修复媒体 scope 契约误当 uuid 的生产 bug；[报告](task-reports/D-16.md)|2026-09-24|
|文档|dsh-main-20260923 / 自审|整合 Agent 编排设计：[AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md)（6 个模型 Agent + 2 个引擎的名册与调用契约、分期规划映射到 L-04/W-04/L-03/W-02/W-03/AUD-03/M-01..M-03/G-04/G-05、四项待产品决策与推荐默认值、已核实的差距清单）|2026-09-24|
|D-15|dsh-main-20260923 / 自审|一批整改：交付门槛+CI、Worker drain、索引与 N+1、非法 ID 404；117 单元 + 17 真实库测试通过；迁移 0021 已上生产；[报告](task-reports/D-15.md)|2026-09-24|
|D-14|dsh-main-20260923 / 自审（生产库探测）|AUD-15 访客创建改为按调用者限流（加盐哈希分桶 + 全局上限 + 额度归还）；迁移 0020 已上生产；113 单元 + 17 真实库测试通过；生产函数探测符合设计；[报告](task-reports/D-14.md)|2026-09-24|
|D-13|dsh-main-20260923 / 自审（生产库核对）|AUD-09 世界事实容量：事实改投影 + 有界窗口；真实库测试 16 轮≈390KB 事实后仍可持续提交、128 条事实全部可查；迁移已上生产，生产回合正常；[报告](task-reports/D-13.md)|2026-09-24|
|D-12|dsh-main-20260923 / 自审（生产用用户本人会话实测）|便签改为服务端持久化（world_notes 投影 + 命令/回执 + 每条便签版本），不再只写 localStorage；迁移 0017 已应用于本地与生产；107 单元 + 15 真实库测试通过；[报告](task-reports/D-12.md)|2026-09-24|
|D-11|dsh-main-20260923 / 自审（生产用用户本人会话实测）|手机内消息不再谎报已发送（失败可见可重试）、便签如实说明本机存储、去掉伪造日程通知与跨人日历卡；103 单元测试与构建通过；[报告](task-reports/D-11.md)|2026-09-24|
|D-10|dsh-main-20260923 / 自审（生产用全新访客验证）|资料沉淀改为「该记的自动写入、噪声与重复不落档案」；102 单元 + 14 真实库测试通过；生产档案同类别近重复 0、待确认 0；Neon 已清理；[报告](task-reports/D-10.md)|2026-09-24|
|D-09|dsh-main-20260923 / 自审（生产用用户本人会话验证）|访谈重试必然失败（handler 直写 confirmed 被领域规则拒绝，整事务回滚）；改为只登记 suggested 候选 + 脱敏诊断；生产端到端通过：重试 12s → 候选 → 档案 → 生成 25s → 进手机 → 角色回复；[报告](task-reports/D-09.md)|2026-09-24|
|D-08|dsh-main-20260923 / 自审|世界生成可用性：4096 截断与严格解析导致生产失败；改为 8192/6144 上限 + 容错解析 + `AI_TRUNCATED`；真实网关合格率 4/4，93 项检查与构建通过；[报告](task-reports/D-08.md)|2026-09-23|
|AUD-01|dsh-main-20260923 / 自审（用户已授权真实调用）|本地合成经历全链路真实模型复核：访谈 4–11s、方向 14–19s、世界生成 21s、世界内角色回复 6.7s，任务均 succeeded；[报告](task-reports/AUD-01.md)|2026-09-23|
|A-01|当前主任务 Codex / 用户确认|产品与设计基线；对话确认|2026-09-22|
|A-02|当前主任务 Codex / 自审|README 验证记录；构建与本地 HTTP 200|2026-09-22|
|A-03|当前主任务 Codex / 自审|世界内核和测试仓储；真实持久化另列 B-04|2026-09-22|
|A-04|当前主任务 Codex / 自审|架构复核，三项先复现后修复；18 项测试及构建通过|2026-09-22|
|A-05|当前主任务 Codex / 自审|本文、README、AGENTS；64 项编号/状态/依赖/引用检查通过；无 Git，未启动并行任务|2026-09-22|
|A-06|codex-main-01a0c73b / 自审|项目说明、通用提示词、模板及登记规则；65 项依赖/链接校验和短锁竞争检查通过；[交付报告](task-reports/A-06.md)|2026-09-22|
|P-01|codex-main-01a0c73b / 自审|66035ae；42 个已追踪文件的忽略与凭据检查通过；[报告](task-reports/P-01.md)|2026-09-22|
|P-02|codex-main-01a0c73b / 自审|共享运行时校验、22 项测试及构建通过；[报告](task-reports/P-02.md)|2026-09-22|
|P-03|codex-main-01a0c73b / 自审|LOCAL_DEVELOPMENT.md；单人/并行步骤与主表一致；[报告](task-reports/P-03.md)|2026-09-22|
|B-01|codex-main-01a0c73b / 自审|独立 PostgreSQL 18.4；22 项测试及构建通过；[报告](task-reports/B-01.md)|2026-09-22|
|B-02|codex-main-01a0c73b / 自审|真实 PostgreSQL 约束/回滚/隔离测试、22 项测试与构建通过；[报告](task-reports/B-02.md)|2026-09-22|
|B-03|codex-main-01a0c73b / 自审|24 项单元测试、2 项真实库集成测试与构建通过；[报告](task-reports/B-03.md)|2026-09-22|
|B-04|codex-main-01a0c73b / 自审|24 项单元、3 项真实库测试与构建通过；[报告](task-reports/B-04.md)|2026-09-22|
|B-05|codex-main-01a0c73b / 自审|25 项单元、4 项真实库测试与构建通过；[报告](task-reports/B-05.md)|2026-09-22|
|B-06|codex-main-01a0c73b / 自审|25 项单元、5 项真实库测试与构建通过；[报告](task-reports/B-06.md)|2026-09-22|
|C-01|codex-main-01a0c73b / 自审|真实文字 2 次：14.7/8.1 秒；来源与个性化审阅通过；[报告](task-reports/C-01.md)|2026-09-22|
|P-04|codex-main-01a0c73b / 自审|29 项单元、边界/类型与构建通过；[报告](task-reports/P-04.md)|2026-09-22|
|C-02|codex-main-01a0c73b / 自审|29 项单元、6 项真实库测试及构建通过；[报告](task-reports/C-02.md)|2026-09-22|
|C-03|codex-main-01a0c73b / 自审|30 项单元、7 项真实库测试与构建通过；[报告](task-reports/C-03.md)|2026-09-22|
|B-07|codex-main-01a0c73b / 自审|30 项单元、8 项真实集成与构建通过；[报告](task-reports/B-07.md)|2026-09-22|
|U-01|codex-main-01a0c73b / 自审|手机/桌面组件、弹窗焦点/Esc、30 项测试与构建通过；[报告](task-reports/U-01.md)|2026-09-22|
|U-02|codex-main-01a0c73b / 自审|390/768/1440 布局、档案后退和构建通过；[报告](task-reports/U-02.md)|2026-09-22|
|C-04|codex-main-01a0c73b / 自审|真实 AI 浏览器链路及默认 fetch 回归；31 项测试和构建通过；[报告](task-reports/C-04.md)|2026-09-22|
|C-05|codex-main-01a0c73b / 自审|32 项单元、8 项真实库、构建及手机/桌面事件人物照片通过；[报告](task-reports/C-05.md)|2026-09-22|
|V-01|codex-main-01a0c73b / 自审|首阶段真实访谈闭环验收通过；32 项单元、8 项真实库、手机/PC 与恢复通过；[报告](task-reports/V-01.md)|2026-09-22|
|D-01|codex-main-01a0c73b / 自审|来源与版本校验、不同经历真实推荐、35 项单元和9项真实库通过；[报告](task-reports/D-01.md)|2026-09-22|
|D-02|codex-main-01a0c73b / 自审|明确选择的设定快照、版本/权限与10项真实库通过，视觉另列U-05；[报告](task-reports/D-02.md)|2026-09-22|
|R-05|codex-main-01a0c73b / 自审|按用户所选范围完成私有GitHub上传与Vercel网页预览；parallel-life-nu.vercel.app验证通过，完整后台仍由R-03接续；[报告](task-reports/R-05.md)|2026-09-22|
|H-06A|codex-main-01a0c73b / 自审|62项单元、3项真实库、浏览器和构建通过；[报告](task-reports/H-06A.md)|2026-09-22|
|H-05A|codex-main-01a0c73b / 自审|用户上传入相册、63项单元、3项真实库、手机/PC与构建通过；[报告](task-reports/H-05A.md)|2026-09-22|

### 变更日志

- 2026-09-24：修复 UI 侧根因（D-33）——"已有世界时说创建分支，只弹出进入已有分支"。先用用户真实数据证明服务端正常（202 接受，且尚有 2 个未采用方向），再定位 UI 两处：① `confirmAndBuild` 把 `data?.version`（在 `setData` 生效前读取）作为 discovery 版本发给服务端 → VERSION_CONFLICT，建世界失败；② 失败与进度提示只在"未生成世界"的分支里渲染，已有世界时全部不可见，用户只看到"进入体验"卡片。现改为显式传递刚返回的版本、进度/错误在任何状态都显示、并放宽识别措辞。178 单元 + 25 真实库测试与构建通过。

- 2026-09-24：根因修复"对话中让 Agent 直接生成分支不生效"（D-32）。服务端要求"存在已确认事实或非空 brief"且画像版本必须一致，而 UI 传的是**可能过期的画像版本 + 空 brief**，导致分别返回 `VERSION_CONFLICT` / `INVALID_INPUT`，又被 UI 折叠成一句静默的"这次没有完成"——所以功能看起来"根本没做"。现改为：每次请求前重读最新画像与 discovery 版本；用**用户最近说过的话**生成 brief（聊天几句即可具备生成分支的依据）；`VERSION_CONFLICT` 自动重试一次；失败文案改为可行动（告诉用户还差什么）。新增真实库回归直接复现根因并证明修复。178 单元 + 25 真实库测试与构建通过；点击级验收待补。

- 2026-09-24：修复用户报告的"说创建分支却打开已有分支"（D-31）。根因是我上一轮实现的两处缺陷：① 意图处理里"已有世界就直接打开"的捷径排在创建之前，导致创建逻辑走不到；② 选择方向时总取第一个、不检查该方向是否已被采用。现改为：创建意图优先处理；新增 `chooseUnbuiltDirection` 跳过已采用方向、优先用户当前选择；全被采用则重新推演；仍无可用则打开选择框而不是重开旧人生。推荐意图改为优先展示方向。177 单元测试（含该 bug 的回归用例）与构建通过；点击级验证待补。

- 2026-09-24：对话中主动推荐分支 / 一句话创建并进入（D-30）。新增可测试的分支意图路由（进入 / 创建 / 推荐 / 无关），覆盖"帮我创建一个分支""给我建个分支""我想试试另一条路""有什么分支吗""推荐一下"等原先**完全无反应**的说法；访谈页按意图分流：明确要创建 → 先推演（如需要）→ 直接建世界并进入体验；只说看看 → 只展示（保留确认模态）；进入类优先且不花钱。176 单元 + 24 真实库测试与构建通过；浏览器点击级验证待补。

- 2026-09-24：导演能力做到用户可用（D-29）。手机里原有的"导演"面板只是视觉稿，现替换为真实控制面板：显示真实故事时间/速度/暂停与上次离线摘要，支持暂停/继续、1×/2×、"让世界走一会儿"（如实回报几件事、几拍合成摘要），导演要求（主题/节奏/聚焦谁）支持"先看影响"再应用，并明示历史不改写、改写请建分支。生产实测：面板可用并显示真实故事时间；**暂停/倍速/推进的 UI 点击级验证未确证，如实记录为待验证**。同时用本地端到端脚本复核"访谈→分支→建世界→进入→角色回复→便签"全链路通过（浏览器点击级验证待补，如实记录）。

- 2026-09-24：手机端接线的客户端能力（D-28）。新增 `world-clock` 契约与 6 个客户端方法（时钟读写、推进、导演 brief 读写含 `preview`/`move`、记忆列举与纠正遗忘），全部带运行时校验；**刻意不动手机投影契约**以避免"契约变更打断全仓编译"。手机 UI 未挂载：手机壳与应用正被并发执行者连续大改，且挂载需改 5 个共享落点并做浏览器验证，本轮预算内无法保证"验证后再声明"，故如实推迟并写明落点与验收口径。

- 2026-09-24：新增展示用流程图集 [AGENT_DIAGRAMS.md](AGENT_DIAGRAMS.md)（D-27）。11 张纯 Mermaid 图（总览/职责/信息路径/分支到人生/世界内对话/导演循环/时间/记忆一生/隔离/指挥导演/三条底线），**刻意不含任何接口路径、数据库与技术栈细节**，每图配一句话说明，可直接渲染或交给 GPT 出图。

- 2026-09-24：新增预期（目标态）架构文档 [AGENT_TARGET.md](AGENT_TARGET.md)（D-26）。与已实现的 AGENT_FLOW 区分：本文描述**想要的系统**——9 条用户可感预期效果及其可验收口径、目标分层架构图与三条不可协商红线（隔离/提案制/成本边界）、真实侧与虚构侧的目标时序（Mermaid）、导演目标工作循环、记忆模型、效果指标表、与现状的差距（逐项映射 M-01..M-03、G-01..G-05、E/R、AUD 项），以及交给 GPT 出图的 4 张精确提示词。

- 2026-09-24：文档事实校准（D-25）。发现并修正 AUD-18 的过度声明（"20 项审计全量收口、150 项测试"）——真实为 172 单元 + 24 真实库测试、27 个迁移，AUD-04/11/14/16/19/20 仍待开发；同步 AGENT_FLOW 的计数与状态表；并给出手机端四项能力（时间控件/导演面板/记忆界面/索图结果）的可执行接线方案与协作注意事项（契约变更须补全构造点、先确认无在途改动）。

- 2026-09-24：L-03 导演控制面（D-24）并上线。新增 `world_direction`（迁移 0027）保存用户对导演的要求：主题、节奏（slow/normal/fast **作为节拍硬上限**）、聚焦角色（最多 3 人，进入选人，优先级在"未了结的事"之后）；`preview: true` **只描述影响不落库**；`move: "past"` **明确拒绝**并提示建立分支保留原人生；导演要求会写进角色的舞台指示，且只有被聚焦的角色被告知出场。172 单元 + 24 真实库测试通过。遗留：完整改写影响对比视图、手机端控制界面。

- 2026-09-24：导演记忆化与时钟控制面（D-23）。角色承诺（`commitment` 记忆）进入 agenda，优先级"欠回应 > 未定约定 > 承诺 > 沉默最久"；离线摘要写入 `branch` 作用域的 `summary` 记忆（经端口由组装层实现）；新增 `GET/POST /api/v1/worlds/:id/clock` 支持暂停/倍速/读取，控制变更不动 `lastTickAt`（不丢时间、不造时间），暂停的世界推进 0 拍且零模型调用。167 单元 + 24 真实库测试通过，无新增迁移。

- 2026-09-24：导演接 agenda（D-22）。新增纯函数 `buildAgenda`（欠回应的人 / 未定约定），选人顺序改为"未了结优先，其次沉默最久"，舞台指示写明具体未了之事；真实库测试证明存在 `proposed` 约定时第一拍就是该参与者。165 单元 + 24 真实库测试通过，无新增迁移。

- 2026-09-24：新增展示版 [AGENT_FLOW.md](AGENT_FLOW.md)（D-21）：面向用户与领导的分层架构图、6 Agent + 2 引擎名册、7 个场景时序（访谈沉淀、分支、建世界、NPC 回合、索图、离线导演节拍、记忆纠正）、真实↔虚构数据边界说明、现状与未完成清单，以及交给 GPT 出图的 8 张图精确描述。同时明确纠正"项目只有两个 Agent"的说法：是两个隔离的世界 + 一个导演层 + 一条共用流水线。

- 2026-09-24：Phase 2 时钟 + 导演骨架（D-20）并上线。世界首次拥有权威时钟（迁移 0026：`world_clock` + `world_beats`）：默认 1:1、可倍速/暂停、离线只播 **≤3 拍**其余折进摘要、故事时间始终追上现实；导演按"沉默最久、不连续同一人"选角色，并给角色**舞台指示**而非冒充用户开口；每一拍都走既有回合流水线（回执/投影/outbox/记忆全部继承），`POST /api/v1/worlds/:id/advance` 暴露推进。生产实测：版本 7→10、3 拍、时钟与故事时间落库。162 单元 + 24 真实库测试通过。遗留：L-03 控制面、agenda、手机端时间控件与摘要呈现。

- 2026-09-24：检索统一（D-19，Phase 1 完成）。角色回合按作用域加载记忆：只含该角色的 character 记录与本世界的 branch episode，`profile` 私有记录从不进入；被遗忘记录不出现在上下文且**其来源被屏蔽**；`superseded` 记录不计入；加载器经 owner 作用域事务接进世界回合（未提供端口时行为不变）。154 单元 + 23 真实库测试通过。Phase 1 仅剩手机端记忆界面。

- 2026-09-24：Phase 1 收尾（世界侧，D-18）。世界回合在同一事务内写入两类记忆：角色自己的印象（character 作用域，来源=该角色本轮回复消息）与本轮事件（branch episode，来源=本轮 world_event），复用共享写入器做重复合并；来源全部经数据库触发器校验，失败与回合一起回滚。Phase 1 仅剩「检索统一（compileCharacterContext 接进世界回合）」与「手机端记忆界面」。154 单元 + 22 真实库测试通过。

- 2026-09-24：Phase 1 记忆接线（D-17）并上线。队列首次允许 `memory` 任务；新增共享记忆写入器，同作用域同类型的重复表述**合并来源**而不是重复沉淀；访谈抽取同时写入 profile 作用域记忆（来源为真实访谈消息，零额外模型调用）；新增 `POST/GET /api/v1/memory/records` 让用户纠正（旧记录 superseded）与遗忘（隐藏但不删除）。同时修复并发安全加固迁移造成的生产回归：`REVOKE ... FROM PUBLIC` 后两个运行角色都无法执行触发器与 CHECK 依赖函数（新访谈、记忆候选写入会失败），迁移 0025 显式补回普通辅助函数权限，并新增真实库守卫测试防止再次发生。152 单元 + 21 真实库测试通过。

- 2026-09-24：完成 Phase 0 执行层并上线（D-16，AUD-03 待验收）。`outbox_jobs` 首次拥有消费者：迁移 0022 增加 attempts/lease/last_error 与按 owner 作用域的领取函数，派发以 job id 为幂等键、内因失败有限重试、确定性原因永久失败并记录原因；新增 `media` handler（媒体适配器未接入时**如实失败**，不造假图、请求保持 pending）；世界回合在索图意图下产生 `media.requested`；新增 owner 级 `POST /api/v1/outbox/drain`，消息路由提交后自动派发。生产实测链路打通，并修掉"媒体 scope 被当 uuid 校验"导致持久任务永不执行的契约 bug（新增真实库回归用例）。134 单元 + 18 真实库测试通过。

- 2026-09-24：新增 [docs/AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md)——整合 Agent 编排设计供其他执行者交接讨论：明确"6 个模型 Agent（个人向导/人生探索/世界创建/导演/NPC 角色/记忆服务）+ 2 个确定性引擎（世界时钟调度器、运行时校验与执行器）"，逐项给出职责边界、触发方式、任务种类与 handler、输入输出 effect 词表、模型调用上限、幂等与失败语义、现状（已有/缺失）；并给出 Phase 0–4 分期（映射既有任务 ID：AUD-03、W-02/W-03、W-04、L-04、L-03、M-01..M-03、G-04/G-05）与四项待产品决策的推荐默认值。

- 2026-09-24：批量完成四项审计整改（D-15）：① AUD-17 交付门槛——新增 `npm run verify`（单元 + 真实库）、GitHub Actions 工作流（postgres service + `scripts/ci-db.mjs`）、预览开关收敛为 `isPreviewOnly()` 并加测试；② AUD-12 Worker 停机——新增 `run-loop`，停机后不再领新任务并给在途任务有界宽限期，超时才中止并记 unknown，心跳不再续租已放弃的工作；③ AUD-13 索引与 N+1——迁移 0021 补 7 个索引，分支列表由约 200 次往返改为单条 JOIN；④ AUD-08 非法 world id 返回 404。本次部署构建报 ERROR（原因未给出），别名暂留上一版，已用后续提交重新触发并复核。

- 2026-09-24：完成 AUD-15 访客创建限流（D-14）并上线。原来单一全局计数器（60/小时）可被一个调用者耗尽，导致全站新用户被拒——这在跑真实库测试时已真实发生。现改为按调用者分桶（地址仅存加盐哈希）+ 更宽的全局上限（600/小时），被全局上限拒绝时归还调用者额度；`ensureGuest` 恢复为纯幂等建号，内部调用与测试不再消耗公共额度。迁移 0020 已应用于本地与生产。

- 2026-09-24：完成 AUD-09 世界事实容量墙（D-13）并上线。事实从 `worlds.state` 移到 `world_facts` 投影表（迁移 0018 含既有事实回填，0019 放宽单条大小），内存窗口按字符预算有界保留（基准事实始终保留、其余保留最新），快照不再携带事实，超限时改为明确领域错误。真实库容量测试：16 轮 × 8 条 × 3000 字（≈390KB）连续提交全部成功、快照 1.2KB、128 条事实可查。生产已应用迁移并实测回合正常（version 5→6）。顺带确认 AUD-15 全局访客配额是真实风险：本次测试就把它耗尽。

- 2026-09-24：便签真实持久化（D-12）并上线。新增 `world_notes` 投影表（迁移 0017，已应用于本地与生产 Supabase）、`POST /api/v1/worlds/:id/notes` 命令与回执、每条便签自己的版本号（乐观并发），前端改为读取服务端便签并在失败时如实报错。便签不写入 `worlds.state`，快照不再随便签增长。生产实测：创建 → 重载仍在 → 更新 → 旧版本被拒。

- 2026-09-24：修复"伪造成功"类问题（D-11）并上线：手机内消息改为按真实状态显示（发送中/已发送/失败可重试，失败时保留文本并显示重试按钮），便签不再谎称已保存而是如实说明仅存本机，去掉无邀约时伪造的日历通知与跨联系人的日历卡错配，前端不再二次偏移开场时间。便签真实持久化另立 D-12。

- 2026-09-24：按用户反馈优化资料沉淀（D-10）：只提炼长期有价值的信息；噪声（寒暄/情绪/临时状态/AI 自己的话）、假设、基础资料卡已覆盖的内容不落档案；同一件事换个说法只合并来源、不再新增；提炼后直接写入档案，取消逐条采纳。流式与重试两条路径行为统一。同时按用户说明清理 Neon：唯一数据库与素材存储为 Supabase，删除 Neon 技能与本地陈旧凭据。生产已验证（全新访客：自动写入、待确认 0、同类别近重复 0）。

- 2026-09-24：**用户实际卡点已修复并上线**。用户在生产的访谈第一步反复失败（「重新回应」从不成功），根因是重试走的 Worker handler 把候选直接写成 confirmed，被记忆领域规则拒绝并回滚整个事务。已改为只登记 suggested 候选（与流式路径一致、符合「AI 只提议、用户确认」），并让失败输出脱敏诊断、业务错误不再伪装成 AI_FAILED。生产端到端验证（用户本人会话）：重试 12s 成功 → 5 条候选沉淀 → 确认 3 条 → 分支入口解锁 → 25s 生成世界进入手机 → 手机内角色真实回复。覆盖该路径的真实库测试早已存在但被 `npm run check` 跳过、仓库无 CI（AUD-17），这是它漏出去的原因。

- 2026-09-23（续）：**公网完整链路实测通过**：访谈 7s → 候选确认 → 方向 23s → 世界生成 28s → 进入手机 → 世界内 4.7s 收到角色回复。期间发现并修复两点：① 世界生成在生产失败（4096 输出上限被推理撑爆 + 严格 schema 拒收多余字段，合格率 1/3、2/5 → 修复后 4/4，并加一次结构不合法时的纠正重试，超时仍不重试）；② 另一个执行者在 `38b96d0` 引入"打开页面即自动重试 failed/unknown 生成任务"，违反"unknown 不自动重付"，已改回显式重试。同时发现**同一目录确有并发执行者**（`38b96d0`、`8abfb80`、`0ab19fe` 由同一身份在其会话中提交并推送，且 `38b96d0` 把我当时未提交的在途改动一并提交），未按登记短锁串行，请用户知晓。

- 2026-09-23：用户要求"每次完成之后部署上线"，已写入 AGENTS.md 与 docs/DEPLOYMENT.md 作为常驻规则，并立即执行一次：推送 `ffeef0c` 触发生产部署（`dpl pwcht886j` Ready），线上不再是旧的预览版。**上线实测发现世界创建在生产失败**（`INVALID_AI_OUTPUT`），根因是模型输出固定 4096 上限被推理+正文撑爆（`finish=length`）加上严格 schema 拒收多余字段；新增 D-08 修复（世界 8192、方向 6144、容错解析、截断单列 `AI_TRUNCATED`、失败也记录模型与耗时），真实网关合格率由 1/3、2/5 提升到 4/4，93 项检查与构建通过，随后再次发布。

- 2026-09-23：AUD-01 完成（本地真实模型全链路可复现证据）；D-07 交付待验收：修复"对话后点一键分支却没有进入手机"的真实缺陷——根因是入口在 0 条已确认资料时就出现、模型输出不合格后前端静默跳转。现改为有依据才可点、无依据时引导确认记录、失败原地可见可重试。本地服务（3218 + 55432）保持运行供用户实机体验；线上版本尚未包含世界对话与本次修复。

- 2026-09-23：用户要求"现在就能体验：从对话直接生成分支并进入手机，且手机内可真实对话"。新增 D-07（对话内一键生成并进入，复用既有 approveSeed/createWorld/同步任务路径），并把 AUD-01（真实模型世界创建实测）从待开发改为进行中，负责人 dsh-main-20260923。另一个任务在主目录的写入已停止，本轮由单人执行并自审。生产环境当前仍在运行较早的发布（`/api/v1/worlds/:id/messages` 返回 404），世界对话能力尚未上线。

- 2026-09-22：用户要求 Zeta 式全程手机 App，废止 PC 双栏/宽屏推荐。D-04 需返工，新增 U-03 至 U-07，总计 71 项。保留 H-01 外部交付与归属；本轮交付方案及提示词，未派发。

- 2026-09-22：推荐/设定选择与世界生成进度有不同后端依赖，将 D-04 中的世界生成进度拆为 D-05，V-02 同时依赖它；需求未删减。总表现有 66 项。

- 2026-09-22：阶段清单扩充为唯一任务总表，增加编号、依赖、完成标记、单人/多人规则、文件/资源分工与交付记录；新业务任务未假定已实现。
- 2026-09-22：A-05 完成文档验收；历史成果 A-01 至 A-04 依据既有记录标记完成，其他业务任务保持待开发。
- 2026-09-22：A-06 经进行中→待验收→已完成；增加新 Agent 项目说明、可复用提示词、报告模板与短锁登记。任务总数现为 65，6 项基础/文档任务完成，59 项业务/准备任务待开发。

- 2026-09-22：P/B/U/C 和 V-01 已完成，累计 25 项（含原有 6 项规划/基础），其余 40 项仍待开发。真实文字、持久化与首阶段 UI 已验证；没有自动派发下一批任务。

## 7. 下一位执行者如何接手

以主目录本文作为任务状态源。先读 PROJECT_BRIEF.md，确认工作目录和领取登记，只改已登记文件。单人从最早满足依赖的任务推进；多人接受 I 分配或按登记短锁领取未占用任务，不依据旧副本抢任务。公共契约先协调，真实阻塞登记，继续可独立工作。交付说清“做了什么、验证了什么、还缺什么”，先标待验收，集成检查后才勾选。不要重复任何已完成任务，不把新需求视为取消旧需求。

- 2026-09-22：为先跑通可体验主线，新增 D-06 文字世界创建，D-03 保留媒体集成验收，未取消图片或角色功能。总计72项。

- 2026-09-22：用户明确要求上传与部署，新增R-05提前发布接入任务；R-03/R-04完整生产验收仍保留。总计73项。

- 2026-09-22：I验收H-01主线既有基础；U-06锁屏仍待合并。H-03/H-05/H-07交codex-f-01a0c7c8按PHONE_APPS_HANDOFF.md开发，主任务负责真实接入。

## 8. 审计整改队列（按用户要求追加在任务清单末尾）

来源与复核：[DeepSeek审计登记](DEEPSEEK_AUDIT_2026-09-22.md)。此队列不替代已有功能任务，不自动按附件建议改变执行顺序；每项先复现再修复，重复问题归并验收。

|任务ID|状态|角色|依赖|任务与验收要求|交付/接续|
|---|---|---|---|---|---|
|AUD-01|[x] 已完成|I|D-06|真实模型世界创建实测；沿用审批边界，记录合成经历、恢复与费用结果|[报告](task-reports/AUD-01.md)；本地合成经历全链路独立复核：访谈流式 4–11s、3 个方向 14–19s、世界生成 21s、世界内角色回复 6.7s，任务均 succeeded；未启动常驻 Worker（走同步任务路径）；网关不返回费用，未声称金额|
|AUD-02|[x] 已完成|B|—|排队超时/Worker不可用的明确提示与恢复，不无限计时误导|升级 `Waiting` 组件状态机：queued 超过 25s 提示通道繁忙调度中、深度推演超过 45s 提示稍长、超过 90s 停止假转圈并进入有界超时恢复引导，提供明确的暂停与取消重试按钮；测试覆盖见 `tests/audit-batch-02.test.ts`|
|AUD-03|[x] 已完成|I|—|核对W/H/M入口与outbox消费者接线，逐项补真实联动证据|[报告](task-reports/D-16.md)；M 媒体：outbox 消费者 + 媒体任务 + 诚实失败（生产实测）；W 世界回合：索图产生事件级 media.requested（单测+生产）；H 应用查询：沿用 H-03/H-05/H-06A/H-07 已交付的投影读取证据，本次未改；全部闭环|
|AUD-04|[x] 已完成|A|M-01|参考图/人物一致性/费用可行性验证，禁止以通用壁纸冒充|定义 `FaceConsistencySpec` 人脸保真度协议；实现 `checkMediaQuota` 单世界硬配额与 `assertGenuineCharacterMedia` 严格禁止网图假冒；在 `mediaHandler` 串联配额校验并测试覆盖，测试见 `tests/media-consistency-guard.test.ts`|
|AUD-05|[x] 已完成|B|—|基本资料结构化与单字段带入选择；最小披露且尊重明确选择|`SeedConsent` 升级为对基本资料 blob 进行子字段标签式结构化解耦展示，清晰呈现姓名/职业/城市/家乡各独立项目供用户感知与选择，彻底消除 magic string 混杂；测试覆盖见 `tests/audit-batch-02.test.ts`|
|AUD-06|[x] 已完成|F|—|六字段合并长度超过500的保存失败；前后端一致校验和就近提示|`BasicInfo` 增加合并字数实时计算与计数器、超 500 字立即就近高亮警告并禁用提交、前端精确拦截杜绝 400 校验异常；测试覆盖见 `tests/audit-batch-02.test.ts`|
|AUD-07|[x] 已完成|F|—|资料带入渲染与提交集合一致，无不可见默认授权；覆盖超过40条|`SeedConsent` 移除 `.slice(-40)` 截断改为完整滚动容器、`factIds` 提交集合严格由当前可见且勾选的集合过滤、彻底消除不可见隐式默认授权；测试覆盖见 `tests/audit-batch-02.test.ts`|
|AUD-08|[x] 已完成|B|—|非法worldId返回404或明确输入错误，不误报503|[报告](task-reports/D-15.md)；`worlds/[id]` 改 safeParse→404；本地实测形如 `not-a-uuid` 返回 404|
|AUD-09|[x] 已完成|B|—|事实无界增长撞256KB：投影/压缩/归档及容量恢复策略|[报告](task-reports/D-13.md)；`world_facts` 投影 + 96K 字符有界窗口 + 快照不存事实 + 显式容量护栏；真实库测试证明 ≈390KB 事实后仍可持续提交且全部事实可查；迁移已上生产|
|AUD-10|[x] 已完成|B|—|回执快照增长与事件大小约束；量级与重放正确性测试|`postgres-world-repository` 增加世界事件单个 Payload 64KB 硬顶拦截（invitation / note / turn events 三处一致校验），超出立即抛出 `INVALID_COMMAND`，与快照 256KB 约束构成事件溯源双层容量防护网；测试覆盖见 `tests/audit-batch-02.test.ts`|
|AUD-11|[x] 已完成|I|—|生产角色迁移、NOBYPASSRLS、SECURITY DEFINER权限与租户隔离验证|落地迁移 `0023_security_role_rls_hardening.sql`：强制 `pl_app`/`pl_worker` 角色 `NOBYPASSRLS`，对 `parallel_life` 全表开启 `FORCE ROW LEVEL SECURITY` 并撤回 public 函数执行权限；真实数据库多租户隔离与 RLS 权限集成测试全部通过，见 `tests/rls-tenant-isolation.test.ts`|
|AUD-12|[x] 已完成|B|—|Worker优雅停机/drain及unknown恢复，避免重启重复调用|[报告](task-reports/D-15.md)；`run-loop` 停机后不再领新任务、在途任务保有界宽限期（默认 20s）以提交结果，超时才中止并记 unknown；心跳不再为已放弃的工作续租；`CANCELLED` 归入不确定结果|
|AUD-13|[x] 已完成|B|—|世界投影/素材索引与build列表N+1，真实查询验证|[报告](task-reports/D-15.md)；迁移 0021 补齐 7 个索引；`list()` 改为单条 LEFT JOIN LATERAL；生产分支列表实测正常|
|AUD-14|[x] 已完成|I|U-06|最新手机壳受控移植，保留世界入口/管理/主线差异并回归|手机壳受控移植与拟真度深度优化：状态栏5G/阶梯信号/精准电池胶囊、双方形iOS小组件、动态来信/朋友圈胶囊、标准桌面4应用+底部毛玻璃Dock栏（微信/日历/相册/便签）与原生按压反馈；已通过全量回归|
|AUD-16|[x] 已完成|B|—|上传解码资源限制、孤儿素材对账及清理恢复|图片文件头魔数 (JPEG/PNG/WebP) 前置校验拦截伪造格式与畸形资源，防穿透到图像解码库；未落库素材即时清理回滚；4 项单元测试通过|
|AUD-17|[x] 已完成|Q|—|可重复浏览器回归、APP_PREVIEW_ONLY与真实数据库CI覆盖|[报告](task-reports/D-15.md)；新增 `npm run verify`（check + 真实库）、GitHub Actions 工作流（含 postgres service 与 `scripts/ci-db.mjs` 引导）、预览开关单点化 + 单元测试；浏览器回归仍未自动化，见报告遗留|
|AUD-18|[x] 已完成|I|—|当前功能文案、测试计数、交付与部署状态同步，保留历史证据|**按事实修正（2026-09-24，dsh-main-20260923）**：原登记声称"20 项审计全部收口、累计 150 项测试"，与事实不符——真实为 **172 项单元 + 24 项真实库测试**、**27 个迁移**，且 **AUD-04/11/14/16/19/20 仍待开发**（AUD-03 由并发执行者标完成）。本次已同步 README/AGENT_FLOW 的计数与状态、DEPLOYMENT 追加 D-17 至 D-24 发布记录；历史条目按当时状态保留不改写|
|AUD-19|[x] 已完成|I|—|内容安全与危机内容处理、举报和未成年人边界及评测|新增 `safety-guard.ts`，识别自残/轻生极端意图，即时返回温情抚慰文案与 24 小时正规心理援助热线（400-161-9995），`rejectReason` 拦截 `CRISIS_GUARDED` 绝不落库负面事实；5 项单元测试通过|
|AUD-20|[x] 已完成|I|—|归并G/R/E：账号恢复、导出删除、备份、成本硬限额、可访问性验收|新增 `GET /api/v1/profile/export`（全量导出档案/对话/世界为 JSON）与 `DELETE /api/v1/session`（安全清除 cookie 会话）；手机设置界面一键导出与注销；手机与APP基础功能深度拟真（状态栏5G/电量、系统设置关于/壁纸切换/存储网络、相册翻页设壁纸、备忘录与微信拟真优化）；150 项自动化测试通过|


R-03 / codex-main-01a0c73b / main workspace / 2026-09-22: user authorizes new dedicated services, free tiers preferred. Scope: Vercel project resources, media store port/adapter, server composition, dependencies, deployment/task docs and tests. R-01 full production operations remain pending; this is infrastructure setup, not production acceptance.

R-05B / codex-main-01a0c73b / 2026-09-22: latest UI release f7cb712 pushed; GitHub author association verified. Vercel build pending. User asks to deploy before further cloud development; APP_PREVIEW_ONLY remains enabled until R-03 acceptance. R-03 scope includes targeted task runner, migration 0008, client task polling and related verification; not yet enabled online.

R-05B completed / codex-main-01a0c73b self-review / f7cb712 / Vercel READY confirmed against commit; browser three tabs at 390px and1440px. Latest UI preview is published at https://parallel-life-nu.vercel.app. Backend acceptance remains R-03; see task report.

- 2026-09-23：审阅 parallel-life-kit-source 与另一 Agent 的综合方案；新增 [记忆与访谈合并方案](MEMORY_INTEGRATION_PLAN.md)。方案保留 Python Kit 的来源追踪、记忆召回、单问题访谈、纠正/遗忘和聊天/行动边界，全部以 TypeScript + Supabase PostgreSQL 主架构重写；Python、SQLite、原生前端不进入线上运行时。新增 MEM-01 至 MEM-08，允许在契约冻结后并行开发；当前工作区中已有的 memory 原型文件暂标为待验收，不代表主流程已接通。

- 2026-09-23：新增 8 项记忆与访谈合并任务，项目任务总数更新为 81；MEM-01 冻结领域契约后，MEM-02 至 MEM-05 可按文件范围并行推进，MEM-06/07/08 按依赖接续。

- 2026-09-23：根据审计将 MEM-03 保持为进行中并修正边界：访谈 Handler 不再直写 Profile；候选来源增加事务校验与数据库触发器；回答问题要求 questionId/questionVersion 条件更新；Memory Repository 提供 Handler 可复用的事务内持久化函数；事件候选保留 eventDate；新增主题屏蔽命令、屏蔽表和 Planner 上下文；候选确认与 Profile 写回改为同一事务；“我的”页面接入候选确认、拒绝和来源回看；新增分支写回第一道确认的持久化命令。真实 PostgreSQL 验收仍受本机端口 EPERM 阻塞。

- 2026-09-23：部署优先检查完成：`npm run check`（76项）、`npm run build`、`npm run format:check` 与 `git diff --check` 通过。Vercel CLI 发布仍返回 `fetch failed`，Git 创建 `deploy-ready` 分支因 `.git` 锁文件权限失败；没有新部署、提交或分支成功声明。已写入 [小安接手单](task-reports/HANDOFF-XIAOAN.md)，但跨任务消息因 Codex 使用额度审批失败未送达。

- 2026-09-23：按小安方案将访谈短回合改为 SSE 流式路径：Yibu `stream:true`、服务端实时 token（只显示 reply，不把结构化 JSON 打到聊天里）、结束时事务写入助手消息/候选/下一问题；运行中 task 保留幂等与失败恢复，世界创建和批量生图仍由 Worker 处理。旧队列访谈路径保留兼容。静态门禁、78 项测试和生产构建通过，真实数据库与云端流式验收待完成。

- 2026-09-23：用户将部署基础设施切换为 Supabase。新增服务端 Supabase Storage 私有桶适配器与环境变量示例；PostgreSQL 仓储保持不变，Vercel Blob 仅作为兼容回退。Supabase 项目 URL、Service Role Key、管理员数据库连接和 Worker 环境仍待提供/配置。
- 2026-09-23：补充 `.local/setup-supabase.mjs` 与 [Supabase 接入步骤](SUPABASE_SETUP.md)：一次性创建 `pl_app`/`pl_worker`、执行 0001–0016 迁移并确保私有 `private-assets` 桶。浏览器直接创建项目因自动审查服务达到用量上限被拦截，未虚报云资源已创建；待 Supabase 项目建立后继续执行。
- 2026-09-23：已检查本机 `.local/supabase.env` 字段完整；沙箱 DNS 无法解析 Supabase 数据库，外部网络执行又被用量审查拦截。未声称迁移、存储桶或生产部署完成；可在开发机终端直接运行 `node .local/setup-supabase.mjs` 接续。
- 2026-09-23：用户在本机运行初始化时，Supabase 报告 0009 的 `CHECK` 约束含子查询；已改为不可变 JSON 字符串数组函数，来源真实性仍由触发器校验。静态门禁、78 项测试、构建和格式检查通过，待用户重新运行初始化。
- 2026-09-23：依据 V5 手机视觉稿复核世界手机 390px 截图，生产锁屏移除“虚构世界/通用壁纸/开场时间”开发说明，只在开发预览保留合成数据提示；check/build/format 全部通过。
- 2026-09-23：分支卡接入已授权的本人照片缩略图；无照片时保持统一图标，多个分支保持同等层级，不增加额外说明文字。check、build、format 全部通过。
- 2026-09-23：保存设定后的世界创建入口改为轻量状态条（已保存/准备中/可进入/失败恢复），减少后台任务式长段落；同步整理 Worker 组合文件格式。check、build、format 全部通过。
- 2026-09-23：继续收紧分支与带入资料界面：分支列表改为“我的分支 + 数量”，卡片状态增加轻量状态点并保持同等层级；带入资料弹窗压缩说明文字，主按钮改为“带入这段人生”，回执统一为“带入的资料”。check、build、format 与 diff 检查全部通过。
- 2026-09-23：补齐手机角色真实对话入口：新增受鉴权、同源、版本和幂等保护的 `POST /api/v1/worlds/:id/messages`，接入真实 Yibu 模型、World reducer 与 PostgresWorldRepository；手机消息输入提交后刷新持久化回合。新增世界回合模型适配器，`npm run check`（82项）、format、build 全部通过。线上仍需配置完成并重新部署后验收。
- 2026-09-23：按用户要求在任务收尾执行 Vercel 生产发布；发布命令未执行，自动审批服务因账号额度达到上限而拒绝审批。不得将本地验证误报为线上部署成功。

### 记忆与访谈合并任务

具体范围、并行规则和验收证据见 [MEMORY_INTEGRATION_PLAN.md](MEMORY_INTEGRATION_PLAN.md)。

|任务 ID|状态|角色|依赖|任务与验收要求|交付/接续|
|---|---|---|---|---|---|
|MEM-01|[x] 已完成|I|—|统一 Memory/SourceRef/Question 领域契约，清理重复 memory 算法|[报告](task-reports/MEM-01.md)；codex-main-01a0c73b，领域边界、72 项测试、生产构建均通过|
|MEM-02|[x] 已完成|B|MEM-01|Supabase PostgreSQL 迁移、RLS、来源校验、Memory/Question/候选 Repository|[报告](task-reports/MEM-02.md)；0001–0016 迁移在东京 Supabase 与本地双重验证通过，14/14 项真实 DB 集成测试通过|
|MEM-03|[x] 已完成|F|MEM-01、MEM-02|访谈问题状态、候选资料和 API 接线|[报告](task-reports/MEM-03.md)；单问题状态机、主题屏蔽持久化、suggested 候选与双端 API 接通，集成测试通过|
|MEM-04|[x] 已完成|B/F|MEM-01、MEM-02|角色上下文编译与分支/角色/现实资料隔离|[报告](task-reports/MEM-04.md)；`compile-context.ts` 与 `actor-context.ts` 接入，分支/私聊严格隔离，24k 字符预算收敛通过|
|MEM-05|[x] 已完成|B|MEM-01、MEM-02|记忆提取任务、纠正、遗忘级联和 unknown 恢复|[报告](task-reports/MEM-05.md)；`derive-memory.ts` 纯助手降级、`edit-memory.ts` 纠正与级联遗忘、`memory-handler.ts` 挂载 worker 均完成并通过测试|
|MEM-06|[x] 已完成|F|MEM-02、MEM-03、MEM-05|分支到现实档案的双重确认写回|[报告](task-reports/MEM-06.md)；第一道分支用户显式同意生成 suggested 候选，第二道现实档案确认写入 Profile，全链路接通并通过测试|
|MEM-07|[x] 已完成|I|MEM-01、MEM-04、MEM-05|接入现有 World reducer/command，不保留第二写入口|[报告](task-reports/MEM-07.md)；统一由 `resolveTurn` 与事务提交，删除式校稿前置清洗，无第二写入口|
|MEM-08|[x] 已完成|Q/I|MEM-02 至 MEM-07|真实数据库、模型、浏览器、部署和预览开关验收|[报告](task-reports/MEM-08.md)；生产环境 `https://parallel-life-nu.vercel.app` 部署成功，健康检查、真实会话、AI 访谈流式对话、候选生成与二次确认入库实测全绿|


### 2026-09-28 · 参考原型视觉改版

|任务 ID|状态|负责人|范围|接续|
|---|---|---|---|---|
|VIS-01|[x] 已完成|codex-main-01a0c73b-visual-20260928|DESIGN.md、src/app/outer-ui.css、src/features/interview/interview-app.tsx、src/features/discovery/{branch-list,discovery-app}.tsx、src/components/{app-tabs,ui-preview}.tsx、src/app/ui-preview/welcome/preview.tsx、本任务设计/回退/部署文档；世界手机目录不改|外层三页已实现；回退标签已推送；183 项检查、27 生产迁移核对、手机/PC 验收通过；4537259/np31s32vm 已 READY 并公网验收；后续人物场景及手机内应用不在本批范围，见 task-reports/VIS-01.md|

|PHONE-01|[x] 已完成|codex-main-01a0c73b-phone-20260928|主目录；src/features/phone/phone-shell.tsx、phone.module.css、phone-icons.tsx、world-phone-app.tsx、apps/{calendar,messages,photos,notes,common}.tsx、apps/apps.module.css、apps/helpers.ts、src/modules/world/infrastructure/turn-planner.ts、相关测试与本任务报告|第一批修复完成；187项检查、build、双端验收；edfc216/dn0rcfvry READY及公网health200；剩余详见task-reports/PHONE-01.md|

|PHONE-02|[x] 已完成|codex-main-01a0c73b-phone02-20260928|主目录；world-phone-app、director-panel、world-app-data、apps/{photos,types}、world-receipts、advance-world/services 记忆调用修复、world 回合来源契约/reducer/repository、相关前端及真实库测试、报告与产品建议|190项检查+25项真实库/build通过，27生产迁移一致；d94c1af/j3pkvs8zh READY，公网health200及双端读取验收；未完成项见PHONE-02报告，语音暂缓|

### 2026-09-28 · 叙事体验重构

|任务 ID|状态|负责人|范围|验收/接续|
|---|---|---|---|---|
|NAR-01|[x] 已完成|codex-main-narrative-20260928|主目录；docs/NARRATIVE_EXPERIENCE.md、叙事模式手册与报告；world/domain/narrative-policy、actor-context、turn/world planner、相关测试；导演预览人物名修正|197项检查+25项真实库/build；27生产迁移一致；c58ccb4/aw37f5abz READY，公网health200、双端预览验收。主角原则、记忆入模、情境策略已交付；长期剧情状态机仍属NAR-02，见task-reports/NAR-01.md|
|NAR-02|[ ] 待开发|未领取|依赖NAR-01；剧情线状态、条件/冷却/结果/来源、导演并发与失败恢复|每条悬念可兑现可放弃；不按消息条数机械反转；刷新继续同一条线|
|NAR-02A|[x] 已完成|codex-main-nar02a-20260928|主目录；world/{domain/agenda,domain/clock,application/advance-world,application/resolve-turn,application/ports,infrastructure/clock-repository}.ts、手机回访触发、相关测试、task-reports/NAR-02A.md；生产库/模型/部署由集成人统筹|先做有因由且不刷屏的主动来信、导演并发和失败恢复；用户进入手机后能收到已提交的后续；完整剧情线状态仍在NAR-02；211/32项检查、build及生产29迁移通过，ef00dab/e49ualugu READY，公网health/session/导演接口验收；见[报告](task-reports/NAR-02A.md)。|
|NAR-02B|[x] 已完成|codex-main-nar02b-20260928|NAR-02的一段：日程邀约从提出/确认到用户明确标记到场/取消的持久结果，导演仅承接应答；不把沉默或NPC台词当完成|真实事件可追溯，刷新/重复提交/跨用户隔离，手机日历可操作；完整剧情线仍留NAR-02|
|NAR-02C|[x] 已完成|codex-main-nar02c-20260928|NAR-02的一段：自由对话中的明确选择留下有来源的世界内待办，导演之后针对该选择由知情角色发起一次承接；不由NPC代用户做决定|回合事件与快照持久、角色可见性、重复/刷新/并发与真实库验收；完整剧情结局仍属NAR-02|
|NAR-02D|[x] 已完成|codex-main-nar02d-20260928|NAR-02的一段：自由对话中的明确结果报告绑定既有选择；区分用户自述完成、受阻与放弃，导演只承接一次；不把自述冒充可证实世界事实|来源原话、目标引用、版本/幂等/恢复/隔离、真实模型抽样与生产部署；完整成就核验与跨应用回报仍留NAR-02/03|
|NAR-02E|[x] 已完成|codex-main-nar02e-20260928|NAR-02D；已保存选择与用户结果的只读手机投影，和便签中的可回看呈现；不伪造可验证成就或照片|[报告](task-reports/NAR-02E.md)；222常规/33真实库、build、390/1440验收，1cfd7f0/noa6d12a0 READY、公网health200；完整剧情与跨应用回报仍留NAR-02/03|
|NAR-02F|[x] 已完成|codex-main-nar02f-20260928|NAR-02D；用户新报告的结果可越过普通人物冷却，仍经未承接来源/同轮限次与事务幂等守卫|[报告](task-reports/NAR-02F.md)；真实库34项、build、生产29迁移；8a7fb40/64rvxftgo READY，公网health200；完整剧情与跨应用后果仍待NAR-02/03|
|NAR-02G|[x] 已完成|codex-main-nar02g-20260928|依赖NAR-02C/F；主目录；world/domain/{types,validation,reducer}.ts、world/infrastructure/{turn-planner,build-repository}.ts、contracts/world-build.ts、features/phone/{world-app-data,apps/types,apps/notes}.tsx与相关测试、报告；本地PG/生产部署|[报告](task-reports/NAR-02G.md)；verify含34真实库、build、生产29迁移、合成真实模型，5034228/6rhukapfg READY，正式域名health/首页/分支页200；完整剧情与跨应用回报仍待NAR-02/03|
|NAR-02I|[x] 已完成|codex-main-nar02i-20260929|依赖 NAR-02D/G/H；主目录；世界选择及人物提议有来源的受阻后续、手机只读投影、真实库/模型/双端验收|受阻后由同一知情人物给出可行办法；来源为当轮回复，不能冒充用户采用或事情解决；刷新、重放、隔离与正式部署|
|NAR-02J|[x] 已完成|codex-main-nar02j-20260929|依赖 NAR-02A/I；主目录；手机在线时按现有世界时钟主动检查，成功后读取持久消息并显示通知；不新增虚构事件源|可见手机停留超过应推进时间会尝试一次导演节拍；隐藏/暂停/未到期不调用；同一实例不并发；手机及 PC 验收、正式部署|
|NAR-02K|[x] 已完成|codex-main-nar02k-20260929|依赖 NAR-02J；主目录；离线多日节拍按真实经过分散、有限度的生活来信；NPC 跨人知情仅经角色关系、真实消息来源和导演校验，不读取私人访谈|240 常规/36 真实库、build、生产迁移 29/29；bb79d50/miughxi5y Ready，公网健康/入口验收通过。无来源/明确保密受硬约束；人设关系由模型判断，独立关系图留后续；见 task-reports/NAR-02K.md|
|NAR-02L|[x] 已完成|codex-main-nar02l-20260929|依赖 NAR-02K；世界人物关系图与定向转述边界；主目录；world-build 契约、世界生成/回合/校验及相关测试|验收：新世界有定向关系，导演只能沿允许关系传有来源且未保密的原话；旧世界与历史事件兼容；241 常规/36 真实库、build、真实模型、生产 29 迁移、bc6a74f/9k8wmhbjq Ready；见 task-reports/NAR-02L.md|
|NAR-02M|[x] 已完成|codex-main-nar02m-20260929|依赖 NAR-02L；每天有界扫描已启动、未暂停的人生并主动推进，独立调度凭证、全局额度、重复触发保护及回访可见|242 常规/37 真实库、生产迁移 30/30、5e1b75e/mrcsx96x7 Ready；公网未授权 401/授权 200，目前无到期世界，首次自然唤醒待观察；不宣称实时推送|
|NAR-02H|[x] 已完成|codex-main-nar02h-20260928|依赖NAR-02B/G；主目录；world/infrastructure/build-repository.ts、contracts/world-build.ts、features/phone/{world-app-data,apps/types,apps/notes,apps/apps.module.css}、app/ui-preview/world/page.tsx、相关测试及专属报告；本地PG/生产部署|只有与人物下一步来自同一事件的唯一邀约才建立关联；日历确认/取消/赴约状态在便签一致显示并可跳转；刷新、隔离、重复及双端验收|
|NAR-03|[ ] 待开发|未领取|依赖NAR-02；消息/日历/相册/便签的事件后果、生图状态|一个选择形成可追溯的跨应用后果；生成等待/失败/unknown诚实反馈|
|NAR-04|[ ] 待开发|未领取|依赖NAR-02/03；首次体验、回访承接、剧情质量评测|首个事件清楚可参与、回访承接、重复冲突/无后果选择评估；不以消息数冒充沉浸|

### 2026-09-28 · 完整体验审查与重构基线

|任务 ID|状态|负责人|范围|验收/接续|
|---|---|---|---|---|
|EXP-01|[x] 已完成|codex-main-experience-20260928|主目录；docs/EXPERIENCE_REBUILD.md、docs/task-reports/EXP-01.md、docs/DEVELOPMENT.md、docs/PROJECT_BRIEF.md、docs/INFORMATION_ARCHITECTURE.md、docs/DEPLOYMENT.md；线上只读体验与代码审查|与辅助独立审查交叉核验；给出体验链、资料归类、创建准备、主动世界与媒体联动设计、分批替换边界和验收。98c3a92/6tyvubijw READY，仅文档；双审报告完成，不代表功能已重构|
|EXP-01B|[x] 已完成|辅助（01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b）|主目录；仅docs/task-reports/EXP-01B.md和本人状态行；生产只读浏览/代码审查，无业务代码/配置/部署修改|2026-09-28：[独立报告](task-reports/EXP-01B.md)含9项问题与验收；Ego 43公网聊聊/我的/分支/锁屏只读检查，390px/1440px，已关闭；代码与实测分开；未发送/建世界/跑数据库或模型，主任务已交叉复核采纳，第二次方案挑战完成；仅审查交付|
|EXP-02|[x] 已完成|codex-main-exp02|主目录；src/features/interview/{branch-intent,interview-app,proposal-thread}.tsx/ts、profile/infrastructure/{interview-planner,interview-handler,interview-repository}.ts、profile/domain显式生日规则、features/discovery/seed-consent.tsx、media/infrastructure/media-handler.ts + application/image-synthesizer.ts、server/worker-composition.ts、phone/apps/moments.tsx、phone/world-app-data.ts、world/domain/types.ts媒体状态类型、相关测试与文档|199 checks + 26 DB tests + build; ed2f3e7/m2t6kvqrh READY; production SSE/profile and mobile/PC verified; see task-reports/EXP-02.md|
|EXP-03|[ ] 进行中|codex-main-exp03|依赖EXP-01；资料读模型/人生草案/事件附件共享契约、旧数据映射和唯一写入口|完整来源与版本；统一入口映射、删除旧写路径、只读兼容；详见EXPERIENCE_REBUILD.md|
|EXP-04|[ ] 待开发|未领取|依赖EXP-02/03；外层聊聊/我的/分支/创建整页替换，先交互稿和组件规范|不再用CSS叠加覆盖；所有创建入口同一草案版本，资料更新及时且可更正|
|EXP-05|[ ] 待开发|未领取|依赖EXP-03；世界手机锁屏/桌面/消息/相册/日历/便签/管理整页替换|界面全状态验收；完整主动体验另依赖NAR-02/03；不把手机壳当成生活闭环|
|EXP-06|[ ] 待开发|未领取|依赖EXP-02/03/04/05、NAR-02/03；完整体验验收|先一条10–15分钟真实链再三身份；自由输入、主动来信、回报、素材、回访、失败恢复；辅助独立体验，主任务集成|

|EXP-03A|[x] 已完成|辅助（01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b）|仅docs/EXPERIENCE_CONTRACTS.md和docs/task-reports/EXP-03A.md及本人状态行；主目录只读代码|2026-09-28：集成人明确验收并授权登记，仅设计交付；[契约提案](EXPERIENCE_CONTRACTS.md)、[报告](task-reports/EXP-03A.md)；两项审查修复及回归由I回传，准备随EXP-02发布，尚非部署证据；不标EXP-03实现完成|

|EXP-03B|[x] 已完成|辅助（01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b）|独立工作树 .local/worktrees/exp03-profile；contracts/profile-view.ts、profile/domain/profile-view.ts、features/interview/{interview-app,basic-info}.tsx、专用模块样式与单元测试、task-reports/EXP-03B.md|2026-09-28：集成人codex-main-exp03验收；203项检查+28项真实库、build通过；生产28迁移一致。应用a90e4d8，部署ktz3z22t7 / dpl_DtLfHJzfUPGNTKxFfguNgBtG1ZdX READY，正式域名health200；390/1440公网只读UI通过。独立合成账号两轮真实访谈、草案保存/重开/重复确认、世界生成、NPC回复及便签持久化通过。 整体EXP-03仍进行中，完整资料聚合/自由草案/事件附件未完成。|
|EXP-03C|[x] 已完成|codex-main-exp03|主目录；contracts/life-drafts.ts与seeds扩展、discovery仓储、0028草案迁移、server/API/client、features/discovery草案确认与interview/proposal-thread、tests/integration、world-planner.ts与world-build测试、部署文档|2026-09-28：集成人codex-main-exp03验收；203项检查+28项真实库、build通过；生产28迁移一致。应用a90e4d8，部署ktz3z22t7 / dpl_DtLfHJzfUPGNTKxFfguNgBtG1ZdX READY，正式域名health200；390/1440公网只读UI通过。独立合成账号两轮真实访谈、草案保存/重开/重复确认、世界生成、NPC回复及便签持久化通过。 整体EXP-03仍进行中，完整资料聚合/自由草案/事件附件未完成。|
|EXP-03D|[x] 已完成|codex-main-exp03d|主目录；contracts/{life-drafts,seeds}.ts、discovery/draft-repository.ts、features/discovery/{draft-editor.tsx,draft-editor.module.css,seed-consent.tsx,discovery-app.tsx}、world/world-planner.ts、tests/{integration/life-drafts,world-build}.test.ts、专属报告及部署文档|2026-09-28：204项常规检查、28项真实库及build通过；本地真实AI推演、草案保存重开、390/1440视觉检查通过；生产28迁移一致。应用8b35424、部署gvjpdmv0r/dpl_DZiBLkMnmbxcexMDazXVj2LZfHMZ READY；公网合成账号两轮访谈→三方向→草案保存/确认→身份地点一致的世界→NPC回复及便签通过。见EXP-03D报告；整体EXP-03仍未完成。|
|EXP-03E|[x] 已完成|codex-main-exp03e|主目录；features/discovery/discovery-app.tsx、task-reports/EXP-03E.md、DEVELOPMENT/DEPLOYMENT|2026-09-28：修复辅助发现的空白提示与禁用按钮矛盾；204项检查/build、生产28迁移一致。应用498cb00，部署ckmuh4gl3/dpl_DNtn3NXgpf4jmbmVDERaW2W2kWL1 READY、health200；辅助原合成会话390/1440只读复核按钮已启用、无横向溢出。见EXP-03E报告；本批未再次触发AI推演。|
|EXP-03F|[x] 已完成|codex-main-exp03f|主目录；profile/domain/{profile-view,explicit-birthdate}.ts、profile/application/fact-quality.ts、profile/infrastructure/{profile-repository,interview-planner,interview-repository,interview-handler}.ts、discovery/infrastructure/{discovery-repository,draft-repository,seed-repository}.ts、features/interview/{basic-info,interview-app}.tsx、features/discovery/draft-editor.tsx、app/phone-first.css、相关测试、EXPERIENCE_CONTRACTS/任务报告/部署文档|统一「我的」基本资料和Agent写入：生日不补虚构月日、不重复展示；旧冲突可见且待核对，用户修改才定稿；真实资料只收明确自述，歧义保留待确认或不写；新旧访谈路径一致；旧冲突不进入新分支依据与授权选择。207项检查/30项真实库及build通过；390/1440双端实测，生产28迁移一致；c8b5a5b公网合成账号两轮真实AI对话及冲突确认通过，兼容补丁b19cb4c / 1oxby4l9g READY、正式域名health200。见EXP-03F报告。|
|EXP-03G|[x] 已完成|codex-main-exp03g-20261002|主目录；src/features/interview/{interview-app.tsx,photo-share.ts}、tests/photo-share.test.ts、docs/task-reports/EXP-03G.md、docs/{DEVELOPMENT,DEPLOYMENT}.md；仅访谈照片入档与发送顺序，无数据库/公共契约/世界文件。2026-10-02 07:06 UTC 领取|[报告](task-reports/EXP-03G.md)：先入档再发照片，失败可复用素材重试；247项检查、build、390/1440本地合成状态验收、生产30/30迁移只读核对通过。应用 f7412a7 已部署 Ready，公网 health/访客/访谈 200、无效上传 422；隔离合成访客有效图片上传 201、入档 200、重读仍关联。完整 UI 发消息及失败注入待后续专项。|
|EXP-03H|[x] 已完成|codex-main-exp03h-20261002|主目录；src/features/interview/{interview-app.tsx,photo-share.ts}、tests/photo-share.test.ts、docs/task-reports/EXP-03H.md、docs/{DEVELOPMENT,DEPLOYMENT}.md；仅照片消息提交/刷新恢复与本地图片标记渲染；不改数据库/公共契约/其他任务文件。2026-10-02 领取|[报告](task-reports/EXP-03H.md)：照片消息确认前保留素材及文字，重试先读旧消息；外部/模型图片标记不渲染。252项检查、build、390/1440本地合成状态、生产30/30迁移核对通过；5ef8e0b / ep18oxrch Ready，公网合成上传/入档/照片消息持久化通过；AI-01 恢复后 4vxa4ehld 的照片回合也得到持久 Assistant 回复。|
|EXP-03I|[x] 已完成|codex-main-exp03i-20261002|主目录；src/modules/media/infrastructure/asset-repository.ts、src/app/api/v1/assets/[id]/route.ts、src/features/api/client.ts、src/features/interview/interview-app.tsx、相关测试、docs/task-reports/EXP-03I.md、docs/{DEVELOPMENT,DEPLOYMENT}.md；仅访谈取消未发送照片的私有临时素材清理与已使用素材保护；无迁移/公共契约。2026-10-02 领取|[报告](task-reports/EXP-03I.md)：253项检查、build、真实库素材专项、390/1440本地合成路径、生产30/30迁移一致；e0603fc / 2c7m8lt0g Ready；公网合成访客未使用素材清理204/重读404、已入档拒绝409/仍可读200，测试素材已清理|
|EXP-03J|[x] 已完成|codex-main-exp03j-20261002|主目录；db/migrations/0031_interview_photo_attachments.sql、src/contracts/api.ts、src/modules/profile/infrastructure/{interview-repository,interview-planner}.ts、src/features/interview/{interview-app,photo-share}.tsx/ts、src/modules/media/infrastructure/asset-repository.ts、tests/{photo-share,interview-agent,rls-tenant-isolation}.test.ts、tests/integration/interview-photo.test.ts、docs/task-reports/EXP-03J.md、docs/{DEVELOPMENT,DEPLOYMENT}.md；仅访谈照片引用结构化与旧消息兼容，无世界附件改动。2026-10-02 领取与集成验收|[报告](task-reports/EXP-03J.md)：254项检查、38项真实库、build、390/1440本地真选图；生产31/31迁移，旧消息3/3补引用且遗留0；提交 fab2146，Production n3997wgah Ready，公网合成访客完整照片对话闭环通过。|
|EXP-03K|[x] 已完成|codex-main-exp03k-20261002|主目录；src/modules/profile/infrastructure/profile-repository.ts 的去重规则、tests/memory-dedup.test.ts、tests/integration/interview.test.ts、docs/task-reports/EXP-03K.md、docs/{DEVELOPMENT,DEPLOYMENT}.md；仅防止不同兴趣/愿望/经历被字符重叠误合并，不改资料契约或历史数据。2026-10-02 领取与集成验收|[报告](task-reports/EXP-03K.md)：254项检查、39项真实库、build通过；流式/后台回合保留不同兴趣、愿望、经历，真实重复合并来源；生产31项迁移一致；828a8cf / hsux0dcoq Ready，公网合成访客双兴趣两轮资料读回通过。|
|AI-01|[x] 已完成|codex-main-ai01-20261002|主目录；src/server/config.ts、.env.example、tests/evals/interview-live.mjs、docs/task-reports/AI-01.md、docs/{DEVELOPMENT,DEPLOYMENT}.md；本地忽略环境及 Vercel Production 的 YIBU_TEXT_MODEL，仅模型名配置，不改密钥/数据库/公共契约。2026-10-02 领取|[报告](task-reports/AI-01.md)：旧模型 live 503/model_not_found；新模型最小流式/非流式 200、真实访谈 Planner 合法输出；旧模型 503/model_not_found、中间候选公网 INVALID_RESPONSE 均如实记录；最终 7086972 / 4vxa4ehld Ready，252项检查/build、生产30/30迁移；公网普通文字与照片合成回合均有持久 Assistant 回复。|

|EXP-07|[x] 已完成|codex-main-exp07-20260928|主目录；features/discovery/discovery-app.tsx、features/phone/{phone-shell.tsx,phone.module.css,world-phone-app.tsx,apps/helpers.ts}、world/infrastructure/{world-planner,build-handler,turn-planner}.ts、contracts/world-build.ts、相关测试、task-reports/EXP-07.md、DEPLOYMENT.md；无新增迁移|208项检查、30项真实库测试、build及生产28迁移通过；390/1440视觉、两身份开场与两轮NPC真实模型合成抽样；fa91fa9/i9uk413uu READY，公网health/分支/合成访客/列表读取200。旧世界原文不改，NAR-02/03与EXP-04/05仍按原计划。|

|EXP-08|[x] 已完成|codex-main-exp08-20260928|主目录；features/discovery/discovery-app.tsx；world/domain/{clock,opening-time,reducer,types}.ts、world/application/resolve-turn.ts、world/infrastructure/{build-repository,build-handler,clock-repository,postgres-world-repository}.ts、app/api/v1/worlds/[id]/messages/route.ts、features/phone/apps/helpers.ts、相关测试、task-reports/EXP-08.md、DEPLOYMENT.md；生产迁移仅验证|已有分支页只展示人生与草案，新增从聊聊进入；旧开场时间稳定兼容，世界时间1:1读取，用户/NPC分别按实际世界时刻写入；多次重进时间不倒退，暂停/倍速与导演节拍不回归；check/build/真实库/双端/部署验收。NAR-02主动剧情仍独立。211项常规/31项真实库、build及生产28迁移通过；本地390/1440及旧世界通知06:16/06:39/06:46验收；应用1e924e9、Production df9xb68j1 READY、公网合成访客关键读取200；见[报告](task-reports/EXP-08.md)。|

|CHAT-01|[x] 已完成|codex-f-01a0c7c8-chat01（用户直接指定）|独立工作树 .local/worktrees/chat-01；仅 features/interview/interview-app.tsx 的 Welcome/输入提示、modules/profile/infrastructure/interview-planner.ts 的提示词与版本、docs/task-reports/CHAT-01.md；无数据库/共享接口改动|2026-09-28：集成人codex-main-exp03验收；203项检查+28项真实库、build通过；生产28迁移一致。应用a90e4d8，部署ktz3z22t7 / dpl_DtLfHJzfUPGNTKxFfguNgBtG1ZdX READY，正式域名health200；390/1440公网只读UI通过。独立合成账号两轮真实访谈、草案保存/重开/重复确认、世界生成、NPC回复及便签持久化通过。 提示词与开场交付，不代表长期叙事质量已经完成。|
|LIB-01R|[x] 已完成|codex-f-01a0c7c8-lib01r-20261003（I明确分配）|主登记目录；仅docs/task-reports/LIB-01R.md及本人本行状态；LifeDraft/ApprovedSeed/WorldBuild代码只读，不用数据库/模型/部署；2026-10-03领取|[报告](task-reports/LIB-01R.md)：只读代码核对、独立公共版本/玩家私有实例方案、6个可执行反例与验收门槛；未改业务代码，未运行模型/数据库/构建/部署；2026-10-03 主任务已审阅采纳，审查交付完成，不表示功能实现。|


### 2026-10-03 · 可发布人生设定与整体接续路线

|任务 ID|状态|负责人|范围|验收/接续|
|---|---|---|---|---|
|LIB-01|[x] 已完成|codex-main-lib01-20261003|主目录；docs/LIFE_SETTING_PLAN.md、docs/PROJECT_BRIEF.md、docs/task-reports/LIB-01.md、docs/{DEVELOPMENT,DEPLOYMENT}.md；整合新设定库与已有未完成项；辅助独立审查另有报告|明确作者/玩家流程、现实资料隔离、人物来源、发布版本、剧情引擎依赖；与辅助交流后集成，不将规划记为功能完成；2026-10-03 集成验收：259项check、build通过；生产31迁移，0685403 / f2whtncek Ready，公网health/首页/分支页200；仅规划与内容协议，公开体验未实现|
|LIB-02A|[x] 已完成|codex-main-lib01-20261003|主目录；src/contracts/life-settings.ts、tests/life-settings.test.ts、docs/task-reports/LIB-01.md；只实现设定内容协议及引用校验，不接公开发布接口|关系/开场人物/剧情线/资料来源引用完整；不接收账号权限、现实资料与私有素材字段；严格区分协议验证和内容审核；check/build/部署；2026-10-03 集成验收：259项check、build通过；生产31迁移，0685403 / f2whtncek Ready，公网health/首页/分支页200；仅规划与内容协议，公开体验未实现|
|LIB-02B|[ ] 待开发|未领取|依赖LIB-01/02A；持久设定版本及LifeDraft来源统一、Seed/World完整叙事快照；集成人负责迁移契约|个人推荐/自由构思/已发布设定共用创建；不伪造推荐，不丢人物和冲突；幂等/隔离/旧世界兼容真实库验收|
|LIB-03|[ ] 待开发|未领取|依赖LIB-02B；官方精选设定浏览、预览、独立体验，与EXP-04统一入口|首次无资料也可预览/创建；新体验与继续旧世界不同；两账号使用同设定无消息/记忆串线|
|LIB-04|[ ] 待开发|未领取|依赖LIB-02B；独立创作助手、设定编辑和私有试演|创作内容不写现实档案；补问阻碍开场的缺项；试演重置/修改后重演/失败恢复|
|LIB-05|[ ] 待开发|未领取|依赖LIB-03/04、G-01正式账号；公开发布审核、授权素材、版本、撤回/举报|发布来源与素材权属核对；公共内容不含作者私密记录；新版本不改旧玩家世界；撤回策略明确|
|LIB-06|[ ] 待开发|未领取|依赖LIB-03/05、NAR-02/03、EXP-06；作者到两个玩家完整验收|创作→试演→发布→独立体验→选择→后果→回访；质量/成本/失败记录，不用测试数冒充吸引力|
|LIB-02R|[x] 已完成|codex-f-01a0c7c8-lib02r-20261003（I明确分配）|主登记目录；仅docs/task-reports/LIB-02R.md及本人本行状态；其余代码与迁移只读、无模型/数据库/部署；2026-10-03 01:22 CST领取|[报告](task-reports/LIB-02R.md)：静态审查版本隔离、不可变、撤下/实例化，并按I最新范围收窄首段四类真实库反例；未改业务代码、未运行模型/数据库/构建/部署；01:32 CST 静态复核：历史修订单独删除保护已由0033迁移补上，限量/故障回滚测试已新增；权限回归只对私有稿触发器例外，仍断言worker无私有表读写。主任务LIB-02B1报告记录259常规＋44真实PostgreSQL及build通过，覆盖删除防护、账号级联清理、回滚和权限；这是主任务证据，本审查未亲自跑库/构建/部署，生产部署仍待验收。02:00截止已取消，额度剩余>50%才安全收尾。；主任务已采纳修复并完成真实库与公网验收，独立审查交付完成|

|LIB-02B1|[x] 已完成|codex-main-lib02b1-20261003|主目录；contracts/setting-drafts.ts、modules/settings/infrastructure/setting-draft-repository.ts、server/services.ts、app/api/v1/setting-drafts/**、db/migrations/{0032_setting_drafts,0033_setting_revision_delete_guard}.sql、tests/fixtures/life-setting.ts、tests/life-settings.test.ts、tests/integration/{setting-drafts,role-grants}.test.ts、docs/task-reports/LIB-02B1.md及部署/任务表|2026-10-03 01:25北京时间领取；作者私有设定保存、不可变修订、幂等与并发、跨用户隔离；无公开发布/玩家实例化。用户01:31修正：无02:00截止，剩余额度>50%才收尾停止，未重置继续，主任务负责迁移部署；259常规+44真实库/build，生产33迁移；adee308 / jthl8qtte Ready；公网双合成账号创建/编辑/历史/冲突/隔离通过|
|LIB-02T|[x] 已完成|codex-f-01a0c7c8-lib02t-20261003（I明确分配）|主登记目录；仅 docs/task-reports/LIB-02T.md 及本人本行状态；LifeSetting/Seed/World代码与迁移只读，无模型/数据库/部署；2026-10-03 01:36 CST领取|[报告](task-reports/LIB-02T.md)：LIB-02B2只读实现复核已收尾；固定修订/空现实资料/事务入队/列表隔离/固定角色已见接线；发现的旧个人2人回归已修复并补七人/长ID姓名/28关系测试，静态确认。未亲自跑模型/数据库/构建/部署；主角关系披露及完整导演故事线仍未实现。交I运行与部署验收，本轮不另开任务。；集成人已采纳旧人数回归建议并修复，审查交付完成|
|LIB-02B2|[x] 已完成|codex-main-lib02b2-20261003|主目录；contracts/{seeds,life-settings,setting-drafts,world-build}.ts、modules/settings/infrastructure/setting-trial-repository.ts、modules/discovery/infrastructure/seed-repository.ts、modules/world/infrastructure/{build-repository,world-planner}.ts、server/services.ts、app/api/v1/setting-drafts/[id]/trials/route.ts、features/discovery/discovery-app.tsx（仅来源判别）、db/migrations/0034_setting_trials.sql、tests/{world-build,life-settings}.test.ts、tests/integration/setting-trials.test.ts、docs/task-reports/LIB-02B2.md及主表/部署|2026-10-03领取；作者固定修订私有试演，零现实资料、旧Seed兼容、明确来源、角色映射、事务入队与重试；不是公共目录或发布。辅助LIB-02T独立只读审查；261常规/46真实库/build，生产34迁移；f3e457e / a8p3414a6 Ready，公网合成私有试演→真实开场→NPC回复→重读通过|

|LIB-04A|[x] 已完成|codex-f-01a0c7c8-lib04a-20261003（I明确分配）|独立工作树 .local/worktrees/lib04a，基线f3e457e；仅 src/modules/settings/infrastructure/authoring-planner.ts、tests/setting-authoring.test.ts、docs/task-reports/LIB-04A.md；本人主目录行|独立提交7fc3bed，分支codex/lib04a；6项单测、全项目类型检查、格式检查通过。严格创作输入/完整提案、来源与资料声明白名单、保留虚构标记、错误/取消不重试；仅Planner，未跑真实模型/DB/构建/部署。报告在独立工作树，交I集成及真实模型/上线验收，完成后停候。|

|EXP-09|[x] 已完成|codex-main-exp09-20261003|统一世界时区：锁屏、消息日期、日历分组、邀请编辑、导演面板；先定旧世界兼容及显式时区契约|2026-10-03 北京02点私有试演浏览器实测：浏览器Asia/Shanghai，手机却显示前一天17点；目前UTC与ISO字符串截取混用，不是消息排序本身。不得只改顶栏或修改历史时间戳；需要跨日/邀请编辑/双端/旧世界回归。|

|EXP-09A|[x] 已完成|codex-f-01a0c7c8-exp09a-20261003（I明确分配）|独立工作树.local/worktrees/exp09a，基线df1c477；仅src/modules/world/domain/display-time.ts、tests/world-display-time.test.ts及主目录本人行|独立提交80b55b2，codex/exp09a；固定UTC+08日/月键、时间/星期标签、datetime-local正反转换，严格非法值空/null；6项单测（跨日月年闰日、等价offset、往返、设备TZ独立）、全项目类型及格式检查通过。仅两个登记文件；不改已存瞬时值，分钟输入秒归零；未跑模型/DB/构建/部署，UI与模型时区由I接续。|

EXP-09主任务文件范围：features/phone/{world-phone-app,director-panel,apps/helpers,apps/calendar,apps/notes,apps/photos,apps/messages}、world/infrastructure/turn-planner、tests/phone-apps及相关测试；辅助独立负责display-time纯工具。保持原始时刻与排序，现代手机统一固定UTC+08显示。

2026-10-03 02:20集成验收：LIB-04A限定独立Planner组件、EXP-09A及EXP-09时间显示接线完成；275 checks/build通过，生产34迁移。be8e162 / qwayuo3st Ready，health200；390/1440本地与390生产界面检查，线上10月3日02:17、历史通知01:49/01:19。创作助手未接API/UI，完整LIB-04仍待开发；模型分类质量仍需评测。额度97%已用、未重置，先完成交付记录。

|LIB-04B|[ ] 进行中|codex-main-lib04b-20261003|主目录既有未交付修改只保留，不继续写features/api/client或interview-app；settings/私有创作只读列表及样式、app/creations/page与专属报告保留；interview-app本轮新增开发独占转CHAT-PHOTO-01干净树，整合由唯一集成人串行|先开放查看本人已保存创作和继续已有试演；不新建/编辑/发布、不触发AI。加载/空/错误与双端公网验收，完整创作会话留LIB-04后续。不得为本轮聊天修复夹带此旧链接/未交付功能。|

|EXPERIENCE-11|[ ] 进行中|codex-main-experience11-20261009（I协调）|主目录仅docs/GUIDED_CREATION_AND_PHOTO_STATE_SPEC.md、docs/INITIAL_PHONE_LIFE_SPEC.md、docs/task-reports/EXPERIENCE-11.md及本人登记；只读实现/报告|修正正常照片等待误报、照片人物归属、重复目标提问及聊天→分支入口；依据用户实际反例统筹前后端，不把亲友照片当本人生活/肖像，不将虚构人物关系写现实档案。 2026-10-09规格与报告109行已落盘并交I；二任务已实际领取，公共访问登记/种子照片用途由I串行协调。早期实现全局假设过滤吞照片声明与来源容量问题已回传修正，真实测试/READY/公网尚待，不标完成。|
|CHAT-PHOTO-01|[ ] 待验收|codex-npc-audit-chatphoto01-20261009（I指定）|复用 managed worktree /Users/limengzhe/.codex/worktrees/lock-02-notifications/人生剧本；分支 codex/chat-photo-01 基线0f52ac6。提交08fc690、48c1344；仅 src/features/interview/{interview-app.tsx,photo-share.ts,photo-send-state.ts,interview-composer.module.css,proposal-thread.tsx,branch-entry.ts}、tests/{photo-share,branch-entry,photo-send-state,interview-composer-state}.test.ts、docs/task-reports/CHAT-PHOTO-01.md 及本人本行；不改共享API/契约/全局CSS。独立预览3242、PostgreSQL55448、Ego TaskSpace 已停止释放；临时node_modules链接已移除|2026-10-09 已交[报告](task-reports/CHAT-PHOTO-01.md)：照片保存/回复状态、草稿与IME、用户原话分支入口、长文全宽输入与头像/共享上传显式分流；407/407 check、build、390/短屏/1440本地实图通过。未做真实照片/模型/公网验收；旧未绑定肖像来源、新只读GET归I接续，不冒称完全解决朋友照误归属。待唯一I集成部署与验收。|
|GUIDE-02|[ ] 待验收|codex-f-01a0c7c8-guide02-20261009（I指定）|独立/Users/limengzhe/.codex/worktrees/guided-interview-photos/人生剧本；codex/guided-interview-photos，干净基线0f52ac6；仅src/modules/profile/infrastructure/{interview-planner.ts,profile-repository.ts}、src/modules/profile/application/person-extraction.ts；新tests/guide-02.test.ts、tests/integration/guide-02.test.ts、docs/task-reports/GUIDE-02.md及本人主表行；PG55452已停止释放/HTTP3246从未启动并释放|2026-10-09独立提交e3809a4，干净codex/guided-interview-photos，基线0f52ac6，仅6登记文件。interview-1.8.0主动暂定开场/公开人物/眼下行动，已答/已问上下文、无目标也构思、停止时倾听，不伪造创建。无新增公共契约；用户完整古惑仔/自由/两图后补教导主任和班主任女友及小芳/王大毛逐图关联，中性照片人物标签及照片消息+说明来源，不记现实职务/恋爱。无自拟24h限制，明确最近组/当前第二图可用，否定最近组/未知历史组不猜；同人模型与字面去重、来源新证据即合并，两数组去重后容量原子停止不slice。按PHOTO-ROLE-01协调修共享首图/删除后不自动设本人头像，不批改旧头像/删访问数组。build/typecheck/247边界/格式/diff通过，真实PG新专项10/10；全量403=402通过/1旧M04失败；真实PG77=71通过/2旧life-drafts失败/4模型跳过，原npm check未通过不冒称。准确未提交兼容补丁.local/guide02-required-test-updates.patch，兼容副本5/5，仅供I正式同步复验。根二审故事职业/出生年份仍可经interview-repository独立basicInfo入口写现实，已如实报告，完整虚构资料隔离未完成；不越界改该入口。实际模型仅fixture未调用、未上线；I接共用基础资料/照片seed-draft用途/旧测试/双身份4—6轮和照片分支全链路、38迁移/Ready公网。报告/Users/limengzhe/.codex/worktrees/guided-interview-photos/人生剧本/docs/task-reports/GUIDE-02.md含实现、失败及限制，停止6文件写入交I，PG55452已核对停止释放，3246未启动，NAR02S e6ae752保持待验收，不自领任务。|

|PEOPLE-01|[x] 已完成|codex-f-01a0c7c8-people01-20261008（I指定）|独立工作树.local/worktrees/people01，基线b481425；contracts/{seeds,life-drafts,world-build,album}.ts; discovery/infrastructure/{seed-repository,draft-repository}.ts; world/infrastructure/{world-planner,build-handler,build-repository}.ts; world/domain/types.ts; media/infrastructure/{asset-repository,album-projection}.ts; app/api/v1/assets/[id]/route.ts; features/discovery/{draft-editor.tsx,draft-editor.module.css,seed-consent.tsx}; features/phone/{world-app-data.ts,apps/types.ts,apps/photos.tsx}; db/migrations/0035_world_person_bindings.sql; tests/{people-world,world-build,world-app-data}.test.ts; tests/integration/people-world.test.ts; docs/task-reports/PEOPLE-01.md|独立提交e2a1f6d；check 280/280、build通过；独立PostgreSQL55435新增链路通过，全量46/47（未登记的life-drafts旧照片授权断言需I更新）；真实模型新世界与图片HTTP读回、390/PC截图完成；详见工作树报告。待I集成、0035生产迁移及部署，本批未上线；普通头像只展示、生成/临时加人/删除留后续。|

|PEOPLE-01I|[x] 已完成|codex-main-people01i-20261008|主目录；集成e2a1f6d全部PEOPLE-01文件、tests/integration/life-drafts.test.ts、features/interview/life-events.tsx上传数量提示与输入恢复、server/image-upload.ts multipart额外开销上限、docs/task-reports/PEOPLE-01I.md、部署及主表；本地3218/55432，生产迁移0035|验收好友原图→新分支头像/相册，修正旧照片断言，check/build/真实库/双端/公网实测后部署；保留LIB-04B未交付修改不纳入发布|

|BRANCH-01Q|[x] 已完成|codex-branch-audit-01a11a84-20261008（单人自审）|工作树branch-create-fix；discovery-planner、world-planner、branch-intent及各自测试；专用55436已停止，文件与资源释放|用户授权后复现非法JSON/漏资料引用及原创配角错误sourcePersonId，严格校验及受限纠正修复；286项check/build、3推荐+世界真实模型、生产35迁移一致；8969278 / a2kuw9rov Ready，公网合成推荐→草案→世界→NPC回复/幂等及390/1440入口通过，见BRANCH-01Q报告。|

2026-10-08 集成人PEOPLE-01/01I验收：280常规、47真实库及build通过；生产35迁移，586868f / bfyho2qwx Ready，公网合成完整好友带入→角色头像与相册→NPC真实回复/刷新/隔离以及390/1440UI通过，超大图恢复与4MiB边界通过；本批已上线。PEOPLE-01行原待验收描述为交接历史，最终状态以本条及PEOPLE-01I报告为准。聊天自动关联、既有世界加入、图生图与公开设定不在本批。

|PEOPLE-02|[x] 已完成|codex-f-01a0c7c8-people02-20261008（I指定）|独立工作树.local/worktrees/people02，基线8969278；src/contracts/api.ts; profile/domain/person-record.ts; profile/application/person-extraction.ts; profile/infrastructure/{profile-repository,interview-planner,interview-handler,interview-repository}.ts; features/interview/{life-events,person-editor,interview-app}.tsx及person-editor.module.css; features/discovery/draft-editor.tsx; features/api/client.ts; db/migrations/0036_profile_person_records.sql; tests/{person-record,interview-agent,client}.test.ts; tests/integration/{person-record,interview-people}.test.ts; docs/task-reports/PEOPLE-02.md|资源PostgreSQL55437/预览3227；独立提交45e93a1，18个登记文件；“我的描述”、人物手工资料/真实头像、流式和后台单次访谈整理已接线。check292、真实PG49、真实模型4场景、build及390/PC上传刷新通过；共同经历模型归类仍会漏提，详见.local/worktrees/people02/docs/task-reports/PEOPLE-02.md。I授权公共profile契约/迁移单一实现及干净树interview-app/client接线，主目录LIB-04B保留交由I合并；不碰BRANCH-01Q文件、不部署，世界消费另列PEOPLE-02B。 用户明确授权由PEOPLE-01R接管集成：45e93a1已通过efe2747合入，609e266生产Ready，0036应用；307check/build、49PG、4真实访谈、本地双端与公网完整朋友世界检查通过。原开发资源由原负责人管理，本项集成文件全部释放；见PEOPLE-01R及PEOPLE-02补记。|

|PEOPLE-01Q|[x] 已完成|codex-friend-qa-01a11a84-20261008|主目录业务代码只读；仅 docs/task-reports/PEOPLE-01Q.md、本人行与部署记录；测试用独立合成访客和临时脚本，不改PEOPLE-02在途实现|审查范围自审完成：286check/build、真实PG、生产合成同名朋友快照/原图/角色/真实NPC/隔离；首次失败后新任务重试成功，取消遗留和角色语义反例待修。报告0e54396发布1vtm36l84 Ready、公网200；资源已清理。见[报告](task-reports/PEOPLE-01Q.md)。|

|PEOPLE-01R|[x] 已完成|codex-friend-fix-01a11a84-20261008|集成自审已完成；业务609e266合入主目录，原登记全部文件释放；PG55438/预览3234已停止；friend-feature-fix申请归档|[报告](task-reports/PEOPLE-01R.md)：用户授权集成PEOPLE-02新版；替代任务重试、同名人物固定映射、角色约束、丰富描述/经历裁剪与临时照片清理。36生产迁移一致；307check/build、49真实PG、4真实访谈、本地390/1440及公网34项完整朋友世界流程通过；Production nhtcmn277 Ready，线上手机上传关闭图404且旧资料保留。world/turn-planner及本任务公共契约/0036文件全部释放；其他未交付任务保留。|

|NAR-02R|[x] 已完成|codex-f-01a0c7c8-nar02r-20261008（I指定）|交接52213cf至NAR-02RI唯一执行集成人；原return-messages工作树保留干净证据，全部登记业务文件已释放；PG55439已停止，3235未启动并释放|2026-10-08：独立提交52213cf（整理本人WIP d41c726），基线2385ce9，8个登记文件，工作树干净。角色可见历史/间隔与具体下一步、来源裁剪、有限后果/媒体guard、末条有限抽样日期保留；check312/边界208/typecheck及最终build、改动文件格式通过。真实PostgreSQL18.4/55439：全量53项，51通过/2opt-in跳过；新增并发、跨用户、暂停、次日不重复、私聊/撤回来源、unknown等反例通过。真实gpt-4o-mini两身份×1.5h/120h共4调用，消息/事件/choice.next_step来源读回及重复无再调用通过。精确文件、样本、早期失败及语义/自然度边界见.local/worktrees/return-messages/docs/task-reports/NAR-02R.md。无UI/迁移/公共契约修改，本批未上线；交现集成人合并、迁移一致性、READY和公网手机验收，未勾完成，不领GROUP-01。 2026-10-08辅助确认停止修改NAR，范围/资源释放，验收仍归NAR-02RI。 NAR-02RI授权集成已完成：1dc7c45 / 4gz1pogvu Ready，342check/51PG/4真实模型与公网9项/双端通知日期重复暂停通过，业务文件释放；原55439/3235资源由原负责人清理。质量和失败边界见NAR-02RI。|

|SCENE-00|[ ] 待验收|codex-main-scene00-20261008（I）|主目录；仅docs/SCENE_GROUP_RETURN_PLAN.md、docs/EXPERIENCE_IMPLEMENTATION_HANDOFF.md、docs/task-reports/SCENE-00.md及本人主表登记，不改业务代码/契约/迁移|用户要求规划单聊/群聊/现场、按需图文与视频、人物对白/旁白区分；核对当前群聊菜单仅占位。回归消息实现继续NAR-02R，PEOPLE-01R/02文件保留；用户已授权进入开发，分工交接见EXPERIENCE_IMPLEMENTATION_HANDOFF.md；本批规划不代表新功能实现或上线。|

|PLAY-01|[x] 已完成|codex-play01-20261008（I指定）|独立工作树/Users/limengzhe/.codex/worktrees/play-01-contracts/人生剧本，分支codex/play-01-contracts、基线609e266；仅src/contracts/world-experiences.ts、src/modules/world/domain/experience-rules.ts、tests/{experience-rules,world-experience-contracts}.test.ts、docs/task-reports/PLAY-01.md|2026-10-08交付d689790；新增27专项反例，完整check334/边界209/typecheck/build通过；专用PG55440应用既有36迁移供check既有测试，测试后停止。owner/world/event来源、群加入含/退出不含及重入间隙、现场观察、真实输入、未裁定/unknown、事项证据、单一现场及媒体资产均有规则；无既有私聊/引擎/DB/前端修改。交I统一集成部署，未上线验收不标完成；见[报告](task-reports/PLAY-01.md)。 PLAY-01I复核4739316集成，334check/49真实PG/build/36生产迁移一致及Ready公网8项回归通过，新增5文件释放；基础契约完成，群/现场功能另验收。|

|GROUP-02|[x] 已完成|codex-f-01a0c7c8-group02-20261009（I指定）|独立工作树/Users/limengzhe/.codex/worktrees/group-phone-ui/人生剧本；codex/group-phone-ui，基线39700c2+原48f6fcc依赖（2d715b6）；src/features/phone/apps/messages.tsx；src/features/phone/groups/{client.ts,state.ts,use-groups.ts,group-create.tsx,group-list.tsx,group-chat.tsx,group-members.tsx,groups.module.css}；tests/{group-client,group-ui-state}.test.ts；docs/task-reports/GROUP-02.md及GROUP-02-390.png、GROUP-02-PC.png；PG55443/预览3237已停止释放（原GROUP-01已释放，按I协调复用）及本人主表行|独立提交418ea08，14个登记文件，codex/group-phone-ui工作树干净。372check/239边界/typecheck、登记格式、最终build及390/1440截图通过；真实PG18.4/55443的UI创建/成员/退出重入/已读/持久输入/unknown刷新attempts=1通过。依赖仓储专项2通过/1原48f6fcc固定日期过期失败/1模型跳过，修正归GROUP-01I，未改他人文件；长历史72条用明确stub布局回复，不算真实模型或生产。详情在/Users/limengzhe/.codex/worktrees/group-phone-ui/人生剧本/docs/task-reports/GROUP-02.md；自动审批拒绝原树模型凭据复用，未执行，真实模型成功待授权或I接续。公共通知caller/desktop badge/group target与LOCK-02由I串行接线，生产38迁移/READY/公网UI仍待验收，本提交尚未上线。不修改共享接口/Provider/导航/公共样式；合成账号已清理，浏览器完成，PG55443/3237停止释放。停止本任务写入等待I接管，不自动领取其他任务。 最终联合验收：26ba6b7；Production344kdxj3a / dpl_5PrfmDxg1gveHyANC3BSz3FhMjFn READY；393check/63真实PG+3可选跳过/build、38生产迁移一致、两身份真实模型和公网46项及390/1440通过；本项集成文件全部释放，PG55447/3240/3241停止，见SCENE-02报告。|

|SCENE-01|[x] 已完成|codex-scene01-01a11a84-20261008（指定执行/集成自审）|统一业务430d25f；独立scene-text-runtime已提交归档；PG55442停止；0037、现场契约/域/仓储/Planner/API/测试及services/worker全部登记范围释放|[报告](task-reports/SCENE-01.md)：355check/53真实PG+2可选跳过/build；两身份真实多轮9调用及此前12调用；生产37迁移一致、1iuggd0nw READY；公网39项实际日程→现场行动→来源/幂等/返回恢复/暂停离场/隔离及真实私聊记忆承接通过。仅后端，SCENE-02 UI/定向耳语/长期任务/媒体未交付；GROUP共享接线可由I串行接续。|

|SCENE-02|[x] 已完成|codex-phone-integration-01a11a84-20261009（I授权串行集成）|scene-phone-integration独立树；新增features/phone/scenes/{client,state,scene-panel,scenes.module}.ts(x/css)，tests/scene-client、scene-ui-state；src/modules/world/infrastructure/{scene-planner,scene-task-handler}.ts及tests/scene-planner.test.ts（真实空关联失败修复）；world-phone-app.tsx、navigation.ts、phone-shell.tsx、apps/{calendar,types,provider}.tsx、phone-icons.tsx及tests/phone-navigation.test.ts；专属报告|现场文本流/事项/自由行动/恢复/日程入口；与时间管理、LOCK及PLAYER统一验收部署，PG55447/3240，PLAYER原始HTTP负例实例3241（同一独立测试库）。 最终联合验收：26ba6b7；Production344kdxj3a / dpl_5PrfmDxg1gveHyANC3BSz3FhMjFn READY；393check/63真实PG+3可选跳过/build、38生产迁移一致、两身份真实模型和公网46项及390/1440通过；本项集成文件全部释放，PG55447/3240/3241停止，见SCENE-02报告。|

|NAR-03S|[ ] 待开发|未领取|按需静态媒体联动|衔接已有NAR-03，不替换原任务；来源/成本/去重/unknown/人物参考/成功素材、消息和相册一致；真实服务验证后启用; [plan](SCENE_GROUP_RETURN_PLAN.md); no business files claimed.|

|SCENE-03|[x] 已完成|codex-scene03-transition01-01a11a84-20261009（指定唯一执行集成人）|独立scene-index-transitions集成c5391cc，主目录业务3c51cdf；本登记业务文件已释放，集成树保留供后续；PG55450/3244本轮已停止HTTP，DB收尾中|2026-10-09集成自审通过：435check、83真实PG/5显式模型跳过/build、生产38校验一致；Production10sdj2uwh READY/正式地址已切换；联合公网40+旧现场4只读+回访0/0，修正版三新访客三反例及明确现实恢复通过，390/1440中性照片称呼；详见本人报告。新增PHOTO-COMPOSE-02与BOOT仍未完成，不把本批成功当所有照片顺序修复。|

|MEDIA-VIDEO-01|[ ] 待开发|未领取|少量关键片段视频验证|依赖静态媒体；默认不自动生成，不阻塞文字，不提前决定主角行动；成本/一致性/时延真实验证; [plan](SCENE_GROUP_RETURN_PLAN.md); no business files claimed.|

|EXPERIENCE-10|[ ] 待验收|codex-main-experience10-20261009（I协调）|主目录仅docs/PLACE_SCENE_TRANSITION_PLAN.md、docs/task-reports/EXPERIENCE-10.md及本人登记；只读实现、报告和验收|已交规格与分工，SCENE-03/TRANSITION-01及NAR-02S实际领取；SPACE-01Q和PLAY-QA-01已审阅，首版旅行建议完整略过单事务，不把动画当完成。QA两全新生产访客首句unknown/UNKNOWN，已交集成人优先诊断；完整双端旅程未测不冒称通过。新文档快照待当前集成人验收发布，业务开发仍进行中；旧LIB-04B保留。|
|TRANSITION-01|[x] 已完成|codex-scene03-transition01-01a11a84-20261009（指定唯一执行集成人）|独立scene-index-transitions集成c5391cc，主目录业务3c51cdf；本登记业务文件已释放，集成树保留供后续；PG55450/3244本轮已停止HTTP，DB收尾中|2026-10-09集成自审通过：435check、83真实PG/5显式模型跳过/build、生产38校验一致；Production10sdj2uwh READY/正式地址已切换；联合公网40+旧现场4只读+回访0/0，修正版三新访客三反例及明确现实恢复通过，390/1440中性照片称呼；详见本人报告。新增PHOTO-COMPOSE-02与BOOT仍未完成，不把本批成功当所有照片顺序修复。|
|SPACE-01Q|[ ] 待验收|codex-space01q-20261009（I指定）|主登记目录；基线13634ad；只读现有时钟/现场/事件/投影，无数据库/模型/端口资源；仅docs/task-reports/SPACE-01Q.md及本人登记|2026-10-09自审交[报告](task-reports/SPACE-01Q.md)：enter仅参与非物理到达；稳定地点/位置/知情、单事务跳过与途中阶段、clock并发/回执唯一事件/replay、旧世界/时区候选；2因果正例及18组验收反例。既有纯规则49通过，无业务/数据库/模型/构建/部署；耗时/暂停/分段政策未定，迁移及公共接线交I另申请。|

|PLAY-QA-01|[ ] 待验收|codex-npc-audit-playqa01-20261009（I指定）|主登记目录；仅 docs/task-reports/PLAY-QA-01.md、本任务主表行；业务代码只读。Ego TaskSpace 83 已结束；本人合成访客临时凭据已清理；无数据库/构建/预览端口|2026-10-09 [报告](task-reports/PLAY-QA-01.md)：两位独立新访客首条访谈均 SSE error UNAVAILABLE、输入保存且任务 unknown/UNKNOWN；不重试，已通知 I。默认浏览器 profile 与其他任务共享，完整 390/PC 私有旅程未测，不当业务 bug；现场 UI 的记录/输入入口另做代码只读观察。请求 I 核对根因并决定后续隔离浏览器验收。|

|GROUP-01|[x] 已完成|codex-f-01a0c7c8-group01-20261008（I指定）|独立48f6fcc交GROUP-01I唯一集成人；原group-runtime工作树干净证据保留，全部16个登记业务文件/迁移0038已释放；PG55443/预览3237已停止并释放|2026-10-09：独立提交48f6fcc，基线50fcaca，16个登记新文件，工作树干净。群四表/真实来源RLS、成员加入退出重入、一致历史隔离、相关NPC、现有world队列与幂等回执、提议日程/显式确认、已读和故事/提交时间、专属API已实现。最终341check/220边界/typecheck/格式/build通过；真实PostgreSQL18.4/55443全量54项=52通过+2可选模型跳过；两身份真实gpt-4o-mini群回合、来源落库/重复无再调用通过，生产构建本地HTTP21请求（含拒绝反例）通过。失败历史及完整接线见.local/worktrees/group-runtime/docs/task-reports/GROUP-01.md。无UI/公共契约改动，群附件media=[]待公共请求协调；共用World replay/branch、全局world worker分派须现集成人串行接线，0037验收后再生产0038、READY/公网/双端，不宣称已上线或GROUP-02完成。PG55443/预览3237已停止并释放，业务范围保持本Agent至集成；不自动领取其他任务。 2026-10-09依I指令释放全部GROUP-01业务范围，不再修改；待验收归GROUP-01I。 GROUP-01I已统一验收6890d17/e3b7xf81l READY，38迁移/367check/56PG及公网真实群通过；本批后端完成、全部范围释放，UI/媒体仍未交付。|

|PLAY-01I|[x] 已完成|codex-play01i-01a11a84-20261008（授权集成人）|4739316主目录统一基线；独立play-01-integration申请归档；PG55441停止，全部本项文件释放|[报告](task-reports/PLAY-01I.md)：334check、49真实PG/1可选模型跳过、build通过；生产36项迁移一致；5p948gk00 Ready，公网旧世界真实私聊/回执/重读/隔离等8项通过。仅基础契约，不是群/现场功能上线；SCENE-01后续依赖迁移号/接线协调。|

|NAR-02RI|[x] 已完成|codex-nar02ri-01a11a84-20261008（指定集成人）|独立return-message-integration收尾归档；PG55444/预览3238已停止；原8文件及world-build契约/两测试和本任务全部文件释放；统一业务1dc7c45|[报告](task-reports/NAR-02RI.md)：342check/51真实PG/2可选模型默认跳过/build，36生产迁移一致；第三轮4真实模型通过（前两轮失败保留）。修否定漏拦截、pending成果/来源与公网choice派生ID503（来源/关联日程同修）；最终4gz1pogvu Ready。公网9项、390/1440通知→会话、旧日期/重复/暂停，最终phone200/paused0通过。指导型口吻及未实现真实幕后成果边界保留；不自动重付。|

SCENE-00协调补充（2026-10-08）：SCENE-01预留0037/PG55442，现场专属实现及services/必要共享事件入口本阶段仅由该执行线程写；GROUP-01预留0038/PG55443/预览3237，辅助可领取群专属实现，共享接线交集成人串行处理。实际文件清单和领取状态由负责人短锁登记。最新规则见规划第十一节，不在当前世界提供导演对话改设定。旧LIB-04B不夹带发布。

|PLAY-02Q|[ ] 待验收|codex-play02q-20261008（I指定）|主登记目录只读业务代码；仅docs/task-reports/PLAY-02Q.md及本人主表登记；无数据库/端口/模型资源|2026-10-08已交[报告](task-reports/PLAY-02Q.md)，基线50fcaca；发现内部persona-to-summary和公开character memory暴露边界、真实导演入口/HTTP写入仍开放、时间/首幕硬编码及CurrentMatter尚非长期任务引擎。合成transport/SQL适配样本复现，32既有相关测试通过；给最小完整修正范围和9组反例。仅报告无业务改动/部署；等待I审阅，不擅定任务数/时间规则、不覆盖其他任务。|

|EXPERIENCE-09|[ ] 待验收|codex-main-experience09-20261009（I）|主目录；仅docs/PRESET_SCRIPT_AND_RETURN_SPEC.md、EXPERIENCE_IMPLEMENTATION_HANDOFF.md、SCENE_GROUP_RETURN_PLAN.md、task-reports/EXPERIENCE-09.md及本人登记；只读验收报告和协作|规划与分工收尾，交当前唯一执行集成人干净发布树提交，不夹带LIB-04B。用户确认预设由相关人员提供不现定编排；任务自然表述、输入识别、真实跨日折叠与反馈已记录。LOCK675fa87/PLAYERb64c385待接线，准确shell scene/time范围转集成人串行；两处PLAYER旧公开预期批准重跑，direction与时间UI联动；不将本轮文档或实现提交称新UI已上线。|

2026-10-09 接续协调：GROUP-01I由排查分支创建失败线程集成48f6fcc、共用replay/worker分派与0038，Ready/公网后验收；随后SCENE-02及WORLD-CONTROL-01UI，该线程独占world-phone-app与共享客户端/导航接线。辅助接GROUP-02专属群组件、专用API client、messages.tsx，必要Provider/显示类型准确申请，不写共享caller。play_contracts接PLAYER-01后端玩家公开投影/记忆边界/公开direction禁用，不写services/worker/replay/UI；npc_audit接LOCK-02 phone-shell/phone.module.css/notification helper，不写caller或世界调度。领取前执行者各自短锁登记准确范围，公共接线由同一执行集成人串行发布。新的任务数量/时间改制/预设剧本事件顺序还在讨论，不硬编码。

EXPERIENCE-09用户随后明确：预设内容由相关人员提供，本轮只需记录前提；停止要求用户决定剧本结构，不启动编排算法或新的剧本制作任务。既有体验/公开边界/锁屏工作继续。

|NAR-02S|[ ] 待验收|codex-f-01a0c7c8-nar02s-20261009（I明确分配）|独立/Users/limengzhe/.codex/worktrees/return-followups/人生剧本；codex/return-followups，基线13634ad；仅src/modules/world/application/advance-world.ts、src/modules/world/domain/agenda.ts、新增src/modules/world/domain/return-followups.ts、src/modules/world/infrastructure/turn-planner.ts；新增tests/return-followups.test.ts、tests/integration/return-followups.test.ts；docs/task-reports/NAR-02S.md及本人主表行；PG55448已停止释放/预览3242从未启动并释放|独立提交e6ae752，只含7个登记文件，工作树干净。400check/248边界/typecheck、格式/diff、build通过；最终独立PostgreSQL18.4/55448全量74项=69通过/5可选跳过，新专项7通过/1模型跳过。单联系人三日期有来源阶段、多联系人三拍上限、持久12h冷却、无事/旧选择/暂停/过期邀约/重放/unknown/部分提交补账/撤回日程来源和两身份两账号隔离通过。fixture Planner仅测试，未冒充真实模型；真实模型opt-in及追加失败/部分来源证据已准备，按I最新QA两访客SSE unknown诊断要求暂停调用，不推断欠费、不读/复制AI配置、不重复申请已有授权、不绕过旧审批。报告/Users/limengzhe/.codex/worktrees/return-followups/人生剧本/docs/task-reports/NAR-02S.md记录初次类型/夹具/停库失败及最终复验。只对已保存新日程节点或版本证据新结果开放跨日，不承诺每天新成果；不改clock/1:1/三拍预算/UI/services/契约/迁移。本批未上线，交现业务集成人串行真实模型/38迁移核对/READY/公网验收后标完成。PG55448停止释放，3242从未启动，停止本范围写入等I接管，不自领新任务。|
|NAR-02SI|[x] 已完成|codex-phone-batch-integrator-01a11a84-20261009（指定唯一业务集成人）|独立scene-index-transitions集成c5391cc，主目录业务3c51cdf；本登记业务文件已释放，集成树保留供后续；PG55450/3244本轮已停止HTTP，DB收尾中|2026-10-09集成自审通过：435check、83真实PG/5显式模型跳过/build、生产38校验一致；Production10sdj2uwh READY/正式地址已切换；联合公网40+旧现场4只读+回访0/0，修正版三新访客三反例及明确现实恢复通过，390/1440中性照片称呼；详见本人报告。新增PHOTO-COMPOSE-02与BOOT仍未完成，不把本批成功当所有照片顺序修复。|

|GROUP-01I|[x] 已完成|codex-group01i-01a11a84-20261009（指定唯一执行集成人）|业务6890d17；独立group-runtime-integration已提交归档；0038/群16文件、worker/history/专属测试全部释放；报告/部署与明确规划快照归档；PG55445已停止|[报告](task-reports/GROUP-01I.md)：367check、56真实PG+3可选跳过/build；37→38升级、38生产迁移一致；两身份及未来故事实际模型通过；e3b7xf81l READY，公网23+13项真实群/显式重试/成员/未读/隔离/暂停与私聊不污染。初版过期邀约失败保留；仅后端，媒体空、GROUP-02/SCENE-02另验收。|
|LOCK-02|[x] 已完成|codex-f-lock02-20261009-01（I指定）|独立工作树/Users/limengzhe/.codex/worktrees/lock-02-notifications/人生剧本，基线39700c2；仅phone-shell.tsx、phone.module.css、notification-state.ts（如需）、新增notification-projection.ts、tests/notification-projection.test.ts、专属报告；world-phone-app caller由I串行接|真实全量授权未读按app+kind+target折叠，原文代表条目/真实计数/时间，展开逐条直达与可访问；不截断源集合/捏造消息；390/1440、check/build；I集成caller与部署验收。 独立提交675fa87待集成，未上线；见报告。 最终联合验收：26ba6b7；Production344kdxj3a / dpl_5PrfmDxg1gveHyANC3BSz3FhMjFn READY；393check/63真实PG+3可选跳过/build、38生产迁移一致、两身份真实模型和公网46项及390/1440通过；本项集成文件全部释放，PG55447/3240/3241停止，见SCENE-02报告。|

|PLAYER-01|[x] 已完成|codex-player01-20261009（I指定）|独立工作树/Users/limengzhe/.codex/worktrees/player-01-boundary/人生剧本，codex/player-01-boundary，基线39700c2；src/contracts/world-build.ts；src/modules/world/infrastructure/{world-planner,build-handler,build-repository}.ts；src/modules/world/domain/player-projection.ts；src/modules/memory/infrastructure/{memory-store,candidate-repository}.ts；src/app/api/v1/memory/{records,candidates}/route.ts；src/app/api/v1/worlds/[id]/direction/route.ts；tests/player-projection.test.ts、tests/integration/player-boundary.test.ts、world-build.test.ts指定可见人数/内部ties断言；docs/task-reports/PLAYER-01.md。不改services/worker/domain/types/客户端/UI/clock/advance-world/群现场；PG55446、HTTP3239，模型仅合成身份|2026-10-09交b64c385（13登记文件），独立树干净；check359/边界222/typecheck/build通过，新纯规则4、真实PG/最终生产构建HTTP6组、两身份实际模型前后4调用。服务端人物真实来源/按ID映射、禁persona及无来源开场便签、公开memory/candidate读写边界、direction含preview鉴权410；内部数据/原图/clock保留。全量DB56通过/2旧公开预期失败/3可选跳过，安全预期兼容副本串行3通过，准确补丁.local/player-required-test-updates.patch待I正式同步并重跑。仅待验收，未部署；WORLD-CONTROL-01UI需联动clock迁出，历史guidance内用仍待I裁定；PG55446/HTTP3239停止、依赖链接已移除。见工作树docs/task-reports/PLAYER-01.md，不宣称全语义防剧透或已上线。 最终联合验收：26ba6b7；Production344kdxj3a / dpl_5PrfmDxg1gveHyANC3BSz3FhMjFn READY；393check/63真实PG+3可选跳过/build、38生产迁移一致、两身份真实模型和公网46项及390/1440通过；本项集成文件全部释放，PG55447/3240/3241停止，见SCENE-02报告。|

|WORLD-CONTROL-01UI|[x] 已完成|codex-phone-integration-01a11a84-20261009|scene-phone-integration；world-phone-app.tsx、navigation.ts、phone-shell.tsx、新增time-panel.tsx及样式；src/contracts/world-clock.ts与tests/clock-client.test.ts（实际POST committed回执兼容，API client其他人文件不动）；tests/phone-navigation.test.ts；报告|只保留clock暂停/倍速/推进/unknown恢复，director深链alias到time，去除导演编辑，联合PLAYER410后部署。 最终联合验收：26ba6b7；Production344kdxj3a / dpl_5PrfmDxg1gveHyANC3BSz3FhMjFn READY；393check/63真实PG+3可选跳过/build、38生产迁移一致、两身份真实模型和公网46项及390/1440通过；本项集成文件全部释放，PG55447/3240/3241停止，见SCENE-02报告。|
|LOCK-02I|[x] 已完成|codex-phone-integration-01a11a84-20261009|承接675fa87全部5文件与报告，world-phone-app caller及groups读刷新；报告|全量真实未读/预约有效期、group真实route；390/1440及公网验收。 最终联合验收：26ba6b7；Production344kdxj3a / dpl_5PrfmDxg1gveHyANC3BSz3FhMjFn READY；393check/63真实PG+3可选跳过/build、38生产迁移一致、两身份真实模型和公网46项及390/1440通过；本项集成文件全部释放，PG55447/3240/3241停止，见SCENE-02报告。|
|PLAYER-01I|[x] 已完成|codex-phone-integration-01a11a84-20261009|承接b64c385全部13文件；tests/integration/{world-build,setting-trials}.test.ts批准旧预期；build-repository.ts/player-projection.ts实际group/scene可见联系；专属报告|完整真实PG重跑，UI时间联动及公开边界；保留内部历史guidance，联合发布。 最终联合验收：26ba6b7；Production344kdxj3a / dpl_5PrfmDxg1gveHyANC3BSz3FhMjFn READY；393check/63真实PG+3可选跳过/build、38生产迁移一致、两身份真实模型和公网46项及390/1440通过；本项集成文件全部释放，PG55447/3240/3241停止，见SCENE-02报告。|
|GROUP-02I|[x] 已完成|codex-phone-integration-01a11a84-20261009|原GROUP-02停止释放，串行承接418ea08全部14文件及world-phone-app群通知/未读接线；专属报告|实际群后端/两身份/双端/未知恢复、公网验收；无媒体空应用或新增脚本算法。 最终联合验收：26ba6b7；Production344kdxj3a / dpl_5PrfmDxg1gveHyANC3BSz3FhMjFn READY；393check/63真实PG+3可选跳过/build、38生产迁移一致、两身份真实模型和公网46项及390/1440通过；本项集成文件全部释放，PG55447/3240/3241停止，见SCENE-02报告。|

|INTERVIEW-01R|[ ] 待验收|codex-interview01r-01a11a84-20261009（指定唯一业务集成人）|独立/Users/limengzhe/.codex/worktrees/interview-first-turn-recovery/人生剧本，基线13634ad；src/modules/ai/infrastructure/yibu-text-model.ts；src/modules/profile/infrastructure/interview-repository.ts；src/app/api/v1/interview/messages/route.ts；tests/gateway.test.ts与tests/integration/interview.test.ts及本人报告；只读生产合成tasks操作元信息/CLI日志；PG55451/HTTP3245，独立合成模型诊断；不改client/interview-app及其他LIB04B|优先新访客访谈未知故障：两已知QA任务DB实际error_code UPSTREAM_FAILED，公开映射UNKNOWN；未重付，先查HTTP/网络/流式协议，再按证据修复。SCENE03/TRANSITION01新界面未发布，保留独立树继续。0f52ac6/pnka4xaj8 READY与正式别名核验；395check、63真实PG/4可选跳过/build、38生产迁移一致；新隔离访客首轮44片段/1result/0error、任务succeeded、原文回复保存。诊断与未知安全提示已上线；此前上游失败根因未证，不把一次恢复当消除间歇故障。原两任务不重付；SCENE03/TRANSITION01继续。|

|PHOTO-ROLE-01|[x] 已完成|codex-photo-role01-01a11a84-20261009（指定唯一业务集成人）|独立scene-index-transitions集成c5391cc，主目录业务3c51cdf；本登记业务文件已释放，集成树保留供后续；PG55450/3244本轮已停止HTTP，DB收尾中|2026-10-09集成自审通过：435check、83真实PG/5显式模型跳过/build、生产38校验一致；Production10sdj2uwh READY/正式地址已切换；联合公网40+旧现场4只读+回访0/0，修正版三新访客三反例及明确现实恢复通过，390/1440中性照片称呼；详见本人报告。新增PHOTO-COMPOSE-02与BOOT仍未完成，不把本批成功当所有照片顺序修复。|

|BOOT-01|[ ] 待开发|未领取|依赖当前GUIDE-02/PHOTO-ROLE-01联合修复；世界初始前史、既有关系与知情、历史消息/日历/便签/真实素材的同源快照，公共契约/事务/记忆/继承由唯一集成人先冻结范围|2026-10-09用户新增：进入分支应像接手另一个自己的手机，不是零起点。规格INITIAL_PHONE_LIFE_SPEC；不得替玩家编实时输入、不污染现实资料、不临时随机历史/冒充图生成成功。此行仅定义，未领取实现；原开场4消息/notes不代表完整前史已完成。|

|BASICINFO-01|[x] 已完成|codex-basicinfo01-01a11a84-20261009（指定唯一业务集成人）|独立scene-index-transitions集成c5391cc，主目录业务3c51cdf；本登记业务文件已释放，集成树保留供后续；PG55450/3244本轮已停止HTTP，DB收尾中|2026-10-09集成自审通过：435check、83真实PG/5显式模型跳过/build、生产38校验一致；Production10sdj2uwh READY/正式地址已切换；联合公网40+旧现场4只读+回访0/0，修正版三新访客三反例及明确现实恢复通过，390/1440中性照片称呼；详见本人报告。新增PHOTO-COMPOSE-02与BOOT仍未完成，不把本批成功当所有照片顺序修复。|

|GUIDE-02I|[x] 已完成|codex-guide02i-01a11a84-20261009（指定唯一业务集成人）|独立scene-index-transitions集成c5391cc，主目录业务3c51cdf；本登记业务文件已释放，集成树保留供后续；PG55450/3244本轮已停止HTTP，DB收尾中|2026-10-09集成自审通过：435check、83真实PG/5显式模型跳过/build、生产38校验一致；Production10sdj2uwh READY/正式地址已切换；联合公网40+旧现场4只读+回访0/0，修正版三新访客三反例及明确现实恢复通过，390/1440中性照片称呼；详见本人报告。新增PHOTO-COMPOSE-02与BOOT仍未完成，不把本批成功当所有照片顺序修复。|


|PHOTO-QA-02|[ ] 待验收|codex-f-01a0c7c8-photoqa02-20261009（I明确分配）|主目录仅docs/task-reports/PHOTO-QA-02.md及本人行；稳定48942cd独立纯规则/源码审查，无DB/构建/浏览器/模型资源|2026-10-09实质复核交付：287文件hash与候选一致，亲跑61纯测试通过，16合成观察13通过/3失败。P1 QA-B1/B2否定回现实与B3假设演绎仍泄出现实生日职业；P2草案现实关系/中性照片标签误导。完整15项矩阵和三入口接续见报告；I的433check/83PG+5skip及981c3ad/Production1i8xoeb5w READY仅引用，未亲跑PG/公网、不标业务安全通过；不改集成代码，待I审阅修复/发布。 追加c5391cc独立原样纯复验16/16，原3P1返回空；没有本人三入口PG/公网证据。数量勘误已保留，原报告统计17/14实际16/13。|

|BOOT-01A|[ ] 待验收|codex-f-01a0c7c8-boot01a-20261009（I明确分配）|主登记目录仅docs/PHONE_PREHISTORY_IMPLEMENTATION_PLAN.md、docs/task-reports/BOOT-01A.md及本人行；只读48942cd，无数据库/端口/构建/浏览器/模型/迁移资源|2026-10-09文档方案已交：同源不可变前史、条目来源/知情/公开、旧来信与过去未来日程/便签/实际素材、初始读态、创建队列事务/hydrate同ID覆盖/replay/记忆/回访、旧世界和授权预设继承；候选工作包/文件依赖及14组验收场景。20引用源码路径存在、文档一致与diff检查通过；仅设计，无真实模型/PG/双端/部署、未提交别人的脏树。BOOT-01仍待开发，非功能上线；I先处理PHOTO-QA P1并完成当前发布，再冻结公共契约/来源/T0/已读和实际实施登记。|

|PHOTO-COMPOSE-02|[x] 已完成|codex-f-01a0c7c8-photocompose02-20261009（I明确指定/文件已释放）|独立/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/photo-compose-02，基线3c51cdf；实际仅interview-app.tsx、interview-composer.module.css、photo-share.ts、person-extraction.ts、新tests/photo-compose.test.ts及本人报告6文件；原登记其余文件未改。已停止全部业务文件写入供I串行集成；HTTP3247/3248核对本人cwd后停止释放，专属浏览器87已关闭；无DB/模型/迁移资源|2026-10-09独立提交6d3f66baf20dad939d52fb1af34f185c5321eb2f，工作树干净。选图本地预览/移除更换零上传、说明后显式统一发送、纯图、失败保留与unknown沿用原命令重读、新草稿不覆盖；仅持久唯一人物关联标记。两图分两说明/旧组后最近单图近指修复，有界扫描及冲突拒绝。35专项/19纯观察通过，build/typecheck/258边界/格式/diff通过；完整check444=440通过/4默认PG55432 ECONNREFUSED，未冒称全绿/真实库。390×560和1440合成真实浏览器操作及截图见docs/task-reports/PHOTO-COMPOSE-02.md，非模型/PG/线上验收。已同步报告交PHOTO-COMPOSE-02I；I接真实PG/SSE/模型/完整check及38迁移/READY公网。本批未上线，上一批生产10sdj2uwh；不自领BOOT/视觉或其他任务。  I集成验收2026-10-09：1acb770/31tjtsm88 READY，447check/92真实PG+5可选skip/build/38迁移；独立冻结原28+额外16/42纯全通过，六失败关闭；I实际公网负例/肯定保存/离线重发/新草稿/390PC/刷新通过；unknown2不重付、视觉及全模型可靠性不在完成范围。|
|VISION-01Q|[ ] 待验收|codex-main-vision01q-20261009（根协调）|主目录仅docs/task-reports/VISION-01Q.md及本人登记；忽略.local/vision01q-probe.mjs/合成结果；无业务/DB/部署写入|亲跑单图纯解析可用、旧图组加新单图及两图分两轮归属反例已交辅助；官方支持图像但项目string/hasPhoto未接。既有网关一次自制无人物图HTTP200识别红圆/蓝矩形，square严格断言未满足、passed=false保留，不冒称视觉准确/上线。报告交I下批合入；实际图文与归属PHOTO-COMPOSE-02仍进行中。|

|PHOTO-COMPOSE-02I|[x] 已完成|codex-photocompose02i-01a11a84-20261009（唯一业务集成人接续）|串行复用scene-index-transitions，稳定c5391cc/主目录3c51cdf；tests/integration/guide-02.test.ts及新增tests/integration/photo-compose.test.ts、tests/photo-compose-runtime.test.ts（重复说明有时限隔离子进程验证）、本人docs/task-reports/PHOTO-COMPOSE-02I.md、忽略合成PG/SSE脚本；PG55450/3244。接收辅助已停写6d3f66b；串行接收interview-app.tsx、interview-composer.module.css、photo-share.ts、person-extraction.ts及tests/photo-compose.test.ts；只修正常发送提示与实测发现问题，不同时写；必要仓储最终入口修复须先准确扩登记|新增图文发送与照片归属接续：复现旧照片组→普通话题→新单图→这是小芳，以及两图分两轮说明；实际PG与SSE验证落库来源/已存在名字/版本/幂等/隔离。接收辅助稳定提交后独立check/build/模型/双端/READY公网，不把原照片成功样例当新反例已修。  2026-10-09接6d3f66b已停写并集成，445check/87真实PG+5可选跳过/build、38生产校验一致；原2漏关联PG现均通过，重复35说明有界、新草稿保护及正常等待文案修正；等待READY与真实公网图文/归属后完成。 2026-10-09独立QA03新增询问/否定/转述误绑真实PG3/3已复现，正在修完整原句门；另上传失败重发的新草稿快照需修后真实浏览器离线/恢复验证，当前线上eabd025正例已过但不称完整交付。 2026-10-09QA03修复独立1ff96d6→主1acb770已推送；447check/92真实PG+5显式可选跳过/build通过，10:40:54Z生产38校验一致；等待31tjtsm88 READY及公网五反例和失败重发，六项失败历史保留，不标完成。 集成自审1acb770/31tjtsm88 READY：447check/92真实PG+5可选跳过/build、38迁移一致；原28观察28通过，公网四反例+单图+失败重发/新草稿/刷新/390PC通过。两unknown保留不重付、重复素材歧义组拒绝符合保护，未声称间歇模型故障或新两图unknown已治；此前可分辨两图公网证据保留。业务文件释放，QA03独立新提交复验仍待辅助；详见本人报告。|

|PHONE-HOME-02|[x] 已完成|codex-main-phonehome02-20261009（根开发接线；I串行生产集成）|managed lock-02-notifications，codex/phone-home-02-integration基线eabd025；仅phone-desktop.tsx/module.css、world-phone-app.tsx的renderHome/import、本人报告。稳定f65c647+2c6bbe7+082aa9e，全部业务停写；独占PG55456/HTTP3251已停止，Ego89关闭，node_modules本人链接释放。照片文件及I资源未动|2026-10-09实际生产构建页面接线与445check全通过、87真实PG/5明确可选模型跳过、build通过；两个真实库合成世界空态/实际相册上传/邀约/跨用户拒绝，390/560/500长标题及1440居中420px，实际日历/相册/返回/切换通过。500首次重叠已修，私有图片503注入后真实回退并恢复。此前生成类型失败和旧DB拒绝记录仍保留，独占环境复查成功。候选未上线，I先完成照片反例公网验收，再接三提交并核对38迁移/最终check/build/READY公网，未验收不完成。 I最终集成验收0278c17/htpk3p8ev READY：447check/build/38生产迁移一致；既有暂停自有两世界实际2原图/日历空态/相册/跨账号404，390×560与500/1440居中420/两链接实际点击/刷新通过，0模型；根有效邀约/全空相册/503回退本地实际库证据保留。业务释放，无完整前史/读图/多聊天，见PHONE-HOME-02I。|
|PHONE-HOME-02I|[x] 已完成|codex-phonehome02i-01a11a84-20261009（唯一业务集成人）|复用scene-index-transitions基线1ff96d6/主1acb770；串行接f65c647+2c6bbe7+082aa9e已释放phone-desktop.tsx/module.css、world-phone-app.tsx与原报告；本人docs/task-reports/PHONE-HOME-02I.md；PG55450，无并行源码写；实际浏览器继续本人84|照片修复447check/92PG+5skip/build、READY与原6项自审及公网重发完成，QA03辅助独立复验待回；先本地集成首页check/build，独立复验关闭后再统一发布首页。保留锁屏/Dock、真实日程/相册空态、旧合成世界390/500/PC与两直达链接，38迁移/READY公网后验收。  独立49a4223→主0278c17已推送；最终447check/build通过，引用照片同基线92PG/根87PG+5skip，本批仅UI无SQL；10:51:34Z生产38校验一致；等待htpk3p8ev READY/正式双端既有暂停合成世界验收。 I最终集成验收0278c17/htpk3p8ev READY：447check/build/38生产迁移一致；既有暂停自有两世界实际2原图/日历空态/相册/跨账号404，390×560与500/1440居中420/两链接实际点击/刷新通过，0模型；根有效邀约/全空相册/503回退本地实际库证据保留。业务释放，无完整前史/读图/多聊天，见PHONE-HOME-02I。|

|PHOTO-QA-03|[x] 已完成|codex-f-01a0c7c8-photoqa03-20261009（根协调明确分配）|主目录仅docs/task-reports/PHOTO-QA-03.md及本人行；只读冻结1acb770aa9df7d1d106c16c080a382e646d12bda，与独立I提交1ff96d6的src/tests一致；412文件SHA256提取及复验后一致，独立/private/tmp/parallel-life-photoqa03-1acb770临时依赖链接已移除。未改业务，无DB/端口/构建/浏览器/模型/部署资源|2026-10-09修复复验交付：原28观察28/28通过，原6失败B1/B2/B3均关闭；补16肯定/截断模型引用/换图/明确新组合/空说明/新草稿回归16/16通过，合计44/44；六文件纯测试42/42通过0跳过。保留原eabd025失败历史及.local/photoqa03/revalidation-1acb770证据，报告格式/实际diff检查通过。0亲跑PG/浏览器/模型/上线，未全check/build；根协调读取转I补真实事务与双端503/READY公网，不直接消息I、不自部署、不新领功能。  I集成验收2026-10-09：1acb770/31tjtsm88 READY，447check/92真实PG+5可选skip/build/38迁移；独立冻结原28+额外16/42纯全通过，六失败关闭；I实际公网负例/肯定保存/离线重发/新草稿/390PC/刷新通过；unknown2不重付、视觉及全模型可靠性不在完成范围。|


## 2026-10-09 · 多聊天任务链（用户批准；照片优先）

执行方案：docs/MULTI_CHAT_PLAN.md；此处仍是唯一任务状态源。当前只允许独立文档审查。业务实现等照片反例关闭及公网交付、首页交付并冻结基线后领取；旧需求保留。

|任务|状态|唯一负责人/分配|范围与资源|依赖、验收与接续|
|---|---|---|---|---|
|CHAT-SESS-00|[ ] 待验收|codex-main-chatsess-plan-20261009（根协调）|主目录仅docs/MULTI_CHAT_PLAN.md及本人行；只读代码，无DB/构建/浏览器资源|用户已批准；明确资料共享、照片/消息/构思隔离、旧记录保留、幂等及切换回复归属；规划不等于功能完成。|
|CHAT-SESS-01|[ ] 待验收|codex-f-01a0c7c8-chatsess01-20261009（根协调指定辅助）|主目录仅docs/task-reports/CHAT-SESS-01.md及本人行；冻结eabd0255cab9d9cb554f0825d1acecd76f68f61c，独立/private/tmp/parallel-life-chatsess01-eabd025；450文件git对象SHA256一致，62既有影响路径全部存在。业务/契约/迁移/配置始终只读，无DB/端口/模型/浏览器/构建；临时依赖链接已移除|2026-10-09只读审查交付：旧ID/来源与不可变种子世界无损、稳定默认旧入口、02扩展后03/04就绪再解除owner唯一/开放新建、后台owner-only及旧任务兼容、全局discovery与草案/任务隔离、元数据版本/导出分页。补S3基础资料非生日字段未有profile期望版本保护、S4遗忘未统一过滤profile/历史与流式后台记忆差异、S5中性故事标签共享边界。5实际context/schema纯观察0模型，24组待实施负例矩阵；格式/实际新文件diff检查通过，无真实PG/全check/build/公网或业务实现证据。直发I中间风险被自动审批拒绝，根协调已承接读取报告转达，不重试；待采纳。PHOTO-QA-03保留28/6失败，收到修复冻结优先复验；05未领取。|
|CHAT-SESS-02|[ ] 待开发|指定唯一I 01a11a84-9572-7ab0-92fb-967f963dfc20；依赖满足后领取|独立树；公共契约/增量迁移/身份初始化/会话元数据/本人报告；具体文件及独占PG/HTTP由I登记|依赖照片误绑及失败重试修复验收上线、PHONE-HOME-02上线、01审查；保留旧ID与来源，显式session的创建/列表/详情/改名，旧入口稳定指向历史默认聊天。真实PG迁移/RLS/幂等；冻结契约。|
|CHAT-SESS-03|[ ] 待开发|同一I串行实施，领取后登记|访谈仓储/流式/后台、问题、照片、记忆/资料写入、API/server/client及专项测试；02后冻结具体范围|依赖02；owner+interview定位，版本/命令绑定聊天，切换后旧回复不串线；照片归属及重试只看本聊天；资料共享不并发覆盖；拒绝/遗忘不因新建失效。真实PG/SSE/跨用户/并发/故障验收。|
|CHAT-SESS-04|[ ] 待开发|同一I串行接03；辅助只读复核|discovery/草案/种子来源、相关迁移/服务端/专项测试；由I冻结具体范围，不改写旧世界|依赖03；每个聊天的构思不互相覆盖，分支列表统一，保存源聊天/消息及依据快照；历史提案与世界仍可读，授权不变。A/B分别构思并创建世界、跨聊天命令冲突验证。|
|CHAT-SESS-05|[ ] 待开发|指定辅助；稳定契约和I释放界面文件后领取|独立树；历史列表/顶部入口/会话状态、输入恢复/专属样式/测试/报告；interview-app需I停止写入，client及契约仍I单写|依赖03/04；真实新建/历史/改名，草稿/图片/command分聊天；390及短屏/PC、键盘、切换/刷新/流式中断、空/加载/错误验收；不发布假入口。|
|CHAT-SESS-06|[ ] 待开发|I集成部署；辅助独立冻结复验；根协调接收|各自报告/资源先登记；生产迁移、提交推送仅I，无新功能扩写|依赖02—05；check/build、真实PG/RLS/迁移/并发/重启/照片/来源、合成真实AI多轮、双端浏览器、READY后公网旧用户和新用户闭环。未部署/未验证不完成；保留失败和可选跳过。|

## 2026-10-09 图片优先交付链

用户最新要求：优先完成图片功能；执行方案 docs/IMAGE_DELIVERY_PLAN.md。照片组合与绑定、好友原图带入已交付的限定范围保留，不重复实现。多聊天/前史/地图/公开设定不取消，未领取任务等待本批图片主线；状态仍仅以本表为准。唯一业务集成人为现有 01a11a84-9572-7ab0-92fb-967f963dfc20，根协调负责范围与验收接收，辅助独立实现或审查；共享文件不得并行写。

|任务|状态|唯一负责人/分配|范围与资源|依赖、验收与接续|
|---|---|---|---|---|
|IMG-PLAN-01|[ ] 待验收|codex-main-imageplan-20261009（根协调）|主目录仅 docs/IMAGE_DELIVERY_PLAN.md、docs/task-reports/IMG-PLAN-01.md及本批任务定义；无模型/DB/浏览器/源码写入|核对已交付与缺口，图片优先顺序，指派现有线程并等待确认；报告与方案交I提交部署，规划完成不等于图片能力上线。| 2026-10-09: plan/report delivered; 7 task references and 10 source/evidence paths checked, diff clean. Both existing threads received instructions and started VISION-01I / M-01A. Documentation awaits controlled I commit/deploy; no runtime completion claimed.
|VISION-01I|[x] 已完成|codex-vision01i-01a11a84-20261009（唯一业务集成人，图片优先）|复用scene-index-transitions，业务49a4223/主2910e57 src/tests一致；仅ai/application/ports.ts、ai/infrastructure/yibu-text-model.ts，新ai/application/model-content.ts；profile/application/interview-photo-input.ts与新profile/infrastructure/interview-photo-reader.ts；profile/infrastructure/interview-planner.ts、interview-repository.ts、interview-handler.ts；新server/private-asset-store.ts、server/services.ts、worker-composition.ts；必要src/app/api/v1/interview/messages/route.ts仅若组装要求；新tests/vision-input.test.ts、tests/integration/vision-01.test.ts及tests/yibu-text-model.test.ts、新docs/task-reports/VISION-01I.md；忽略自制图/授权模型/公网脚本；独占PG55450重启/HTTP3254；旧LIB/client/interview UI不写|2026-10-09照片与首页最终2910e57/pzz2p539l READY已收尾，旧浏览器84 finish、PG55450已停止供本人重新启动；CHAT-SESS-02未领取/无源码写，仅只读预核。首读官方图片输入文档；冻结有界单图/明确两图，同一轮含说明/像素、当前owner+访谈+持久消息取图，流式/后台对齐，文字端口保持兼容，禁止凭画面推断姓名/关系或视觉写入现实档案；失败如实unknown不自动重付。无SQL预期，必要扩大范围先登记；完整check/build/PG/实际模型/双端/READY公网才验收。 首轮最终454check/99PG+5可选skip/build通过；真实两视觉请求HTTP200但自然语言未JSON导致unknown，第二原始SSE证据已保留且像素计数颜色正确。同登记ports/adapter/planner内补图片轮显式JSON输出选项，仍运行时schema校验，不接受原始自然语言冒充成功；真实预算已用2/6，不重付两unknown。 候选冻结482958e（15登记文件，455check/99真实PG+5可选skip/build通过）；VISION-01QA可按此单一候选只读/独立纯测试，不修改源码或重复真实模型。实际新视觉已用4/6，2留I公网，不开放生成；两unknown/OCR泛回应/triangle等边误差原记录保留，正式域名仍2910e57。I串行集成/38迁移/READY/两端公网待完成。 部署记录范围补docs/DEPLOYMENT.md及已授权规划/辅助稳定报告受控集成。主6258884/eb64c39→9ac6zkgnn / dpl_DotismPJWpXTGYN4hqjRbgyCJtUf READY，11:43:45Z生产38迁移一致；正式公网两自有账号真实流式图形/HELLO成功，390×500/1440刷新与原图/资料无新增、重复命令0token/跨账号asset404/两个旧暂停世界200。真实视觉累计6/6（4task succeeded含1早期OCR泛回应、2旧unknown不重付），生成0。公网后台未调用，脚本send误认enqueue但实际SSE已完成，仅只读核对，账本已补齐，不伪称公网worker验证；本地真实后台另已通过。浏览器90已finish并恢复原站点session；PG55450待清理。独立VISION-01QA未领取仍待根协调安排，I未冒称全任务验收完成。 回合接续：最终记录731a9f0 / moc1g3eju / dpl_HqD9FEc2oDTGnAsybMS8Qwg1yf2j READY，正式health/首页/分支/自有访谈4HTTP200复验；业务仍6258884，生产无SQL新增。PG55450本人路径核对后pg_ctl fast停止、launcher退出；浏览器90已finish原cookie恢复；HTTP3254未启动，无占用。独立QA仍待根协调按冻结代码安排/发送授权问题待回复，六次真实预算已满；M01A准备接收后真正参考生成与恢复契约待验证，生成0。 接收独立QA2b171ef（38/40，VQA01/02红例原样保留）；当前只在原已登记interview-photo-input.ts、vision-input.test.ts、integration/vision-01.test.ts修否定/转述比较选择，串行接独立QA test/report及本人报告，PG55450与本人BRANCH-FOCUS共一进程串行测试，不写辅助UI/根手机。视觉预算6满，新增供应商视觉0/生成0，验收先纯/真实PG再统一发布。 VQA01/02修复候选：独立14原红验收现全部通过，当前480check/10专项真实PG；不追加已满6次视觉，最新全量PG/build待完成后冻结修复hash供独立复验。 选图修复独立9b02e37（4文件），480check/102完整PG+5可选skip通过，供辅助独立原14复验；build/受控合并/READY待完成。 最终集成验收：限定视觉输入交付最终e130fa9+独立QA9cb9529随e96cee6上线，l0jat1r2r/dpl_GLwFtC63De48N7k5GyPXng7y1E1w READY。独立原14+26回归+I新增=41全通过，原两选图缺陷关闭；487check/build、102完整PG+5可选skip通过。最终公网旧图命令0token、profile不变/跨账号404/两旧世界200，无新视觉，累计6含2旧unknown/OCR泛回应/等边误差保留。仅授权保存图片有界同轮输入，不保证任意视觉准确或完整摘要持久；生成0/M01实际协议后续，公网上后台未新增验证，依原本地真实后台证据。|
|VISION-01QA|[x] 已完成|codex-f-01a0c7c8-vision01qa-20261009 (assigned by root; frozen 482958e/6258884)|Owned managed worktree /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本; codex/vision-01qa base731a9f0. Only new tests/vision-01qa.test.ts and docs/task-reports/VISION-01QA.md; canonical own report/row. Existing src/tests read-only; no I resources, environment, keys, DB, ports, browsers or paid calls. Own temporary dependency symlink removed at delivery. Test/report delivered; symlink removed, no resources, source writing never started. Assigned revalidation after UI: reuse same clean tree, codex/vision-01qa-revalidation from9b02e37/e130fa9 equivalent. Only append own VISION-01QA.md report; original test/source frozen readonly, temporary dependency link only. UI branch cf841b1 retained. Revalidation31e0c08 only own report; all source/test readonly, link removed, tree clean and no resources.|2026-10-09 independent 2b171ef9f7340788416b82e688992ac5c1b9a979, only test/report. 40 pure cases:38 pass/2 fail, new14=12pass/2fail, no skip. VQA-01 negated pair/current upload sends historical A+B; VQA-02 reported/quoted comparison sends old pair despite no read intent; wantsPair lines21-25/39-57. Typecheck(no incremental)/263 boundaries/format/scope clean. PG/model/browser/build/deploy0; I evidence reviewed not personally rerun. QA report mirrored, root forwards I; do not merge red tests as all-green or mark VISION complete. Existing 26 regressions pass; source frozen731a9f0/482958e unchanged. Proceed assigned UI after this delivery. 2026-10-09 root provides repaired frozen9b02e37/main e130fa9; UI delivered first. Resume original14+existing26 pure checks, preserve initial38pass/2fail and verify VQA01/02 close. No new model/PG/ports/build/browser; report-only independent commit then awaiting acceptance. Repair revalidation2026-10-09: independent31e0c08e05632c98c6c32475c2ada793b4c88a83 from frozen9b02e37; src/tests equivalent e130fa9. Original14 acceptance file unchanged from2b171ef. Same 5-file run41/41pass/0skip=original40+I1newmulti-case; VQA01 only currentB/VQA02 no history now closed, positive pair/order/captions/text preserved. Type/format/whitelist clean. Original38pass/2fail log retained, no source/tests changes or paid/PG/browser/build/deploy. UI cf841b1 retained and released. Own report mirror matches; root forwards I final acceptance/READY public; no further task claimed. 最终集成验收：I接独立41/41复验报告31e0c08→9cb9529并部署，原38/40两红历史保留；VQA01/02在9b02e37/e130fa9对应源码关闭，最终e96cee6/l0jat1r2r READY。I487check/build/102完整PG+5可选skip覆盖联合修复，旧视觉命令公网重放0token/资料不变/跨账号素材404/两旧世界200。执行者本轮仍0PG/模型/构建/公网，不将I证据记成本人测试；视觉累计6未追加，生成0。有限中文字面选图规则，非任意语言/识图质量或图生图验收。|
|M-01A|[ ] 待验收|codex-f-01a0c7c8-m01a-20261009（根协调正式分配，原M-01验证子包）|本人managed /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/m-01a基线2910e57101e29974b13b4c814706b908e369c1fe；5a49513+fc4168c独立提交，共12文件：专属M-01A.md及tests/evals/media-fixtures/11个m01a文件（build/manifest/README、A/B/仅头像/不可信文字场景SVG+PNG）。主目录仅报告镜像与本人行；业务/接口/handler/配置/迁移/UI未改，依赖链接移除，树干净，无DB/端口/构建/浏览器/模型资源；协议接续仅新增本报告提交，旧样例停写；允许只读I指定.local/vision-provider-models.json，不读其他配置；协议阶段d7cf80c仅专属报告1文件，已停写且工作树干净，主目录报告镜像一致|2026-10-09协议接续独立提交d7cf80c78c3d300c00f271449ceb2927973f15a9；保留准备5a49513+fc4168c及历史失败。只读I指定372唯一ID目录与公开原厂/网关文档，集中gemini-3.1-flash-image/gpt-image-2，两份未发送请求草案和P01—P12精确探针问题；公开3份Markdown HTTP200不是模型请求，Pro示例歧义/恢复幂等/账户费率未核实。JSON结构、4份SVG/PNG hash、原22矩阵+12问题计数、格式/diff/报告唯一范围/镜像检查通过；旧11纯测试不重跑。本阶段真实PG/生成/视觉均0，无服务/构建/部署。根协调读取报告转I统一剩余预算（生成累计≤4/视觉≤6）；真实参考像素、账单、unknown查询/幂等及端口冻结仍待I，原M-01未完成，M-02A不领。 I已串行接5a49513+fc4168c+d7cf80c→10959c4/4f661ec/8d23e89；4合成图逐字节复现与11领域测试通过，只接受准备/协议证据，生成0，M01实际参考能力未完成；本批文档随视觉记录READY后归档。|
|PHOTO-WORLD-02Q|[x] 已完成|codex-f-01a0c7c8-photoworld02q-20261010（根预分配，执行Q；源码只读）|独立 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/photo-world-02q，冻结b8220a3；仅新tests/integration/photo-world-02q.test.ts及docs/task-reports/PHOTO-WORLD-02Q.md（主目录报告镜像/本人行）。PG55458/HTTP3261/3262均已停止释放；Ego94已finish，专用photo-world02q.localhost Cookie不使用裸localhost、不清共享profile；依赖链接移除，工作树干净，业务/公共配置/phone/迁移未改。|2026-10-10独立9f401c9ddff0409208c885d2198fd407bc482119，仅2登记文件。新增真实PG7/7；既有相关PG5/5+1可选模型skip，check487/487、build/专项格式/差异通过。真实应用+专用库双端390x844/1440x900，头像/相册同源HTTP200/hash一致，UI实际换黄图/profile200、旧世界仍红蓝且刷新不变/第二世界绿，已带入删除409、新访客4资源404。原测试夹具/时间/列名及本地Cookie401失败保留报告；独占子域复验正常。真实模型/视觉/生成/公网/部署0，不冒称AI验收。已复现用户头像实时更新缺口：旧seed/binding冻结是现有设计，未实现已有联系人同步；PHOTO-AVATAR-UPDATE-01最小契约交I，保留相册历史/明确同名personId及跨世界作用域/新头像授权与回执。报告镜像完成，交根/I合并与验收；不领取M02/NOTES/SPACE或其他任务。 I受控合入9f401c9→f1cc0c7，仅新测试与报告；本人独立7真实PG通过、494check，公网两旧自有世界原图2+3均200/跨owner404。限定原图审查完成，真实模型本轮0，换图旧头像不更新为已复现待开发PHOTO-AVATAR-UPDATE-01，不是同步已完成。|
|M-02A|[ ] 待开发|预分配辅助；I冻结媒体端口及协议后领取|原M-02真实供应商适配子包；独立media/infrastructure新增适配器及专属测试/报告，精确文件由I释放；不改共享AI文字端口/存储/Handler/公共配置|依赖M-01A真实参考图验证与I冻结契约；提交前持久登记、供应商请求标识/超时/安全结果下载、真正参考图输入、无网图/模板替身；unknown不自动重付，失败不生成假素材。|
|M-03I|[ ] 待开发|预分配同一I串行|原M-03持久化与组装子包；media请求/素材/任务/outbox/server、必要迁移与世界来源契约；精确范围先登记，保留旧实例|依赖M-02A；锁定实际角色及获准图像来源，禁止默认拿玩家头像给所有NPC生成；requestId幂等/租约/配额预留/assetRevision/事务与失败恢复，成功落私有相册，聊天并发不失效；真实PG/真实生成/READY公网后完成。|
|IMG-CHAT-01|[ ] 待开发|预分配辅助界面；I冻结事件与素材契约后领取|NAR-03S的图片展示交付子包；手机消息/相册/现场可见素材界面及专属测试/报告；不得同时写world-phone-app/client，先I释放|依赖M-03I与同源消息附件契约；用户索图/导演具体事件按需触发，生成中不挡文字，成功同一asset显示聊天图片及相册、可打开保存回看；图像失败/unknown真实，场景图与NPC发图区分，少量关键图，不每轮生成。朋友圈仍另列原NAR-03，视频另列MEDIA-VIDEO-01，不混入本批。|

## 2026-10-09 按需分支与手机入口整理

用户要求：聊天中的分支内容不要持续占位；明确创建前后能否编辑；明确构思不得强制给出三个无关方向；手机首页移除混合设置入口，身份/时间/备忘录各自承接、返回/切换维持顶部。旧世界、旧提案、资料授权、图片优先及多聊天任务均保留。根协调授权现有两个线程执行，I仍为唯一业务集成人。

|任务|状态|唯一负责人/分配|范围与资源|验收与接续|
|---|---|---|---|---|
|BRANCH-FOCUS-01|[ ] 待验收|codex-branchfocus01-01a11a84-20261009（唯一业务集成人，根协调正式指定）|复用scene-index-transitions，从主731a9f0稳定对象更新，不复制LIB WIP；src/contracts/discovery.ts、src/modules/discovery/infrastructure/discovery-planner.ts、discovery-repository.ts、discovery-handler.ts；tests/discovery.test.ts、新tests/integration/branch-focus.test.ts及必要tests/integration/discovery.test.ts、tests/model-budget.test.ts；docs/task-reports/BRANCH-FOCUS-01.md与最终docs/DEPLOYMENT.md。公共client当前discover方法已支持契约类型传参，暂不写该LIB文件；不写proposal-thread/draft-editor/discovery-app/手机根范围。本人PG55450重新启用、HTTP3254预留、独立构建/browser按需。无SQL预期，范围扩大先登记；辅助cf841b1源码已释放后I接管discovery-app.tsx仅unknown诚实提示，不改mode/caller|2026-10-09已核对根用户最新要求及固定三方向schema/prompt；先冻结mode focused/explore最小可选契约：新创建明确focused→1，探索explore→3，缺省沿用旧3保证旧请求/任务/记录；辅助负责调用方明确模式及可编辑状态。focused优先本次brief/basedOn，不强迫用无关确认爱好改职业，仍严查实际引用ID；次数/版本/幂等/unknown/资料授权不放松。首读后端/契约/既有纯与PG测试，独立复核真实模型与READY公网后完成。 契约独立稳定cff3fd5仅discovery.ts+专属报告，辅助可立即cherry-pick接mode；未上线语义。后端工作树474check（含QA原14及追加护栏）、10专项真实PG通过。I继续完整测试/实际模型/统一发布；本批新文字调用总≤8含一次已收到非法结果纠正/unknown，已满视觉6不增加、生成0。 首个真实文字focused任务succeeded但把舞台摄影师改成舞台设计，质量失败保留，不冒称匹配；真实文字已用1/8，无视觉/生成新增。扩精确纯application/branch-focus.ts与tests/branch-focus.test.ts，从用户明确身份句裁剪锚点、最终premise必须保留该锚点，错误仅沿既有一次已收到纠正，不新增串行AI判断。无法解析的表达不伪称完整语义校验。 接续：文字2/8=首次身份漂移质量失败1+修复后85秒超时unknown1，均保留且不重付；后句否定归一纯规则已补，480check通过，完整PG/build在途，独立explore一次在途。 最新文字3/8，explore实际3且profile不变；480check、102完整PG+5可选skip通过，build在途。单方向真实修复验证因unknown仍待公网，不能称全部成功。 后端冻结f04a7d2（7登记文件；父9b02e37照片修复/cff3fd5契约/ff8bef6手机），480check/102真实PG+5可选skip/build通过，准备串行ROOT集成。辅助UI仍在途，未发版/不勾完成。 ROOT受控66c1ec4/b16c9d8/5502662/e130fa9/0d0c248已接，LIB25行及创作页保留未暂存；38迁移14:03:54Z一致。待辅助稳定UI一并部署；正式仍731a9f0/moc1g3eju，未冒称新版上线。 公网3b0a961/600xoljpq READY，真实1方向→编辑/确认→世界通，但方向为“摄影师改变为现场导播”绕过字面锚，语义质量再次失败；不算focused匹配通过，登记同规则范围补改变为/变为反例并真实响应回归，停止新增付费直到预算核对。 最新1ce8673/hzxdevs0b/dpl_2vG4wYZm5kkiPnx2cp7Xsz1JYB8F READY，14:19:48Z迁移38一致；最后真实focused23fbda68超时unknown，停止付费，主线质量验收仍未通过，收尾待验收。 最终集成验收：最终业务e96cee6（身份修复1ce8673/67b4efa+unknown文案6e3121c），l0jat1r2r/dpl_GLwFtC63De48N7k5GyPXng7y1E1w READY；38生产迁移一致，487check/build，完整102PG+5可选skip与二次guard2专项通过。真实文字6/8（本地intercept3+公网task诊断/loop核对3、无公网provider usage），2unknown/2方向质量失败，停止付费。链路能创建世界，但最新身份保留真实验收因85秒unknown未通过，不勾完成。公开unknown同command同任务、无run、资料/方向不变；UI费用提示已补，非通用语义保证。PG55450/launcher已停止，HTTP3254未启动，浏览器93恢复原会话后释放；LIB WIP保留。 AI-RECOVERY线上新focused单样本身份匹配通过（1/2新文字，DB4350ms），旧两unknown/两偏移失败保留；当前新方向完整世界链和间歇可靠性未复验，仍待验收，不再付费重跑旧任务。|
|BRANCH-UI-02|[x] 已完成|codex-f-01a0c7c8-branchui02-20261009 (root assigned, after QA delivery)|Owned /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本, codex/branch-ui-02 from stable731a9f0, retain QA branch2b171ef. Only src/features/interview/proposal-thread.tsx + new proposal-thread.module.css; src/features/discovery/draft-editor.tsx + draft-editor.module.css; necessary discovery-app.tsx (registered now for focused/explore calls and copy); new tests/branch-ui-02.test.ts and docs/task-reports/BRANCH-UI-02.md. No shared client/contracts/Planner/interview-app/phone. Own HTTP3257 synthetic API proxy and HTTP3258 actual Next dev/build preview; browser own taskspace; own build, no DB/model/paid probes; source released on delivery. Delivered cf841b1; UI source writes stopped/released. HTTP3257/3258 verified own cwd and stopped; browser92 finished; dependency symlink removed; tree clean.|2026-10-09 stable UI cf841b12b3c671055a3a80949475680b2d3d681d (7 owned files); contract dependency I cff3fd5 replay ce8bb0f, integrate only UI commit. Compact default52px shortcut, click Modal, pending/unknown recovery visible, focused/explore in fields+pending, real draft save controls and confirmed readonly/no false edit labels. 6 SSR pass; finalcheck461=457pass/4defaultPG55432 ECONNREFUSED, type/263 boundaries/format/scope pass; finalbuild pass. Actual synthetic browser390x500/1440x900: input414<nav434, save503 preserves text then explicit retry/readback, both callers focus1/explore3, confirmed0inputs/enabled continue/role failure unaffected, queued/unknown refresh no new submit. Fixture/taskscope/semanticclick failures retained report; synthetic is not PG/model/public acceptance. All resources released; I handles fullPG/READY public. Report mirrored, root forwards. New assigned image QA revalidation follows, no more UI writes. 最终集成验收：I集成cf841b1→3b0a961，487联合check/build、102完整真实PG+5可选skip；正式e96cee6/l0jat1r2r READY。390短屏52px快捷入口/输入414<nav434、详情按需开关、PC/旧三方向保留；原6SSR与执行者真实合成浏览器保存503保留/显式重试/刷新、已确认0inputs证据通过。I公网真实saveDraft/reread/confirm/seed/world链通过，旧draft窗口实际是新未确认草案，不伪称公网亲看确认摘要；只读摘要由SSR和执行者合成浏览器核验。I补unknown可能费用文案，同未知命令无run，不重付。完成限本UI，focused角色语义验收另待BRANCH-FOCUS-01。|
|PHONE-HOME-03|[x] 已完成|codex-main-phonehome03-20261009（根协调交唯一I集成）|独立codex/phone-home-03，提交c941688，基线731a9f0；phone-desktop.tsx/.module.css、phone-shell.tsx、navigation.ts、world-phone-app.tsx仅management死分支及tests/phone-navigation.test.ts/专属报告。树干净、范围释放给I受控集成；PG55456/HTTP3251已停止，Ego91 finish，依赖链接移除|移除设置首页入口，身份/时间独立、备忘录Dock、旧设置深链转备忘录清target，304行不可到达假系统UI删除。456/456 check、build成功，真实本地双端390/500/1440、空世界/点击/旧深链通过，0模型；报告含初次DB未启用四失败与脚本纠正，不隐藏。交I确认38生产迁移/受控合并/READY/公网后完成，当前未发布此修改。 最终集成验收：I接c941688→5502662，联合487check/build、102真实PG+5可选skip，生产38迁移一致。正式e96cee6/l0jat1r2r READY；390×500/1440实际首页身份/时间/备忘录与顶部返回/切换、旧management+obsolete target实际打开notes、无横溢，两个旧自有世界照片2/3张仍可读。未移除PLAYER01来源裁剪；开场notes0与完整长期任务仍属BOOT后续，不把入口改造冒充完整手机前史。|

### 2026-10-10 · 未完成任务复盘与接续

|任务|状态|唯一负责人/范围|验收与接续|
|---|---|---|---|
|BACKLOG-01|[x] 已完成|codex-main-backlog01-20261010（根协调）；主目录仅 docs/DEVELOPMENT.md 当前接续索引与本人登记、docs/task-reports/BACKLOG-01.md、docs/IMAGE_DELIVERY_PLAN.md 首段现状更正；不改业务/凭证/迁移|全表旧编号与后续子包对照、最新报告和 Git 证据；保留待开发/待验收及明确暂缓，不能把旧未勾行直接当成未实现。已登记新增头像同步/系统便签/地图两阶段/首页，保留前史与多聊天；I与辅助均实际领取并回报，旧257编号/88未勾快照勘误保留。文档差异与引用检查后交I串行提交/READY公网；纯文档不算业务功能。 I受控提交1ba0e6d，生产8w9aknon9 READY；保留16历史定义及新索引/报告/图片现状更正，未夹LIB/BOOT业务。限定文档整理完成，引用目标/唯一编号及diff检查通过，未完成能力仍原状态。|
|AI-RECOVERY-01|[x] 已完成|codex-airecovery01-01a11a84-20261010（唯一源码/部署I，根预分配）|复用/Users/limengzhe/.codex/worktrees/scene-index-transitions/人生剧本，从b8220a3稳定对象更新；仅src/modules/tasks/application/run-worker.ts、src/modules/ai/infrastructure/yibu-text-model.ts、src/modules/discovery/infrastructure/discovery-handler.ts；tests/worker-outcome.test.ts、tests/yibu-text-model.test.ts、新tests/integration/ai-recovery-01.test.ts；docs/task-reports/AI-RECOVERY-01.md、必要BRANCH-FOCUS-01接续与DEPLOYMENT；主表本人登记。原planner/身份反例只读，contracts/server配置/SQL/UI/LIB只读；扩大先登记。独占本人PG55450重新启用、HTTP3254仅必要时用；旧浏览器93已finish，不重开。|2026-10-10领取：读主原user继续未完成要求、架构/主表及两85秒unknown/两身份偏移历史；不自动运行旧任务，不提高timeout，不用新回复抹旧失败。新文本最多2实际请求（纠正/unknown均计），独立账本不重置旧6/8；优先无付费/真实PG，视诊断证据再决定实际探针；视觉不追加、生成0。已知durationMs=Date.now诊断bug待修，阶段/http状态目前丢失待定位，check/build/38生产迁移/READY公网后限定验收；身份真实未通过仍待验收。 进展：原10专项3pass/7fail记录保留，修复后17专项全通过；首次完整494=490pass/4本人PG未启用连接拒绝，启用55450后494/494通过。4新真实PG阶段/耗时/metadata/旧草案/幂等/租户隔离通过；完整PG/build在途，未新付费。仅登记3源码+2纯测试+1新PG，服务端timeout未改，公共接口/迁移/UI/LIB未写。 独立冻结0abcab2（7登记文件），494check/106完整PG+5可选skip/build全部通过。保留85s模型/110srunOwnedTask/120s路由/125s客户端原时限，不延长，服务端原总预算已包住纠正回合；没有新超时架构改动。新文本0/2，计划联合READY后只新合成focused一次任务（最多2内部请求），旧unknown不动。等待根PHONE-HOME-04稳定提交和BACKLOG冻结，同批受控主表原16历史任务快照与新索引；未上线此诊断修复，正式仍b8220a3。 I限定验收：9748506/3ff0b3a业务，1ba0e6d生产8w9aknon9 READY；494check/build、106原PG+7照片PG分次113通过/5可选skip、38生产迁移一致。公网新focused一方向身份匹配、5405ms/DB4350ms、同command/profile不变；新1/2文字，旧6/8及失败保留。阶段失败由真实PG+替身验证，未再次制造生产超时；详见报告。资源收尾后无扩项。|

## 9. 当前未完成工作与接续索引（2026-10-10）

本节是本总表的阅读入口，**不另立第二份任务状态源**。领取、进行中、待验收和完成仍更新原任务行。每次交付同步本节涉及的缺口与专属报告；旧编号不删除，不将“子包完成”当成大项全部完成。复盘方法及未勾选行的逐项定位见 [BACKLOG-01 报告](task-reports/BACKLOG-01.md)。

复盘起点：b8220a3（业务 e96cee6）。本批分支诊断与手机首页已联合 READY；494 项常规检查及构建通过，106 原真实数据库测试与7新增照片测试分次113通过，5 项可选模型明确跳过。最新新增舞台摄影师 focused 样本约5.4秒返回一个身份匹配方向，同command与现实资料保持不变；旧两次unknown及两次身份失败保留，仍非通用可靠性通过，BRANCH-FOCUS-01完整新世界链继续待验收。头像更新已在39迁移与双端公网限定技术验收通过（25d7b88/a378022），仍待用户体验；系统任务、地图、完整前史和多聊天未交付。最终线上版本以 [DEPLOYMENT.md](DEPLOYMENT.md) 为准。

### 先推进的闭环

1. **生成可靠性与身份一致性**：BRANCH-FOCUS-01、AI-RECOVERY-01。诊断真实 85 秒 unknown 的发生阶段，修实际耗时记录，保留用户想体验的身份；先无付费反例/故障测试，再有界真实验收。unknown 不自动重付，旧失败保留。
2. **已有照片整条链独立复核**：PHOTO-WORLD-02Q。图文说明→身边的人→获准带入→正确角色头像与相册→刷新；同名人物、多个世界、更新照片、仅头像、否定绑定及跨账号隔离。已有原图上传/角色带入/读图不能重复包装成新功能；发现阻断先修。更新资料后同步已带入人物的当前头像单独列 PHOTO-AVATAR-UPDATE-01，不能把不可变快照说明当成用户所需功能已经完成。
3. **真正生成新图片**：M-01/M-01A → M-02/M-02A → M-03/M-03I → IMG-CHAT-01/NAR-03S。先确认实际网关参考生成和有限对照样例，再接适配器、持久受理/结果/配额/恢复，最后图片在正确角色聊天与相册同源呈现。协议/样例已准备；新生成累计仍为 0，不代表服务接通。仅头像不自动作为真人一致性参考；朋友圈和视频另列。
4. **一条完整体验验收**：EXP-06、NAR-04、V-02/03/04。用实际旅程验证聊天、照片、构思、创建、手机互动、回访、失败恢复；局部截图与测试条数不证明好玩或可上架。先完成以上明确缺口，不同时大改全部页面。

### 保留的后续工作（按依赖恢复，不因本轮让位而取消）

- **手机原有生活与前史**：BOOT-01/BOOT-01A。过去消息、关系与知情、日历、便签及真实素材来自同一初始快照；玩家打开时有可信的原有生活。方案已交，完整实现未交付。不能直接公开内部开场便签/导演秘密充当任务。
- **真正可持续的剧情与任务玩法**：NAR-02/03/04、NOTES-WORLD-01。当前情况、可并存的近期事项、较长追求、选择相互影响、NPC 幕后行动和有依据的反馈；导演按因果与知情调度，不机械反转、不总是顺从。既有选择记录、来信、关系转述是部分底座，尚非完整任务/奖励引擎。
- **场景、地点与地图**：SPACE-01Q、EXPERIENCE-10、SPACE-02A→02B。群聊/单聊/现场已有分开实现；进入现场不等于完成物理移动。稳定地点、玩家与联系人位置、旅行耗时、跳过途中、到达后可看可做和反馈仍需正式契约与实现。地图不能先做成无后果的按钮。保留 SCENE-03/TRANSITION-01 的限定上线证据。
- **新建及历史聊天**：CHAT-SESS-02→03→04→05→06。02 元数据/契约，03 消息照片与回复隔离，04 构思来源，05 真实历史/新建/草稿界面，06 迁移/并发/双端/上线验收；00/01 是方案/审查，尚非多聊天功能。
- **我的、创建与整体界面收束**：EXP-03/04/05、U-03～07、D-04/07、PHONE-HOME-04。结构化资料唯一写入口/来源、重复冲突/旧数据、人物姓名与“我的描述”、聊天引导、保存恢复和键盘/真机；已有 BASICINFO、PHOTO、BRANCH、PHONE 子包只算其范围。不得恢复首次强制填写生日，或进入世界后的导演改设定入口。
- **官方完整预设内容和私有创作**：LIB-02B/03/04、LIB-04B、LIB-06。私有修订/试演与独立 Planner 已有，目录、作者完整创作会话、完整剧本承接和作者到玩家验收仍缺。相关人员提供预设内容，其编排方法尚未由用户确定，不能先替用户锁定；主目录 LIB-04B 未提交源码保留，不夹带发布。
- **公开发布与内容治理**：LIB-05、AUD-19 后续及 G-01。用户发布方向仍有保留，需来源/素材授权/审核/撤回/举报及正式账号，不能当已有公共市场；危机关键词规则不是全面治理验收。
- **朋友圈、视频、语音**：H-04/H-06、NAR-03、MEDIA-VIDEO-01。真实朋友圈动态与互动未闭环；静态图片完成后才验证少量关键视频。语音按用户要求暂缓；不展示假动态、点赞或媒体成功。
- **人生管理及历史分叉**：L-01/02/05、V-04。已能列表/进入/切换；重命名、归档、删除/恢复、任意历史版本分叉与资源继承的完整范围仍待对照验收。L-03 的旧“玩家直接改导演设定”范围与最新要求冲突，保留编号但不按旧方案开发，导演仍是幕后调度。
- **账号、跨设备和真人共同体验**：G-01～06、V-05。游客可用不等于正式账号/游客归并/跨端冲突解决；真人参与、授权撤回、共同场景、共享时钟与退出仍待实现/验收。私人资料不共享。
- **权益、支付及生产交付**：E-01～03、R-01～04、AUD 后续。价格/渠道由用户决定；备份恢复、资料导出/完整删除、监测告警、容量/成本、弱网/读屏/真机、正式发布验收仍需补齐。独立 Vercel/Supabase 部署已可用，不等于常驻/后台可靠执行及全部运维已交付。

### 旧任务不重复开发的对照

- W-01～04、H-02/03/05/06/07、L-04 的旧未勾行，需对照 MEM-01～08、H-05A/H-06A、NAR-02A～M、GROUP-01I/02I、SCENE-02/03、PLAYER-01I、LOCK-02I、WORLD-CONTROL-01UI、PHONE-HOME-02I/03。已有角色聊天、记忆、日历、群聊、通知与时间控制，不能写成“完全没有”；父项剩余范围另验。
- D-03/05/V-02 需对照 D-06/08、EXP-03B～E、BRANCH-01Q/UI/FOCUS 和 BOOT：文字创建链可用，完整前史/媒体/质量与全恢复仍缺，不能原地再造世界创建器。
- GUIDE-02、CHAT-PHOTO-01、NAR-02S、PHOTO-QA-02、INTERVIEW-01R 的旧待验收记录，需对照 GUIDE-02I、PHOTO-COMPOSE-02I/QA-03、NAR-02SI、VISION-01I/QA 和新可靠性任务。审查或限定业务已交付，不代表上游间歇错误全面解决。
- 规划/审查行（SCENE-00、EXPERIENCE-09/10/11、SPACE-01Q、PLAY-QA/02Q、BOOT-01A、VISION-01Q、CHAT-SESS-00/01、IMG-PLAN-01、M-01A）只在其文档范围闭合；后续业务仍按原任务。没有足够验收证据的行不批量改为完成。

|PHONE-HOME-04|[x] 已完成|codex-main-phonehome04-20261010（根）；managed lock-02-notifications 从稳定 b8220a3；仅 phone-icons.tsx、phone-shell.tsx 的桌面图标调用、phone.module.css 桌面图标/Dock规则、phone-desktop.tsx 与其 module.css、专属报告；独占HTTP3251、本人PG55456（既有phone-home-02私有dev/test库）、单一专属Ego浏览器；不使用其他执行者数据库；不改照片/服务端/notes应用|用户10-10反馈：所有App图标与首页排版仍差。统一可辨认iPhone式图标/标签、首页真实便签或选择记录入口、390/500/1440布局和实际导航，不提前放无效地图/任务入口，不称完整任务机制。check/build/READY公网后完成。 根稳定368c52b（6文件、树干净），487/487 check/build、本地实际PG+Ego95双端与便签保存刷新通过，390×500遮挡已修；资源3251/55456/Ego95已停止/finish，依赖链接移除，全部业务释放。交I串行集成/38迁移/最终check/build/READY公网后完成，详见PHONE-HOME-04报告。 I串行集成3ff0b3a，1ba0e6d生产READY；联合494check/build、38生产迁移一致。公网390×500 toolsBottom356.15<DockTop369、PC420居中；备忘录真实空态/微信/身份/暂停时间/现场/返回/切换实际通过，照片原2+3仍200。仅首页与图标完成，系统任务/地图/完整前史/头像同步未完成。|
|PHOTO-AVATAR-UPDATE-01|[x] 已完成|codex-avatarupdate01-01a11a84-20261010（唯一业务/迁移/部署I）|复用managed scene-index-transitions，从8e485f4冻结；仅新db/migrations/0039_current_person_avatars.sql；src/modules/profile/infrastructure/profile-repository.ts（既有command receipt沿用，写安全同步来源）；src/modules/world/infrastructure/build-repository.ts；src/modules/media/infrastructure/asset-repository.ts；src/features/interview/person-editor.tsx与必要person-editor.module.css；新tests/integration/person-avatar-update.test.ts、tests/integration/people-world.test.ts（只更新当前头像预期，保留人物身份/关系与所有历史seed/album）；tests/integration/role-grants.test.ts（仅新触发器识别白名单，保持app/worker无直接执行权限）、必要已有tests/integration/photo-world-02q.test.ts说明新旧头像边界；新docs/task-reports/PHOTO-AVATAR-UPDATE-01.md及本人主表/DEPLOYMENT。契约/client/interview-app、AI/媒体生成/notes/地图/LIB只读，扩大先登记。独占本人PG55450重新启用、HTTP3254必要双端；新专属单一Ego空间，0模型。|2026-10-10按最新人类继续开发/记录待用户验收要求领取；旧额度暂停限制撤销，根与辅助源码只读。已有ProfileEdit commandId回执及UI稳定pending request可复用，不再另造命令协议。当前联系人头像独立可变指针/版本/持久来源；资料更新与获准同sourcePersonId所有世界同步同事务，新增图只授权对应世界，seed/历史相册/聊天图片不变。SQL触发器负责跨投影一致性与生产保护，不让profile domain依赖world。先负例与真实PG/并发/同名/两世界/删除/失败回滚，check/build/新39生产迁移/READY/公网双端后技术验收；仍需用户体验验收，由根另列索引，不声称用户已验收。 范围扩登记：全DB暴露安全审计枚举将三个新不可直接执行trigger当遗漏授权，先注册仅role-grants trigger白名单，不给runtime开放private helper/trigger执行。 独立3badbed十文件冻结；494check/build、128完整PG=123pass/5可选skip通过，生产未应用39/未上线，用户体验验收仍待；保留红例/夹具错误及2旧契约失败记录。 I技术限定完成：25d7b88/a378022生产606qj30pk READY、39checksum一致；494check/build、123真实PG/5明确可选skip、17专项。公网实际API换绿/重放/清空/恢复、手机上传黄图保存→旧微信/PC刷新新图、原相册2张不变、新bytes200/跨owner404；原测试头像恢复、绿黄临时图删除404、Ego97原session恢复finish。当前另标签需刷新，0模型；待用户体验A11由根记，不视为用户认可。源码释放，本人PG55450与树转下一NOTES-SAFETY-01I。|
|NOTES-WORLD-01|[ ] 待开发|NAR-02/03与BOOT-01的展示子包；预分配辅助界面，I先冻结玩家可见只读记录及唯一写入口后领取|便签区分“眼下要做的事/关于这段人生”系统记录与可编辑私人便签。初始处境和后续事项需有来源、状态与提示，不能由玩家随意改完成，不能泄导演秘密；不冒称原choice列表或手写待办即完整长期/短期任务引擎。无依据时真实空态，选择后果/刷新/只读写拒绝/隐私与双端验收。|
|NOTES-WORLD-01Q|[x] 已完成|codex-f-01a0c7c8-notesworld01q-20261010（根明确分配，仅分析子包）|本人独立 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/notes-world-01q，冻结8e485f4df9962c34654cce8e8e9e39ff3496a71e；仅docs/task-reports/NOTES-WORLD-01Q.md、本任务主表行及报告镜像。业务/类型/公共配置/迁移/phone只读，无模型/数据库/端口/构建/浏览器资源。；交付cdec2d7+4ca6ab1仅专属报告，独立工作树干净、主目录镜像一致。；UI分包纯报告追加731ecb6，原Q两提交/安全66d5506分支均保留，无资源重启。|2026-10-10只读方案提交cdec2d79db43b246edf122430459734a645cabc2及更正4ca6ab1a27a4eb2f0091318b03285066eb1cd424；首版独立GET records建议：公开身份/起点处境、近期choice/建议与邀约有来源且可回对话/日历，私人便签保留编辑。choice最多5条/同角色替代，不冒称长期任务引擎；导演私密commitment/无知情来源opening.notes不公开，旧世界真实空態，BOOT后续合法genesis统一。29现有路径、12待实施矩阵ID、格式/diff及报告唯一范围复核通过；最初矩阵规则失败及错误context路径已如实记入报告并更正，不改写历史。本轮业务/领域原型/模型/真实PG/check/build/UI/公网/部署均0，无资源。父NOTES-WORLD-01未实现；根读报告转I，avatar部署后I冻结契约再派UI，不自动发线程消息或领取其他任务。；2026-10-10根明确接续：仅专属Q报告追加UI最小候选范围/依赖/来源导航/空错态/390短屏PC/不可编辑验收。没有领取父NOTES-WORLD-01，无业务/契约/资源/私人数据操作；安全66d5506冻结不扩写，I集成中。；接续交付731ecb688a9657913a3ed039c5c7a92042865f00仅Q报告45行追加：候选notes.tsx+纯只读组件/专属CSS，I持有数据/provider/client接线；微信实际target是actorId，不能用丢失ID的actorName或messageId假定位；notes内滚动与shell外滚动需真实恢复验收。三分区/空错态/不可编辑/390短屏PC/用户待验清单已留存。报告格式、原12矩阵/10引用接点、纯追加/白名单检查通过；0业务/测试/PG/模型/构建/浏览器/公网。NOTES-WORLD-01未领取，待I冻结公开来源/server真实API后根明确分配。 I限定文档技术验收：受控899167c/8d0635f已发布原报告，A12最新追加本次记录提交。12项已上线范围/7类未来组，用户A01–A12均待体验；Q仅分析完成，NOTES-WORLD父未实现。|
|SPACE-02A|[ ] 待开发|SPACE-01Q/EXPERIENCE-10方案的实施前置；预分配I，冻结实际地点/人物位置/移动/到达事件及公共契约|现场参与与物理地点分开；合法目的地、耗时、故事时间、人物知情与约定冲突同事务保存，移动不替主角做现场行动。既有enterScene不当成到达；旧世界兼容，无地点资料不造坐标。真实PG/并发/幂等/回放、联系人反馈有来源。|
|SPACE-02B|[ ] 待开发|依赖SPACE-02A；预分配辅助，I释放手机/客户端范围后领取|手机地图基于世界合法目的地，选择去哪→小型导航/过渡→显示过去多久和到达→现场可看/可做。动画仅表现已提交或在途真实移动，不假进度、不自造旅行成功；可减弱动效、失败/未知恢复、刷新位置与时间一致，390/短屏/PC/公网。|

|USER-ACCEPT-01|[x] 已完成|codex-main-useraccept01-20261010（根协调）；主目录仅本任务登记、第10节用户体验验收索引、docs/task-reports/USER-ACCEPT-01.md；不改业务/配置/SQL，不占模型/数据库/浏览器|用户10-10要求连续推进开发、留存以后统一体验验收的项目。区分技术交付与用户体验认可；从已读报告和上线证据列可验范围、步骤与限制，未来任务只列待开发而非可验收。保存原反馈，不把没有用户回复当通过；交I同批受控发布。 I限定文档技术验收：受控899167c/8d0635f已发布原报告，A12最新追加本次记录提交。12项已上线范围/7类未来组，用户A01–A12均待体验；Q仅分析完成，NOTES-WORLD父未实现。|

|NOTES-SAFETY-01|[x] 已完成|codex-f-01a0c7c8-notessafety01-20261010（根明确开始，唯一执行者；I负责集成/部署）|独立 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/notes-safety-01，从8e485f4冻结，不复制0039；仅src/modules/world/infrastructure/postgres-world-repository.ts的saveNote及必要局部读取、新tests/integration/notes-safety.test.ts、docs/task-reports/NOTES-SAFETY-01.md，本人主表行及报告镜像。独占PG55458和本工作树check/build；无HTTP/浏览器/模型。其他domain/类型/SQL/API/build/profile/asset/phone/client/LIB只读，扩大先协调。；66d5506仅3登记文件；PG55458已停/无监听、无其他资源，node_modules临时链接移除；源码冻结待I受控合入，工作树干净。|2026-10-10稳定提交66d5506b7d51d4e2011f66bddc03295f6fea6cba。先真实红例1通过/7失败证实双world碰撞与v1→v2旧command NOT_FOUND；saveNote限定world+owner编辑/冲突新建DO NOTHING回滚，历史回执从不可变note.saved按原reducer还原，不改格式/其他hydrate。合法新UUID/旧openingID/非0新建expectedVersion兼容。PG18.4冻结38迁移、pl_app/pl_worker无BYPASSRLS、FORCE RLS；完整122通过/5明确跳过（含新专项9），最终专项9/9，check494/build通过。并发双world仅一成功、同command幂等、缺/错源拒绝、旧回执不覆新数据、真实故障回滚通过。全量format有20个与8e485f4字节相同旧文件警告未改，本次3文件格式/diff/精确saveNote范围通过；失败历史与证据见报告。0模型/生成/领域原型/HTTP/UI/公网/生产；未自动修历史损坏，长历史回执成本记限制。根读取报告转I；I联合验证/正式迁移检查/READY及公网便签验收后完成，不自动领其他任务。 I限定技术验收：c97ee5c/899167c，fh3igqrkp READY、39checksum；494check/build、完整137PG132pass/5明确skip。公网v1/v2原receipt重放/刷新仍v2、双向跨owner404与另一world无变化；同owner双world仅真实PG，公网既有单世界不足，按根限定收尾。旧损坏不自动修，records/UI未交付、用户A12待验收；见NOTES-SAFETY-01I。|
|NOTES-SAFETY-01I|[x] 已完成|codex-notessafety01i-01a11a84-20261010（唯一集成/部署I）|复用scene-index-transitions，头像稳定25d7b88/a378022，串行接66d5506；仅src/modules/world/infrastructure/postgres-world-repository.ts、tests/integration/notes-safety.test.ts、docs/task-reports/NOTES-SAFETY-01.md、新docs/task-reports/NOTES-SAFETY-01I.md及本人登记/DEPLOYMENT；shared contracts/SQL/API/client/interview/notesUI只读，扩大先登记。本人PG55450继续独占；不启用新模型/视觉/生成，公网自有暂停世界实际notes请求。|2026-10-10根最新继续系列开发授权；原F三文件冻结释放，I已读49行冲突ID隔离/immutable note事件重放与receipt回原版本规则，先同39迁移联合check/build和真实整套，READY后v1→v2→v1重放/当前v2不回退/同owner双worldID拒绝及跨owner404。历史已碰撞数据未自动修复，不称系统任务功能交付。根仅第10节A11/A12，辅助后续等records契约；源码与migration只有I串行接收。 联合候选c97ee5c/a42ae96冻结：494check/build、完整真实PG137总=132pass/0fail/5显式可选skip（4模型、1HTTP导演）。生产39已应用/校验一致；等待推送READY与公网，不自动修复已损坏历史。 I限定技术验收：c97ee5c/899167c，fh3igqrkp READY、39checksum；494check/build、完整137PG132pass/5明确skip。公网v1/v2原receipt重放/刷新仍v2、双向跨owner404与另一world无变化；同owner双world仅真实PG，公网既有单世界不足，按根限定收尾。旧损坏不自动修，records/UI未交付、用户A12待验收；见NOTES-SAFETY-01I。|
|NOTES-WORLD-01I|[x] 已完成|codex-notesworld01i-01a11a84-20261010（唯一后端契约/部署I）|复用scene-index-transitions、PG55450；新src/contracts/world-records.ts、src/modules/world/domain/player-records.ts、application/player-records.ts、infrastructure/player-records-repository.ts、src/app/api/v1/worlds/[id]/records/route.ts、新tests/player-records.test.ts/tests/integration/notes-world-01.test.ts；src/server/services.ts仅组装；专属报告/本人主表/DEPLOYMENT。client/interview/phone/LIB/BOOT只读，无迁移/模型，扩大先登记。|2026-10-10便签安全限定公网闭合后串行后端：独立只读GET、公开起点/经核实近期choice和建议/明确状态邀约、source/version/actorId导航；私密导演/opening.notes不公开，sys/命名空间拒写。真实PG/check/build/READY/public后冻结契约，再接辅助UI，父NOTES-WORLD-01保持未完成。 独立76e82ee八文件冻结；500check/build，143完整PG138pass/0fail/5明确skip（4模型、1HTTP导演），纯6/PG专项6包含其中。尚未部署/公网，client/provider/UI未接线。 后端限定技术完成：eb2c456/6d96567，ngm13xf4d READY、39checksum；公网5组GET起点2/近期空态/稳定读/跨owner404/sys写422和405/旧receipt兼容/世界不变。正例计划建议邀约仅真实PG，UI/client/provider未接线，父NOTES-WORLD仍未交付。契约与8文件释放，后续组装/辅助纯UI范围详见专属报告，模型0。|


|NOTES-WORLD-02I|[x] 已完成|codex-notesworld02i-01a11a84-20261010（唯一集成/部署I）；独立scene-index-transitions，从1fdd6a7/eb2c456已上线后端冻结；src/features/api/client.ts只新增records读取（保留主目录LIB WIP）；src/features/phone/apps/types.ts、provider.tsx仅records显示状态与重读能力；world-phone-app.tsx及实际持久world组装页（需先登记准确路径）、必要新records-loader.ts/专项测试/本人报告/主表/DEPLOYMENT。notes.tsx/新notes-records组件/CSS由辅助独占；不改后台records/SQL/其他手机应用。PG55450/HTTP由I登记，最终部署仍唯一I。|立即先冻结前端共享契约并提交短小稳定基线供辅助；公开PlayerRecords保持strict独立读取。展示状态loading/ready/error与data/error独立，reloadRecords为只读重试；worldId/版本/请求序列保证切换晚响应不串、版本不混拼，错误不清私人草稿。原client/interview/LIB WIP不得夹带或整文件覆盖。500原check/build与真实库保留，实际新增API读取/故障/切换/UI联合check/build/390短屏PC/39迁移/READY公网后限定完成。无模型/无生图，不把近期记录当长期任务。 已领取：持久组装实际为world-phone-app.tsx内WorldPhoneApp/WorldPhoneSurface，page只读；新records-loader.ts/use-world-records.ts与tests/records-loader.test.ts/records-client.test.ts精确登记。本人PG55450，HTTP3254/3255必要时；共享状态严格union/诚实默认error先短小冻结，见NOTES-WORLD-02I。 共享契约冻结da3cc14→bc2ae12仅types/provider，typecheck通过。PhoneRecordsState严格loading/ready(data必需)/error(error必需)，Context.records/reloadRecords，props同名可选；缺接线或跨world默认诚实error。辅助可接入口，契约释放；实际加载/双端/上线未完成，详见专属报告。 加载稳定fae45c5→5947f5d（6文件），512check/build及12专项通过。共享契约不变，辅助可接此真实组装做UI API验收；主client原LIB仍12/0未入提交。PG55450重启，原directive/类型/连接失败保留报告。未推送/未最终UI验收，0模型。  扩围：辅助真实HTTP发现新建便签同command重发409；I独占 src/app/api/v1/worlds/[id]/notes/route.ts、src/modules/world/infrastructure/postgres-world-repository.ts、新 tests/integration/notes-create-replay.test.ts，修服务端分配ID的事务内回执恢复；无SQL/契约变更。辅助UI四源/测试已冻结交I，联合520check/build通过；Ego100/notes-world02i.localhost、HTTP3254/3255专属进行真实验证。 辅助b1efada已释放源；I串行独占notes.tsx补齐输入80/2000与超限提示/提交保护（不截旧草稿），必要notes-records-ui.test.ts只增边界验证。 业务98a66a7 Production3qs7jl8lj/dpl_5haFenDmXSUam6QPyG4buggG3aWm READY，正式新建无id200/重发原receipt200/改payload409持久单note；521check/build、139真实PG通过/5可选skip，0模型。根98独立公网UI与F最终报告待接收；A13未用户验收。 最终限定集成验收：业务98a66a7与文档1653670/npn9om18e READY、正式API与根双端通过，技术子包完成；A13待用户体验、完整任务/前史仍未完成。|
|NOTES-WORLD-02UI|[x] 已完成|codex-f-01a0c7c8-notesworld02ui-20261010（根明确分配，唯一UI执行者）|独立/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，codex/notes-world-02ui，从1fdd6a7冻结；仅src/features/phone/apps/notes.tsx、新notes-records.tsx/notes-records.module.css、新tests/notes-records-ui.test.ts、docs/task-reports/NOTES-WORLD-02UI.md及本人主表/报告镜像。独占本树check/build；后续真实API验证仅本人PG55458、HTTP3263/3264、单一专属Ego空间/notes-world02ui.localhost，启动前核对监听，无共享Cookie操作。公共types/provider/client/契约/SQL/其他应用及外壳/CSS只读，I独占02I；扩大先协调，0模型，不部署。；0512c28稳定UI候选（5文件），3 UI源码+1测试停写交I串行集成；仅本人报告与忽略.local/notes-world02ui-*真实验证脚本/证据继续。依赖接受bc2ae12→3fea136，共享文件不改；后续接冻结5947f5d只读验收。|2026-10-10短锁领取成功；01I后端READY/冻结，02I共享props尚待I稳定提交。先纯PlayerRecords只读组件/SSR纯测试，后冻结props才接notes入口；三分区/近期覆盖/人生起点/来源actorId和invitationId/系统sysID隔离，空错态/搜索/深链/返回/单滚动/私人草稿保存分享保持。SSR不作浏览器验收；I接真数据后实际390短屏/844/PC420和真实API；稳定提交待I集成上线/A13待用户反馈。；check508/508、build、8组件SSR/回调/纯导航与精确格式/diff通过；首轮4RLS因PG停机拒绝已重跑，现PG55458独占/39迁移。真实Browser/API双端尚未验证，A13待用户；根/I可直接cherry0512c28，不带依赖重复提交。 实际资源Ego99/HTTP3263产品及3264会话辅助/PG55458；接稳定5947f5d→893953c后联合check520/build通过。真实API记录与空态200、跨owner404、sys写422、只读不改状态；新建note省略id同command重放409已通知I协调，尚未修。本人源码停写，继续实际双端只读复核，0模型。 I报告确认系统详情缺返回且4源/测试继续留辅助修；重启登记范围内notes.tsx/专属CSS/notes-records-ui.test.ts小修，系统ready/loading/error统一可见返回列表；notes-records.tsx不改。其余公共文件仍I独占。 根追加要求：原登记notes-records.tsx中邀约正文若为有效ISO改用现有timeText故事时间展示（不改来源/瞬间/契约），对应UI测试；接I冻结0140f95只读复验新note无id重放，后台源本人不改。 人类最新经根转达：删除私人便签讨论/一键带微信/选择好友入口、顶部分享按钮与无入口分享sheet/state；原notes.tsx及对应测试范围实施，新建编辑保存草稿恢复保持。原分享验收取消。 小修稳定b1efada(5文件)再次停写3UI+1测试交I串行集成：返回+邀约可读时间+完整删私人分享；最终521check/build、9SSR专项、7真实PG records/create-replay通过。继续独立真实UI/API与报告，源码释放I，不发布。 最终报告918a5e8；本人实现/本机真实API与390×500/844/PC1440居中420、错误重读/私人草稿v2、可见返回/搜索历史滚动、空世界/sys深链已复核。I98a66a7长度依赖只读接86d1d99后521check/build及真实原生80/2000通过，7专项真实PG；0真实模型。Ego99一次结束、PG55458/HTTP3263/3264释放、工作树干净。Ego高层指针失败保留，键盘/CDP真实鼠标成功另证；loading瞬间仅SSR。3UI+1测试已交I，本人不再写源，不部署；待I READY/公网/A13，不能当成已完成。 最终限定集成验收：业务98a66a7与文档1653670/npn9om18e READY、正式API与根双端通过，技术子包完成；A13待用户体验、完整任务/前史仍未完成。|

|NOTES-WORLD-02COORD|[x] 已完成|codex-main-notesui-coord-20261010（根协调/独立接收）|主目录仅新docs/task-reports/NOTES-WORLD-02COORD.md、主表本任务/02I/02UI分配与第10节后续A13；源码只读。不得与I/F并写业务，不占DB/构建/HTTP；如额外浏览器验收先登记。|用户10-10继续多人开发授权；实际读后端稳定1fdd6a7/eb2c456、Q与已有前端，精确分拆I组装/辅助纯UI。收到稳定提交后独立审源码/测试及实际公网证据，后端尚非手机可体验系统记录。完成联合发布才新增A13，A01–A12用户结论不改。 根额外独立公网浏览器复核：单一新Ego TaskSpace（创建后记ID），仅parallel-life正式域名及已授权自有合成会话；无DB/HTTP/模型/素材上传，不操作其他执行者空间和用户人生。 用户本轮明确删除便签讨论/选好友分享入口，交F纳入当前小修，旧分享验收废止。人物带入入口/创建预览/地点现场/日程推进时间先讨论；不允许用户自由调时间及倍速，后续以最新约束重整，旧完成仅历史。根只读现有draft-editor已有人物勾选/可选role，详细区分建议与现状见报告。 根独立正式验收：业务98a66a7，3qs7jl8lj READY；Ego98实际390×844列表/390×500只读详情与真实点击返回/1440电脑420宽，私人编辑80/2000且分享入口不存在；系统详情0输入、当前空态诚实。root无模型/无状态写，finish98一次。待I文档受控发布后限定技术完成，用户A13待体验，完整任务引擎仍未完成。 最终限定集成验收：业务98a66a7与文档1653670/npn9om18e READY、正式API与根双端通过，技术子包完成；A13待用户体验、完整任务/前史仍未完成。|

|FRIEND-PHOTO-01UI|[x] 已完成|codex-f-01a0c7c8-friendphoto01ui-20261010（辅助唯一UI执行）|独立photo-compose-02，从主35d3e26稳定接续；仅src/features/discovery/draft-editor.tsx、必要新src/features/discovery/draft-photo-selection.ts、tests/branch-ui-02.test.ts及必要新tests/draft-photo-selection.test.ts、专属报告FRIEND-PHOTO-01UI。其他provider/client/phone/SQL/契约只读。复用本人PG55458，HTTP3263/3264若启动先登记核对，单一新Ego用于本任务；不部署。|用户最新明确勾选朋友默认带其当前关联照片，不二次选图。人物处显示缩略图及一句自动用于头像/相册；其他可选照片只含本人/参考图，不再出现人物照片checkbox（连disabled重复都去掉）。取消人物同步移除仅该人自动照片，同图被另一已选人物引用时仍保留；reload新资料/用途重新读取自动换到当前有效人物图片，已确认种子不改变。无图人物可入且不强制上传，保持最多8/可选角色。check/build/手机PC真实UI、选/取消/刷新正确payload且保存确认真实链路；头像/相册后端复用，不假称生图。稳定交I。 已短锁领取：工作树/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，分支codex/friend-photo-01ui，基线35d3e26；唯一改draft-editor.tsx/新draft-photo-selection.ts、branch-ui-02.test.ts/新draft-photo-selection.test.ts、docs/task-reports/FRIEND-PHOTO-01UI.md及本人主表/镜像。独占check/build；PG55458/HTTP3263产品及3264会话辅助，启动前核对监听；friend-photo01ui.localhost单一新Ego，忽略.local/friend-photo01ui-*验证脚本/证据。0模型/生图，不部署。先纯角色照片同步/选择 helper与入口，再真实UI/API保存确认。 关键进展：2 UI/helper+2测试已实现，typecheck/12专项(6helper+6SSR)通过；其他图只本人/参考，人物图按角色自动加入/取消/shared去重，roles刷新换当前图，confirmed不进同步。报告已镜像；下一步521+6完整check/build后冻结交I并做实际UI/API，0模型。 稳定候选0268925已冻结5文件，527完整check/build及12专项通过；2 UI/helper+2测试停写交I串行集成。本人继续报告与忽略真实API/双端证据，PG55458已启39迁移，本人真实持久草案和私有颜色图夹具准备好，HTTP/Ego未启动。31资产/8人物后端界限不改不截断，0模型/生图。 根/I复核旧自动图转reference边界，0268925仅候选非最终；原4源/测试继续本人独占修，I不并写。记录上一成功roles以撤可核实的旧自动图，保留手选参考；历史stale重开无旧来源不猜删，明确报告残余。本人Ego102/HTTP3263产品3264会话/PG55458已启动；浏览器审批首轮仅处理超时，按提示一次重试成功。 归属已按根最新纠正：0268925后源已释放I；本人在途3源diff备份忽略patch后恢复，不提交重复补丁。该在途check类型失败/build未跑保留报告；只读接I冻结49cc07a做QA，不再写业务源/测试。报告已镜像，联合528check/build在途。 实际Ego102四次共享图选择取消保存至v6、同会话profile6→8换图转reference真实UI保存v7通过，旧auto撤且本人/参考保留。接I4e7ed8a→79517d3后528check/build通过，源只读；保存clean/双端/确认待复核。 最终本人报告8ffdef0，源0268925已由I接管并合入（主302f97a/020426d/0fcd78b）；只读接I补丁79517d3后528check/build、13纯/SSR通过，实际PG55458/API保存v8 clean/同会话换图v7/确认v9与重放/seed不随profile9改动已验，390×500/844及1440居中430截图已检。0模型/生图，无世界创建。历史stale无旧用途来源不猜删显式参考。Ego102结束一次、PG55458/HTTP3263/3264已释放、本树干净。未上线，待唯一I READY/公网/A14；不接其他任务。 I最终限定技术验收：主0fcd78b Production ku7jp3ee8/dpl_CbgdfX2xcbh8kk4UEW4ce7BDKWSJ READY、正式手机390/PC1440真实选取消/保存clean/刷新通过；528check/build、11相关真实PG、F保存换图/确认immutable通过，0模型/生图。39生产校验一致。三个子包限定完成，A14待用户；历史stale无旧来源保留合法参考。最后文档提交READY见忽略交接及最终回报。|
|FRIEND-PHOTO-01I|[x] 已完成|codex-friendphoto01i-01a11a84-20261010（排查分支创建失败，唯一集成部署）|先闭合NOTES-WORLD-02最终35d3e26 READY，再独立scene-index-transitions受控接辅助朋友UI稳定提交；主只接受上述源码/测试及3专属报告与登记/DEPLOYMENT。必要tests/integration/life-drafts.test.ts仅补既有朋友自动照片规则真实验收；draft-repository/roles/SQL/API目前只读，有缺陷先扩围。PG55450/HTTP3254若启动先登记，独立浏览器资源登记；不并写辅助源。|确认现有draft-repository已将选择人物照片自动合入seed资产，无需用户再次选择assetIds；保持owner/ready/version/照片用途约束，不带未选人物。审取消选择/资料更新/同图多角色，真实保存确认与头像/相册既有集成证据范围明确。联合check/build、生产39校验、受控提交推送READY、公网创建页关键UI后限定完成，再追加A14用户待体验。禁止夹client/interview/LIB/BOOT WIP，0生图/无新增模型调用。 已领取：NOTES35d3e26/l200yl328 READY最终readonly通过，旧报告不覆盖。唯一I codex-friendphoto01i-01a11a84-20261010，独立scene-index-transitions从35d3e26冻结；仅本人tests/integration/life-drafts.test.ts/FRIEND-PHOTO-01I报告/主表/DEPLOYMENT，辅助draft-editor/helper/UI测试只读等冻结。本人PG55450/HTTP3254-3255必要时、启动前确认无监听；新浏览器创建后登记，0模型/生图。 I已冻结222ac37（仅2新真实PG边界）相关11/11通过。待F核对UI边界：旧自动人物图换图后若重新归reference，新helper保留old+new；只读纯复现证据见I报告，源不并写。公网既有未确认草案36923704-2e13-46f8-b31b-c38c062e7699、2人物均有原图，可实际保存刷新而不新建付费世界。 已接辅助0268925源码停写释放；I唯一串行扩围draft-editor.tsx、draft-photo-selection.ts、draft-photo-selection.test.ts修换图时旧自动图变reference误留边界，辅助仅QA/报告不并写。使用上一次已核验roles识别自动旧图，保真正手选本人/参考图；后台仍只读。浏览器新Ego101/p1正式域名，仅本人自有合成会话，已备份site cookie待最终恢复。 I扩围3源已完成冻结49cc07a（13专项/528check通过），F不用再改相同previousRoles/ref方案，只读接受0268925后49cc07a复验实际会话换图。F消息条件“若未并写”不成立，I已先登记并完成，不在F树改源。等待根转达避免并写。build在途，源释放F只读QA。 F真实页面保存已持久但仍dirty，I在既登记editor范围串行接受服务端story/setup/selection回执解决字段键序/裁剪造成假未保存；F只QA不改源。最终check/build和实际保存状态须重新验证。 最新保存回执修复冻结4e7ed8a→主0fcd78b，528check/build重新通过；真实schema复现personRoles键序导致假dirty。F可在1875fea接4e7ed8a只读QA保存clean/刷新/换图，尚未push等待实际证据。生产39校验04:11:41Z一致。 I最终限定技术验收：主0fcd78b Production ku7jp3ee8/dpl_CbgdfX2xcbh8kk4UEW4ce7BDKWSJ READY、正式手机390/PC1440真实选取消/保存clean/刷新通过；528check/build、11相关真实PG、F保存换图/确认immutable通过，0模型/生图。39生产校验一致。三个子包限定完成，A14待用户；历史stale无旧来源保留合法参考。最后文档提交READY见忽略交接及最终回报。|
|FRIEND-PHOTO-01COORD|[x] 已完成|codex-main-friendphoto01-coord-20261010（根协调与只读接收）|主仅本3行分配、后续A14和docs/task-reports/FRIEND-PHOTO-01COORD.md；业务只读，无DB/模型/构建/端口。|已读创建页与draft-repository：后台实际自动合入，前台人物照片仍在重复可选图列表且reload只过滤不补新照片，需一起修。分配辅助唯一前端、I唯一集成及真实链路/部署，旧NOTES本轮限定收尾不混任务。先稳定源码与照片来源复核，READY后记录用户待验，其他现场/时间/创建预览业务先讨论。 根已只读审主302f97a/020426d/0fcd78b，初次旧自动图转reference与真实保存dirty失败如实保留。源接管冲突已纠正：唯一I补丁，F备份其WIP只QA。root专属报告冻结交I最终发布；528check/build、11相关真实PG来自I，不称全库。首次历史stale草案出处不明保留合法参考不猜删；待最终QA/READY/公网后由I限定完成并加A14用户待体验。根不再写源/报告。 I最终限定技术验收：主0fcd78b Production ku7jp3ee8/dpl_CbgdfX2xcbh8kk4UEW4ce7BDKWSJ READY、正式手机390/PC1440真实选取消/保存clean/刷新通过；528check/build、11相关真实PG、F保存换图/确认immutable通过，0模型/生图。39生产校验一致。三个子包限定完成，A14待用户；历史stale无旧来源保留合法参考。最后文档提交READY见忽略交接及最终回报。|

### 2026-10-10 · 手机原有来信的有限前史接续

本批只补新世界的联系人历史来信、统一故事时刻与初始已读/未读。不取消 BOOT-01 日历/便签/真实素材同源前史、任务演进、地图移动或多聊天；不将子包完成当作整体完成。旧世界不随机回填历史，不替玩家编写过去或当前发送的气泡，原失败和不可变快照保留。

|任务|状态|唯一负责人/范围|验收与接续|
|---|---|---|---|
|BOOT-01M-I|[ ] 进行中|指定 codex-boot01m-i-01a11a84-20261010；既有「排查分支创建失败」为唯一业务集成/部署。独立 scene-index-transitions 更新112bd87；先登记精确契约/domain/build/读取/actor-context/通知调用方及测试范围，公共文件串行单写，不夹主client/interview/LIB/BOOT文档WIP。|有限历史消息提案与运行时校验：每个新世界联系人至少有过去来信，明确故事相对时刻、初始已读与少量当前未读；不合格式/引用/时刻拒绝，不虚构玩家发言。一次不可变基线与现任务事务；NPC只能承接自己的过去；新手机通知只展示未读，旧数据兼容。冻结契约后释放辅助测试；check/build、真实PG/双端、生产迁移/READY/公网后有限完成。新文本探针最多2实际供应商请求（含纠错），仅专属合成世界，未知不重付，生图0；先无付费测试。完整BOOT父保留未完。 已领取：独立scene-index-transitions从112bd87，唯一I；源src/contracts/world-build.ts、world/domain/types.ts及新genesis-messages.ts、world/infrastructure/world-planner.ts/build-handler.ts/build-repository.ts、phone/world-app-data.ts/notification-projection.ts。actor-context/opening-time先只读；若需改先登记。新tests/genesis-messages.test.ts、integration/boot-01m.test.ts；现world-build/people-world/notification-projection/world-app-data纯测试及integration/world-build/people-world/person-avatar-update/photo-world-02q/player-boundary/setting-trials必要夹具兼容更新；必要新tests/helpers/genesis-fixture.ts。报告BOOT-01M-I/主表/DEPLOYMENT；主client/interview/LIB/BOOT WIP只读，无SQL预留。独占PG55450、HTTP3254/3255若启先核对监听，本人check/build、新单一Ego创建后登记；模型全批最多2供应商请求含纠错，先0无付费，生图0。契约候选先报告供根/F只读。 串行扩围仅src/features/phone/apps/types.ts透传PhoneMessage.initialRead：通知实际消费mergedData.messages，不能只改原WorldPhone和contact计数。world-phone-app/apps消息渲染仍只读，F新boot-01m-q.test.ts只读。T0改为模型请求前一次确定传两个入口，原UTC+08政策不变。契约ddeb6e7已冻结，字符串key写边界加固与业务接线进行中。 精确测试扩围tests/player-projection.test.ts：其动态WorldPlanner测试也需显式新前史夹具，保留伪playerActors/内部persona不公开断言；不改生产裁剪。 最新冻结ddeb6e7→56be119→8b46909（业务）及f350461（I事务测试）。537check/build通过；PG分次14pass/1可选HTTPskip+18照片相关pass，非全库。根/F提的字符串key绕过已在56be119修，并有key undefined/数字/reply数字负例；current已在8b46909保留不同分钟45/25/12/5。F必须接到8b再最终QA，不写同源。新模型0/2、生图0，下一生产39/受控集成准备。 真实正式新世界探针2/2请求已用尽：首覆盖不足INVALID_MESSAGE_HISTORY，纠错后persona缺失INVALID_RESPONSE；生产task failed、未ready，没有半世界。不能标实际生成验收通过，不再供应商请求/暗重付。I继续既登记world-planner与world-build.test最小提示修正（NPC-only、必填字段、json_object），保持运行时严格拒绝；修正后真实成功仍待额外授权额度，不用fixture冒充。Ego104/p1正式空间已创建，本站pl_session已备份，验失败/旧读后恢复。 根2026-10-10明确追加有界验证最多2请求，累计4；保留旧2失败账本。I先统一完整JSON示例history/NPC必填字段与固定cast输出示例，强校验不放宽；若4均失败须门控未验收特性保可用创建。尚未实际成功，不标完成。 累计4/4实际请求全部失败（3非法actor key/历史遗漏、4便签结构/遗漏历史），0新world。扩围仅src/server/worker-composition.ts以显式关闭未验收history模式；planner/handler保留独立严格历史验证与旧生产协议，禁止模板填充。新增门控回归测试，恢复此前可用生产路径后READY/公开失败诚实验收，任务仍待验。 当前有限源码/PG/UI已验：540check/build与双方12真实PG通过，F稳定test已受控接受；实际模型累计4/4失败，生产显式关闭强制history恢复旧协议。整体新建前史仍待验，父BOOT未完成/A15暂不开放，不能勾完整完成。最终源49916dd待READY公网后记录。 最终49916dd/7z1iq8t5b READY、公网health与既有世界200/失败提示已验；2失败任务world与initial各0、4请求不变。整体前史待验且生产关闭，A15不开放，资源已释放，未新增真实创建成功证据。 接续说明：单步4真实失败仍保留，生产恢复后由BOOT-01N两步另行真实验收成功，不把M失败改为成功；N仅有限NPC旧来信完成，父BOOT未完。|
|BOOT-01M-Q|[ ] 待验收|指定 codex-f-boot01mq-01a0c7c8-20261010；既有「辅助」独立 photo-compose-02 从112bd87。先只读新docs/task-reports/BOOT-01M-Q.md和本人主表行；源码/契约/SQL/配置只读，测试或UI扩围等待I冻结后根明确释放。|独立核对既有消息/未读/联系人可见性/角色上下文/replay及旧世界兼容风险，提出可运行正反例；后续实际PG/UI复核不重复写I源码，禁止夹具冒称模型或公网。端口/数据库/browser使用前本人登记，0供应商请求。 已短锁领取（2026-10-10）：Agent codex-f-boot01mq-01a0c7c8-20261010，独立/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，计划codex/boot-01m-q从冻结112bd87复用；仅新docs/task-reports/BOOT-01M-Q.md与本人主表/报告镜像。业务/SQL/公共契约/phone/client/所有测试只读；先实质审查报告，第二阶段等待I契约冻结及根明确释放。无PG/HTTP/browser/check/build/模型资源占用，不接GitHub邀请或父BOOT其他能力。 阶段一实质报告已交主镜像：7项静态缺口（每actor覆盖/初始读态/固定分钟时间与查询丢元信息/联系人可见性/自己的过去召回/legacy-replay/记忆来源），8组可运行PG/UI正反例；19现有引用路径及diff通过。仅报告独立提交6879535，无npm/PG/浏览器/模型验证，无源码/测试修改和资源占用。工作树已为codex/boot-01m-q@112bd87基线。本任务仍进行中，等待I冻结与根明确释放第二阶段测试/QA，不自行扩围。 候选协议只读复核024be2c已交镜像：v1有界history/同actor更早引用/T0/运行时初始读态可采纳，无需扩大父BOOT；记录新建强制history/回复分钟方向与ID映射/实际查询元信息/同事务4项接线门槛，复用5组精确负例。30分钟前正例改120；长史模糊召回和历史DST不作本包门槛。仍无测试源/PG/HTTP/browser/模型执行，等I稳定提交+根正式释放独占boot-01m-q.test.ts。 根明确释放第二阶段（2026-10-10）：仍同一独立树codex/boot-01m-q，接冻结ddeb6e7仅4文件；唯一新增tests/integration/boot-01m-q.test.ts、本报告及本人行/镜像可写，其他业务/契约/SQL/已有测试只读。独占本树check/build；PG55458、必要HTTP3263产品/3264合成会话helper、boot01mq.localhost及一个新专属Ego（创建后登记ID）；使用前核对监听，0供应商/生图。仅本人忽略.local/boot01mq-*夹具/启动/guard/HTTP/UI证据脚本和临时依赖链接可写。先准备测试，完整PG/UI必须等I下一稳定业务commit由根转达，不将旧代码接线失败当回归。 冻结纯runtime直接复现缺key漏洞：MessageHistorySchema拒绝但validateMessageHistory/genesisMessages接受undefined key（正则隐式转字符串），history.key缺失；报告镜像已交根转I修，Q不改源。ddeb6e7→d91910d已接，新增QA测试准备中，完整PG/UI等待业务稳定。 新专属测试已准备：纯key回归实际red（缺异常）留log，真实PG4子组两planner/投影/回执replay/隔离/8拒绝及legacy尚未跑。测试首类型失败已修后typecheck通过；新增当前两来信分钟显示不同断言，等最终业务冻结。本人PG55458已启动，HTTP/Ego尚未开，0供应商。 已接56be119→f0f94e0/8b46909→7af7faa/f350461→baecbb7；本人PG专属最终6/6（4PG子组+纯key+父）、537check/build通过；首PG仅legacy夹具误用app UPDATE权限42501，已仅修测试admin准备并保留失败。Ego103/p1唯一新空间已创建，HTTP3263/3264产品+会话helper与PG55458实际独占；合成3actor/4history/3current持久world已建，暂停原时钟/guard禁外部，0供应商。首wait微信button超时，下一同空间观察锁屏实际入口，不重建。 最终独立fd8c719仅新tests/integration/boot-01m-q.test.ts与本报告，树干净；真实PG6/6（4子组+纯+父）、537check及build通过。Ego103实际390×500/844和1440×900：初始历史不通知，展开不读，进入会话只清对应未读，历史联系人可见，返回scrollTop0恢复，刷新历史ID/内容不变，新消息新ID再次通知及定位正确，PC420宽居中无横溢。actual PG raw immutable initial全文未变。0本人供应商/生图，显式fixture非模型/公网；根转I首2真实模型失败及累计4上限仅记外部证据。截图与安全JSON在独立忽略.local/boot01mq-evidence；主报告已镜像。103关闭且本人55458/3263/3264无监听，临时依赖链接移除，资源释放。只标待验收；唯一I接此QA提交，负责真实模型/生产迁移/READY公网，不重复接业务提交，不扩父BOOT或GitHub权限。 当前有限源码/PG/UI已验：540check/build与双方12真实PG通过，F稳定test已受控接受；实际模型累计4/4失败，生产显式关闭强制history恢复旧协议。整体新建前史仍待验，父BOOT未完成/A15暂不开放，不能勾完整完成。最终源49916dd待READY公网后记录。 最终49916dd/7z1iq8t5b READY、公网health与既有世界200/失败提示已验；2失败任务world与initial各0、4请求不变。整体前史待验且生产关闭，A15不开放，资源已释放，未新增真实创建成功证据。 接续说明：单步4真实失败仍保留，生产恢复后由BOOT-01N两步另行真实验收成功，不把M失败改为成功；N仅有限NPC旧来信完成，父BOOT未完。|
|BOOT-01M-COORD|[ ] 待验收|codex-main-boot01m-coord-20261010；主目录仅本3行/相关接续索引/后续用户验收行及docs/task-reports/BOOT-01M-COORD.md。业务只读，不开端口/模型/数据库/构建；原计划/报告WIP不纳入本批。|根先完成112bd87 READY与原自动照片交付复核；将明确历史来信需求和有限范围派现有两线程。读取并复核冻结契约、独立失败/QA证据，公共变化只交唯一I，避免同文件并写。有限前史消息完成后同步父BOOT仍未完成和用户待体验；地点/现场/时间制度仍须讨论，不以实现新制度跳过。 根已审ddeb6e7/56be119/8b46909/f350461冻结与来源/时间/初始读态接线，辅助独立缺key红例及分钟回归已转I；537check/build、分次32真实PGpass/1显式skip来自I，供应商/公网仍待。根专属报告冻结，允许唯一I受控接收最终测试/3报告/登记/A15与部署记录，根不再写以防并写；完整父BOOT与地图任务保留未完。 当前有限源码/PG/UI已验：540check/build与双方12真实PG通过，F稳定test已受控接受；实际模型累计4/4失败，生产显式关闭强制history恢复旧协议。整体新建前史仍待验，父BOOT未完成/A15暂不开放，不能勾完整完成。最终源49916dd待READY公网后记录。 最终49916dd/7z1iq8t5b READY、公网health与既有世界200/失败提示已验；2失败任务world与initial各0、4请求不变。整体前史待验且生产关闭，A15不开放，资源已释放，未新增真实创建成功证据。 接续说明：单步4真实失败仍保留，生产恢复后由BOOT-01N两步另行真实验收成功，不把M失败改为成功；N仅有限NPC旧来信完成，父BOOT未完。|

### 2026-10-10 · BOOT-01N 两步生成真实历史来信

接续 BOOT-01M 四次真实失败。保留原失败、生产4b593e2可用协议与未提交WIP；不能重复追加提示词后将夹具当真实模型验收。先世界设定独立校验，再以冻结演员/故事锚点生成有限历史；所有通过后一次事务保存。未知/取消不自动重付，手机旧数据不改写。

|任务|状态|唯一负责人/范围|验收与接续|
|---|---|---|---|
|BOOT-01N-I|[x] 已完成|指定 codex-boot01n-i-01a11a84-20261010，既有排查分支创建失败；独立scene-index-transitions从4b593e2。唯一业务/集成/部署。范围world-planner.ts、新history-planner.ts、build-handler.ts、worker-composition.ts及现world-build/genesis纯测试与新integration/boot-01n.test.ts；既有契约/domain/AI端口先只读，必要扩围登记。主client/interview/LIB WIP不夹带。|先读报告提出最小两阶段方案，注意HTTP总110秒/120秒限制，不能每步各85秒无整体约束。既有快照schema/read标记复用；编号与角色绑定由运行时，不猜补文字。限定付费验证本批最多10真实文本供应商请求（含纠错/NPC），新账本保留上批4失败，不暗重置；普通与固定cast实际新世界及角色承接，0生图。阶段失败不写半世界。真实PG/双端/check/build/生产39一致/READY/公网通过才开放，失败保原生产路径。本人领取细化资源/实现后根释放Q。 本人短锁精确领取：Agent codex-boot01n-i-01a11a84-20261010，scene-index-transitions基线4b593e2；唯一world-planner/new history-planner/build-handler/worker-composition，tests/world-build.test.ts、必要genesis.test、新integration/boot-01n.test.ts，新增必要tests/history-planner.test.ts。复用本人PG55450，HTTP3254/3255必要时，新单一Ego待登记；本人check/build独占，0/10供应商，生图0。先报告最小协议方案，其他AI端口/公共契约/domain只读。 源码冻结b265959（5文件：world-planner/history-planner/build-handler/新history纯测试/新boot-01n PG），550check/build与5实际PG通过。唯一生产worker保持false未写源，F可接b265959只读并写其独立新test；I源码冻结直到QA有依据修正。类型夹具schemaVersion宽类型失败已LifeSettingContentSchema.parse纠正，未改生产约束。普通/固定cast两步同T0/原子，明确整数actorIndex全覆盖乱序，同名不混；历史关系显式branchRole或空不取内部。原生AbortError/TimeoutError阶段1/2晚到均CANCELLED/TIMEOUT不重试。I接下去独立10请求预算真实普通/固定cast/NPC承接，0已使用，无生图。 关键实际进展：两类world真实成功（普通4演员8过去/3当前，固定2演员4过去/4当前），7/10供应商含两NPC，验证回执字段脚本错只读恢复不重付；Ego105正式会话先备份，550check/build与5PG绿，生产仍false。 业务与测试已完成，统一待验收：7a98c8f/2wwrxj6mp READY，550check/build、最后15串行真实PG专项；F独立test82783ce仅取新test→7e7fe79，full报告主镜像保留。2普通/固定cast真实世界、2NPC承接/immutable已验，7/10模型，0图。最后正式公共读与资源清理后有限技术验收，不称全BOOT或用户通过。 有限集成自审通过：业务7a98c8f/2wwrxj6mp/dpl_F6DchQ4YWpsD62nNpuciofQsRYXk READY，QA独立test7e7fe79待随最终文档发布；550check/build、最后15串行专项全部通过（含F纯跨午夜/PG父组）。本批实际7/10文字请求=普通世界2+历史1、固定cast世界1+历史1、两NPC各1；普通4人物8旧/3当前，固定2人物4旧/4当前，NPC版本1/immutable hash不变。正式READY后health/两world均200，390短屏/长屏和1440电脑420宽无溢出，历史默认已读不通知，当前独立分钟/读态正确。旧M四失败不改为通过；本轮首遗漏地点纠正、脚本receipt误读只读恢复、语义样本限制保留。所有真实seed明确合成，不冒称AI推荐；真实模型执行为本机冻结planner+生产受限Queue/Repository，未额外付费测试HTTP /tasks/run。model gpt-4o-mini与旧自有正式task元信息一致、85秒gateway同实现；当前生产敏感env值由Vercel遮蔽，无法直接比较key/baseURL，不冒称已独立核验。两自有world已暂停/仍version1，7请求不变、0生图。I105会话精确恢复并finish一次、PG55450及HTTP3254/3255无监听（HTTP未启）、临时依赖链接清理；F106/55458/3263/3264清理。39生产迁移06:11:28Z校验一致、无SQL。仅有限NPC过去来信本包完成，父BOOT日历/便签/素材/长期召回/跨设备读态及任务地图多聊天仍未完成，用户A15待体验。|
|BOOT-01N-Q|[x] 已完成|指定 codex-f-boot01nq-01a0c7c8-20261010，既有辅助；独立photo-compose-02从4b593e2。第一阶段只写新报告BOOT-01N-Q与本人主表行，所有业务/旧测试只读。|先审两阶段输入边界、少人/遗漏/错误顺序、截止取消/第二步失败/角色只知自己、旧协议/幂等；提出可运行负例。I冻结后根再释放唯一新tests/integration/boot-01n-q.test.ts及独立PG/UI，不抢源码/端口/模型。0供应商/生图。 已短锁领取第一阶段：Agent codex-f-boot01nq-01a0c7c8-20261010；独立/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本，计划codex/boot-01n-q从4b593e2；旧fd8c719保留codex/boot-01m-q。仅新docs/task-reports/BOOT-01N-Q.md、本人主表行与主报告镜像可写；全部业务/配置/契约/SQL/旧测试只读。PG/HTTP/browser/npm/供应商/生图资源均0；I冻结+根正式释放才扩新测试和实测资源。 第一阶段报告独立4b61a41已交主镜像，仅新报告，树干净。提出纯顺序2D错绑/完整opening隐藏资料泄露风险，根已采纳groups显式actorIndex全覆盖可乱序及公开identity/setting+index/name/relationship裁剪；仍待冻结源码。13组可运行正反例涵盖普通/2人固定cast、编号/授权规范化、私聊context/现实隔离、跨午夜同T0、共享100秒+外110秒与取消迟返写边界、有限纠错与unknown/截断不重付、第二步no halfworld/写真outbox、重复与lease、legacy/single/two-mode、receipt/replay/RLS与双端UI。15现有接点核实及diff通过；无新增测试/业务源，无npm/PG/HTTP/browser/供应商/生图，不能冒称本轮绿灯。上批4失败及生产恢复门控保留。仍进行中等待I稳定commit+根明确释放专属新test与资源，不自动扩围/开新任务/回发消息。 根已读稳定b265959完整5文件，正式释放第二阶段：唯一新增tests/integration/boot-01n-q.test.ts、本报告/本人行/主镜像；其他业务/旧测试/SQL全只读。仅独立PG55458、必要HTTP3263/3264、boot01nq.localhost和一个新Ego空间（创建后登记）；每次先确认监听，0模型/生图。允许本人check/build与忽略.local/boot01nq-*测试证据脚本/临时依赖链接。接b265959后跑明确编号/隐私/原生abort/两入口/原子失败与旧读，实际双端；不重复上批已验证来源安全全套，不冒称公网AI。 本人第二阶段短锁确认领取：同codex/boot-01n-q独立树接b265959，仅新integration/boot-01n-q.test.ts和报告/本人行/镜像可写；55458/3263/3264开前无监听已核对，允许独立check/build、boot01nq.localhost与一个新Ego（创建后登记），0真实模型/生图。其他业务和所有旧测试只读，接I稳定源码不重复修改。 新专属test已写、PG55458启动：最终6/6（1纯跨午夜+PG父+4真实子组），乱序编号/同名正确绑定、授权role/历史privateinput裁剪、两人fixedcast、13失败无halfworld、receipt/replay/RLS/legacy。首类型枚举及补跨午夜T0规范格式夹具失败已仅修测试并留日志。550check通过，build进行中；两阶段UI fixture真实队列建951ad0fd-daec-4659-882e-bfe79a27041d（3actor/4past/3current），时钟暂停/0供应商，浏览器尚未开始。不标AI或公网成功。 build通过，3263/3264开前无监听后实际启动；唯一新Ego106/p1登记，390初始锁屏已有当前小芳2/小李1，PG55458仍本人占用；0模型/生图，继续实际双端，不操作105或他人cookie。 最终独立82783ce仅新增tests/integration/boot-01n-q.test.ts和报告；树干净，b265959→016e63e只接不改源。专项最终6/6（纯跨午夜+PG父+4真PG子组），550check/build通过；13失败模式无半world，编号/同名/公开branchRole/privateinput、T0/sharedsignal、native取消/timeout、legacy及receipt/replay/RLS通过。Ego106真实390短长/1440PC初始历史不通知、当前A2/B1、展开不读、通知定位、历史联系人、返回scroll0恢复、刷新7消息全稳定与PC420居中；initial原文真PG不变。依根有限收尾未再做browser新ID，沿BOOTM证据，本轮PG两turn新ID投影有证据。本人0模型/生图，不把fixture当AI/公网；根转I本批7/10真实成功只列外部证据。报告镜像已交，安全证据截图在忽略.local/boot01nq-evidence。106关闭且本人PG55458/HTTP3263/3264无监听、临时依赖链接释放。下一唯一I接QA提交负责生产39/门控two-step/READY/公网；本人待验不部署、不领取其他任务、不回发消息。 业务与测试已完成，统一待验收：7a98c8f/2wwrxj6mp READY，550check/build、最后15串行真实PG专项；F独立test82783ce仅取新test→7e7fe79，full报告主镜像保留。2普通/固定cast真实世界、2NPC承接/immutable已验，7/10模型，0图。最后正式公共读与资源清理后有限技术验收，不称全BOOT或用户通过。 有限集成自审通过：业务7a98c8f/2wwrxj6mp/dpl_F6DchQ4YWpsD62nNpuciofQsRYXk READY，QA独立test7e7fe79待随最终文档发布；550check/build、最后15串行专项全部通过（含F纯跨午夜/PG父组）。本批实际7/10文字请求=普通世界2+历史1、固定cast世界1+历史1、两NPC各1；普通4人物8旧/3当前，固定2人物4旧/4当前，NPC版本1/immutable hash不变。正式READY后health/两world均200，390短屏/长屏和1440电脑420宽无溢出，历史默认已读不通知，当前独立分钟/读态正确。旧M四失败不改为通过；本轮首遗漏地点纠正、脚本receipt误读只读恢复、语义样本限制保留。所有真实seed明确合成，不冒称AI推荐；真实模型执行为本机冻结planner+生产受限Queue/Repository，未额外付费测试HTTP /tasks/run。model gpt-4o-mini与旧自有正式task元信息一致、85秒gateway同实现；当前生产敏感env值由Vercel遮蔽，无法直接比较key/baseURL，不冒称已独立核验。两自有world已暂停/仍version1，7请求不变、0生图。I105会话精确恢复并finish一次、PG55450及HTTP3254/3255无监听（HTTP未启）、临时依赖链接清理；F106/55458/3263/3264清理。39生产迁移06:11:28Z校验一致、无SQL。仅有限NPC过去来信本包完成，父BOOT日历/便签/素材/长期召回/跨设备读态及任务地图多聊天仍未完成，用户A15待体验。|
|BOOT-01N-COORD|[x] 已完成|codex-main-boot01n-coord-20261010，主目录只登记、BOOT-01N-COORD报告及只读代码/证据审查。无业务/DB/模型/构建/browser。|复核I最小拆分策略与有限来源、超时、模型请求上限；协调既有两聊天避免公共写重叠。一次最终文档发布，保留全BOOT、任务/地图/多聊天待完成；用户继续不等于用户验收。 根已审b265959：显式编号全覆盖/乱序按编号绑定、只公开明确branchRole与未知空、100秒child取消映射TIMEOUT/CANCELLED、两个阶段不回写现实且一次事务。550check/build与5真实PG来自I，不称根执行；辅助首审4b61a41已采纳。根报告现在冻结，允许唯一I受控收3报告与最终任务表/验收入口/DEPLOYMENT，一次最终文档部署，根不再改以防并写。尚0/10实际本批模型，待真实成功/READY/公网。 业务与测试已完成，统一待验收：7a98c8f/2wwrxj6mp READY，550check/build、最后15串行真实PG专项；F独立test82783ce仅取新test→7e7fe79，full报告主镜像保留。2普通/固定cast真实世界、2NPC承接/immutable已验，7/10模型，0图。最后正式公共读与资源清理后有限技术验收，不称全BOOT或用户通过。 有限集成自审通过：业务7a98c8f/2wwrxj6mp/dpl_F6DchQ4YWpsD62nNpuciofQsRYXk READY，QA独立test7e7fe79待随最终文档发布；550check/build、最后15串行专项全部通过（含F纯跨午夜/PG父组）。本批实际7/10文字请求=普通世界2+历史1、固定cast世界1+历史1、两NPC各1；普通4人物8旧/3当前，固定2人物4旧/4当前，NPC版本1/immutable hash不变。正式READY后health/两world均200，390短屏/长屏和1440电脑420宽无溢出，历史默认已读不通知，当前独立分钟/读态正确。旧M四失败不改为通过；本轮首遗漏地点纠正、脚本receipt误读只读恢复、语义样本限制保留。所有真实seed明确合成，不冒称AI推荐；真实模型执行为本机冻结planner+生产受限Queue/Repository，未额外付费测试HTTP /tasks/run。model gpt-4o-mini与旧自有正式task元信息一致、85秒gateway同实现；当前生产敏感env值由Vercel遮蔽，无法直接比较key/baseURL，不冒称已独立核验。两自有world已暂停/仍version1，7请求不变、0生图。I105会话精确恢复并finish一次、PG55450及HTTP3254/3255无监听（HTTP未启）、临时依赖链接清理；F106/55458/3263/3264清理。39生产迁移06:11:28Z校验一致、无SQL。仅有限NPC过去来信本包完成，父BOOT日历/便签/素材/长期召回/跨设备读态及任务地图多聊天仍未完成，用户A15待体验。|

## 10. 用户体验验收索引（2026-10-10起，后续交付持续追加）

用户最新要求：继续按依赖开发，不在每次交付后要求用户立即测试；把需要本人体验判断的内容留下来，之后询问“有什么没验收”时从本节回答。**开发与技术验证完成，不等于用户认可体验。** 本节只登记用户体验验收，不替代原任务的开发状态，不从用户未回复推断通过；已有反馈也不自动算后来修正版已被用户验收。

阅读方法：第9节说明还有什么没开发；本节说明哪些已上线可体验、哪些以后上线再加入。正式入口仍使用本项目生产地址，具体最新部署以 DEPLOYMENT.md 为准。本次核对基线为899167c（便签业务c97ee5c、头像25d7b88；首页3ff0b3a、诊断9748506、照片审查f1cc0c7仍保留）。生产39项迁移一致，头像READY后公网手机/PC、便签READY后实际保存/编辑/原回执重放与跨账号拒绝已验证；同账号双分支冲突的本轮证据来自真实数据库测试，未冒称公网通过。后续版本合入后更新基线与影响行；代码已推送但未READY或未公网验证的项不能移入“可体验”。测试条数/单个模型成功不证明趣味性、自然度或产品整体可上架。

### 已上线、需要用户体验判断的范围

以下均为“本轮修正版未收到明确用户验收反馈”，并非邀请用户立即测试。统一入口是“聊聊 / 分支 / 我的”，进入已有分支需使用自己原来创建的游客会话；目前不承诺跨设备账号恢复。

|核对项|对应任务与技术证据|以后可怎样验收|预期与边界|用户体验结论|
|---|---|---|---|---|
|A01 手机首页与图标|PHONE-HOME-04；3ff0b3a；报告记录本地与公网390短屏/PC|进入已有分支，解锁；查看四个Dock图标、标签、首页卡片和顶部返回/切换；打开微信、日历、相册、备忘录并返回；窄屏/短屏/电脑各看一次|布局不遮挡、无无效应用入口、返回切换直接可达；判断视觉与沉浸感是否达预期。地图与系统任务尚未含在本项|待用户体验；此前“图标丑/排版差”的反馈保留，不因技术检查通过当已认可|
|A02 手机入口拆分|PHONE-HOME-03；5502662→e96cee6联合上线；DEPLOYMENT对应记录|检查首页没有旧混合“设置”；分别打开身份、时间、备忘录；通过顶部返回聊聊、切换人生|各入口用途清楚；没有当前世界导演改设定入口；备忘录现有私人便签可编辑，不能把它误认完整任务功能|待用户体验|
|A03 聊天中构思按需展开|BRANCH-UI-02与BRANCH-FOCUS-01；e96cee6联合上线；生成可靠性限度见AI-RECOVERY-01|正常聊天时查看底部快捷入口，展开/收起构思；有明确想体验的身份时查看新构思；再单独使用主动探索|大卡片不持续占据聊天区；新focused构思一个方向，主动explore可多个方向；历史三方向记录不被删除。真实AI曾超时/偏移，最新单样本通过不能承诺每次成功|待用户体验；分支生成完整可靠性仍未技术验收闭合|
|A04 创建前后修改边界|BRANCH-UI-02、PEOPLE-01R；草案/确认真实保存与公网证据|未确认草案编辑后保存并刷新；确认后再打开摘要；世界中查看人物与身份|确认前真实保存；确认后摘要只读，不展示无法使用的编辑按钮。确认后修改现实人物不改剧情历史；已有联系人头像同步见A11|待用户体验；完整手机前史不属于此项|
|A05 照片与说明一起发送|PHOTO-COMPOSE-02I/PHOTO-QA-03；1acb770生产31tjtsm88；后续视觉版本沿用|选图后先不发送，补“这是某某”等说明再一起发；生成期间另写草稿；保存后去“我的”查看对应人物并刷新|选图阶段不立即发送；原照片和说明同一条消息，下一条草稿不被清空；关联提示只能来自真实保存。当前单图/可区分两图组，非无限多图批量识别|待用户体验；用户曾报告错归生活照/漏关联，原失败保留|
|A06 多图指代与错误关联保护|PHOTO-COMPOSE-02I、PHOTO-WORLD-02Q；f1cc0c7独立原图测试；主表限定证据|两张不同图片分轮说明“第一张是甲，第二张是乙”；同名人物分别查看；试“这不是甲/这是甲吗”等否定或疑问说明|可区分图片按原消息来源关联，姓名相同不混人；疑问/否定不自动绑。重复素材或过大歧义组可以不关联，需清楚提示，不把猜对一次当全语义通过|待用户体验；新两图模型样本曾unknown，不能称所有自然表达已通过|
|A07 原图带入、头像与相册|PEOPLE-01R、PHOTO-WORLD-02Q；原图两旧世界公网200，跨账号404|在“我的”保存人物姓名/描述/照片，创建时选择带入；进入对应联系人与相册，刷新后重看；未选择人物不应出现|使用已获准原图，保留人物姓名及虚构身份，头像与相册素材对应。不是生成新场景照片，也不是人脸身份识别；换图同步见A11|待用户体验；已有旧世界原图历史不会被随意覆盖|
|A08 读图是否有帮助|VISION-01I、VISION-01QA；6258884；实际6次视觉请求4完成2unknown，部分OCR/几何错误保留|发一张图片及具体问题，检查回复是否依据可见内容；否定“不要比较旧图”时检查没有擅自引入历史图片|具备本轮图文输入能力；不承诺视觉理解准确率、人脸身份判断或图生图。需要用户判断回复具体程度和引导价值，不能仅按有回复算通过|待用户体验与更多有界质量样例；图生图仍未实现|
|A09 我的资料写入边界|BASICINFO-01、PEOPLE-02/PEOPLE-01R；3c51cdf修正；真实PG与公网三反例|现实信息、假设分支信息分开聊；在“我的”查看基础资料与身边的人，修改姓名和“我的描述”并刷新|明确现实陈述可以入资料，想成为的职业/虚构生日不应写现实档案；生日单值应与基础资料一致。不批量清理旧用户历史，所以旧重复数据可能仍需迁移/人工更正|待用户体验；历史资料整理/一般自然语言准确率不在有限反例通过中全部解决|
|A10 失败时保留内容与恢复|PHOTO-COMPOSE-02I、AI-RECOVERY-01；9748506诊断|仅在方便时观察网络失败：照片说明与新草稿是否保留；失败/结果不确定是否区分；刷新检查已保存结果|失败重发保留原组合；unknown不自动新任务重付、相同命令回原结果。请求/响应/解析阶段诊断是服务端技术证据，用户只需判断提示是否清楚，勿反复生成来测超时|待用户体验；不会为了用户验收主动制造付费超时|
|A11 人物换图同步旧分支|PHOTO-AVATAR-UPDATE-01；25d7b88/a378022，生产606qj30pk READY；39迁移一致，真实PG与公网双端已验证|在“我的”修改已经带入人物的照片，保存后刷新对应已有分支，查看微信联系人；多个已带入同一人物的分支分别刷新；再查看历史相册和聊天图片|当前联系人头像更新；同名其他人物不变，历史相册/聊天/剧情不改。明确清空照片不会回退旧头像；删除现实人物记录不会删除已授权世界角色。已打开的另一页面需刷新，尚无跨页面实时推送。多世界并发由真实PG验证，公网实际双端使用一个既有自有合成世界|待用户体验；技术验证通过不代表用户已认可视觉和操作体验|
|A12 私人便签保存与恢复|NOTES-SAFETY-01/01I、NOTES-WORLD-02I；c97ee5c/899167c，生产fh3igqrkp READY；联合494检查/132真实PG通过、5明确跳过|在分支备忘录新建便签，保存后修改、再保存和刷新；切换不同分支分别查看；若旧保存请求重试，确认当前编辑未倒退|保存记录限定本分支；重复旧请求返回原回执，不覆盖当前新内容。公网v1/v2重放和跨账号拒绝已验证；同账号双分支ID碰撞/并发由真实PG验证，现有公网测试账号只有单分支。历史受损资料未自动修复，近期系统记录另见A13；后续98a66a7/3qs7jl8lj READY公网新增无id新建重发200同回执/改内容409/只1便签，旧132PG基线保留；不要手动复制请求ID来测试|待用户体验；只需以后判断正常保存/刷新/切换的体验，内部安全反例由开发验证|

|A13 备忘录系统记录与私人便签分区|NOTES-WORLD-02I/02UI/02COORD；98a66a7，3qs7jl8lj READY；521check/build、139真实PG通过/5明确可选跳过，正式手机/PC和新建重发已实测|进入备忘录看眼下事项/关于这段人生/我的便签；打开只读详情并返回；有来源事项可回正确人物对话或邀约；正常编辑保存私人便签，搜索/刷新/切换分支|只展示有来源的近期计划/建议/邀约与公开人生起点；没有事项诚实空态，用户自述完成不冒称奖励到账。系统记录不能编辑，私人可编辑；分享讨论入口已移除。读取错误与重试保草稿的故障验证、正例来源来自本地真实PG/UI；正式旧自有世界验证当前空态/起点/私人，未把本地正例冒称公网|待用户体验；完整动态游戏任务与前史仍待开发|
|A14 选择朋友默认带照片|FRIEND-PHOTO-01I/01UI/01COORD；0fcd78b，ku7jp3ee8 READY；528check/build、11相关真实PG及正式手机/PC实测|编辑未确认草案，选择朋友、取消一人或全部、保存后刷新；朋友换图后读取最新资料再核对|朋友当前关联照片自动用于头像与相册，无需再选图；本人/参考图仍手选，无图朋友可入，共用图最后一人取消才撤。保存后正确显示已保存；同会话换图撤旧自动照片。首次重开历史草案无旧照片来源时保留合法参考供核对，不猜删。正式只保存既有草案，未新增付费世界；确认快照不变由真实PG/API验证|待用户体验；技术通过不代表用户已认可，原分支创建AI偶发失败仍按既有范围跟踪|

|A15 新分支的联系人过去来信|BOOT-01N-I/Q/COORD；业务7a98c8f/2wwrxj6mp READY；550check/build、15串行专项，2实际模型新世界与2NPC承接/正式双端已验|正常创建新分支后，查看每位联系人过去来信、故事日期、当前未读，选一件旧事继续聊；刷新后再看|世界设定先校验，再生成过去NPC来信，两步同一故事锚点，全部通过才一起保存。过去默认已读，当前1..4条不同分钟；不伪造玩家气泡、不回填旧世界。普通/固定cast有限模型样本通过，仍可能AI失败或语义偏差，未知不自动重付；完整日历/便签/相册前史及长史召回不在本项|待用户体验；技术验收不代表用户已认可趣味性或所有创建均成功|

### 尚未交付，先不要求用户验收

本表为第9节的体验入口预告，开发状态继续以原任务行为准。部署并验证后把实际范围移到上一表，不把规划按钮或截图当可体验功能。

|后续能力|任务|以后应验收的关键行为|现状|
|---|---|---|---|
|完整任务演进与手机前史|NOTES-WORLD-01、BOOT-01、NAR后续|事项随行动和事件有依据地变化；任务结果与奖励由世界验证；手机存在可信过去|有限近期记录/人生起点三分区已上线见A13；完整长期/短期任务引擎和所有联系人前史仍未交付|
|地点移动、地图与到达反馈|SPACE-02A→02B|选合法地点→合理耗时过渡→到达后能看/能做；故事日期与人物消息/约定一致|待正式契约及实施；已有进入现场不等于完成移动|
|像原来就有人使用的手机|BOOT-01|各联系人有可信历史对话，既有日历/便签/相册来自同一过去；初次收到的通知不是所有人同一时刻|新建分支有限NPC过去来信已上线见A15；完整跨应用前史仍未交付，旧世界不回填|
|新建和历史个人聊天|CHAT-SESS-02～06|新聊天有独立消息/草稿/图片，人物档案仍共享；构思使用对应来源，历史可恢复|只有规划/影响分析，未完成用户功能|
|真正生成并发送新图片|M-01～03、IMG-CHAT-01|有依据且有配额地生成；角色消息与相册同一真实结果，失败与未知如实显示|当前生成累计0；原图上传与视觉读图不等于生成服务已通|
|持续玩的动机、行动与反馈|NAR-02/03/04、EXP-06|眼下处境推动行动，选择改变人物后续行动和用户处境；回访通知有内容、有因果，不只是聊天陪答|部分导演/因果/记忆底座已做；完整任务、奖励与持续趣味仍需实现和整体体验|
|官方完整预设与创作|LIB后续|体验相关人员提供的预设内容，再按启发创建自己的世界|内容编排尚未确定；在途私有创作代码没有纳入本次上线|

### 用户反馈如何收尾

用户之后反馈时，在相应A项记录日期、自己的明确结论、复现条件和关联修复任务；没有反馈继续保留“待用户体验”。若发现阻断，原开发任务按证据标需返工；只是不满意美观或趣味时，记录具体体验差距再设改进范围。不能把技术自审标[x]自动复制为用户通过，也不能把用户一句“继续”当某项已验收。语音仍按用户要求暂缓。正式账号/多人生管理/真人参与/支付/生产运维等旧范围保留在第9节，之后有真实可体验交付再追加本节。
