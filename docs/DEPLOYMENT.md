## 2026-10-18 · Task 44-128 / 44-129 / 44-130 约定改期协商、旧存档接管与时间流速规则已上线

业务 722ac78ae2c324c4e7da7ba48c5a93946002f232 / dpl_uqrLXiB38cQz5jSzyAG2j3AHNYH3 READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、匿名 session 200 (`authenticated: false, kind: guest`)、首页 SSR 200 全流程端到端通过。

交付内容与质量证据：
1. **任务 44-128 约定改期与协商生命周期闭环 (R2)**：
   - 角色与 NPC 原生动作能力 `appointment.reschedule` 注册与调度；
   - 严密前置条件约束（预约存在、非终态、新时刻必须晚于故事时刻、提议人必须是参与者）；
   - 原子事务推进：`parallel_life.world_appointments` 重置为 `proposed`、更新 `at` 与地点；
   - 责任机制同步：对应 `AgentResponsibility` 进入 `waiting` 状态（`waitingOn: 'player'`）、`revision` 原子自增、`deadline` 延期、摘要更新；`AgentGoal` 保持 `active` 赴约状态；
   - 支持反向重新确认（`appointment.accept`）与到场履行（`appointment.fulfill`）全生命周期闭环。
2. **任务 44-129 旧存档安全接管与受控迁移 (R10)**：
   - 契约接口 `LegacyWorldInventorySchema`、`LegacyMigrationRequestSchema` 与 `LegacyMigrationResponseSchema`；
   - 只读就绪检查与原子单事务迁移接管（状态与资产盘点、进行中命令阻塞阻断、预约平滑映射、防双写推进至 Epoch 2）；
   - HTTP 路由 `GET/POST /api/v1/worlds/[id]/migration` 提供完整接管体验。
3. **任务 44-130 时间流速、跨天推进与自然终局规则收口 (R11)**：
   - 严格落地 2026-10 时间规范：浏览模式 12x、交谈与现场 1x、离开暂停、跨天保留未决责任与预约、故事阶段完结与世界停止严格解耦；
   - 专项规则审计测试 8/8 通过。
4. **测试与质量证据**：
   - 真实 PostgreSQL 集成测试 4/4 `tests/integration/actor-appointment-reschedule.test.ts` 全部通过；
   - 真实 PostgreSQL 集成测试 9/9 `tests/integration/legacy-world-migration-http.test.ts` 全部通过；
   - 专项规则审计测试 9/9 `tests/time-pacing-rules-audit.test.ts` 全部通过；
   - 架构模块边界检查通过（619 files clean），`tsc --noEmit` 0 错误；
   - 全量回归测试 `npm test` 3,293 项全部通过；
   - Next.js 生产优化构建成功（27/27 路由）；
   - 生产环境部署 `dpl_uqrLXiB38cQz5jSzyAG2j3AHNYH3` (Ready) 在公网域名 `parallel-life-nu.vercel.app` 完成实测验证。

## 2026-10-17 · Task 44-127 手机各 App 衔接与时间草稿一致性全闭环已上线

业务 1f11767c9d0ee42db0253dc679eb3a7c64a377d6 / dpl_J1W1FSjXf9BXHYuDQ2bY92q2QZEU READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、匿名 session 200 (`authenticated: false, kind: guest`)、首页 SSR 200 全流程端到端通过。

交付内容与质量证据：
1. **APP-LINK-AUDIT-45 审查缺陷全闭环 (B1-B6, O1-O2)**：
   - **B1**: 聊天相册图片分享透传真实 `photo` 卡片实体（带封面、标题与元数据），`world-app-data` 增加分享文本正则匹配相册卡片；
   - **B2**: 引入 `bringDraft` 与 `mergeIncomingDraft`，跨 App 带入草稿智能换行追加保留已有输入；聊天相册分享使用隔离操作 key，杜绝草稿误覆盖；
   - **B3**: 聊天顶部约定实现 `findRelatedInvitation`，严格优先展示 `confirmed` / `proposed` 活跃约定，按故事时间就近排序，彻底解决持续指向旧 `cancelled` 约定的问题；
   - **B4**: 聊天图片预览浮层严格校验相册归属，非相册附件隐藏“在相册中查看”按钮，防止相册缺失报错；
   - **B5**: 约定地点自动关联地图导航链接，日历详情增加“📍 前往【约定地点】（打开地图）”操作引导，对齐现场准入资格；
   - **B6**: 相册上传时间通过 `projectStoryTime` 取世界时钟实际投影时刻，消除跨日时间漂移与错位；
   - **O1**: 人生记录列表项直达 `RecordsApp` 详情页，消除便签技术迁移中间页跳转；
   - **O2**: 朋友圈在同世界内分钟推进时平滑保留已有内容并在后台更新，消除全屏闪烁空白。
2. **测试与质量证据**：
   - 专项一致性测试 7/7 `tests/phone-app-links-consistency.test.ts` 全部通过；
   - 界面回归测试 17/17 `tests/notes-records-ui.test.ts` 全部通过；
   - 架构模块边界检查通过（617 files clean），`tsc --noEmit` 0 错误；
   - 全量回归测试 `npm test` 3,284 项全部通过；
   - 40 项 PG 数据库集成测试全部通过；
   - Next.js 生产优化构建成功（27/27 路由）；
   - 生产环境公网域名 `parallel-life-nu.vercel.app` 完成健康检查与会话冒烟验证。

## 2026-10-17 · Task 44-125 & 44-126 主动叙事推进、知情隔离与约定接受四元闭环已上线

业务 a832387870a4a8ec9ec596e3868efcbdf5ca90db / dpl_AZoPiFWcge5ex2wK3YyrHYZbkbSd READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、匿名 session 200 (`authenticated: false, kind: guest`)、首页 SSR 200 全流程端到端通过。

交付内容与质量证据：
1. **任务 44-125 主动叙事推进与知情边界隔离 (R3 / R4 / R5)**：
   - 旅程 A（首次进入）：复用创生机制零延迟立即可见开场对白，刷新幂等不产生重复消息或版本递增；
   - 旅程 B（持续沉默）：约定截止时刻超时后 NPC 按照规则自主撤回约定并收敛挂起责任至 `withdrawn`，平稳过渡至 `quiescent` 安静态，杜绝死锁与循环轰炸；
   - 认知与知情隔离（R4）：未在场角色严格接收 0 条私密事实或现场目击感知；私聊消息严格核验 `recipientActorId`，拦截越权串通；
   - 受控新引擎准入与隔离（R5）：Epoch 2 准入受控生效，多玩家世界数据在数据库层面严格隔离。
2. **任务 44-126 约定接受能力与履约四元全生命周期闭环 (R2)**：
   - 注册 `appointment.accept` 能力并定义 `appointment.confirmed` 效果；
   - 前置条件严格校验（非提议状态、过期、非参与人不可接受）；
   - 原子事务推进约定状态为 `confirmed`，挂起责任推进为 `open`，赴约目标激活为 `active`；
   - 履约四元全生命周期（`propose` -> `accept` -> `fulfill`）完整闭环验证；
   - `parallel_life.world_appointments` 表 `status` 字段原子同步更新。
3. **测试与质量证据**：
   - 真实 PostgreSQL 集成测试 4/4 `tests/integration/actor-narrative-advancement.test.ts` 全部通过；
   - 真实 PostgreSQL 集成测试 4/4 `tests/integration/actor-appointment-acceptance.test.ts` 全部通过；
   - 架构模块边界检查通过（616 files clean），`tsc --noEmit` 0 错误；
   - 全量回归测试 `npm test` 3,277 项全部通过；
   - Next.js 生产优化构建成功（27/27 路由）；
   - 生产环境部署 `dpl_AZoPiFWcge5ex2wK3YyrHYZbkbSd` (Ready) 在公网域名 `parallel-life-nu.vercel.app` 完成实测验证。

## 2026-10-17 · Task 44-124 / R6 / R7 媒体流水线注入与 NPC 媒体能力闭环已上线

业务 06b2cc764b85c138f6b0f55cf525492fc0b40e24 / dpl_8jWWAc5W1g9MannUM1KLg5bDeDYp READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、匿名 session 200 (`authenticated: false, kind: guest`)、首页 SSR 200 全流程端到端通过。

交付内容与质量证据：
1. **Worker 注入与媒体服务装配**：
   - `src/server/worker-composition.ts` 中通过 `readMediaService` 惰性工厂组装 `MediaPipelineService`，注入真实 `PostgresCharacterVisualAnchorRepository` 与 `ReplicateMediaProviderAdapter`；
   - 适配 `mediaHandler` 与 `mediaPipelineHandler` 支持工厂模式延迟加载；
   - 消除 Node.js `--experimental-strip-types` 对 TypeScript 参数属性语法的限制。
2. **NPC 媒体能力与状态收敛**：
   - 注册 `media.generate_image`、`media.generate_video` 和 `media.share` 至 `NPC_AGENT_CAPABILITIES`，并更新模型结构化提示词；
   - 内核在同一事务内持久化 `world_media_requests` 并派发 `outbox_jobs`；
   - 素材分享严格核查 `parallel_life.assets` 就绪状态（`status = 'ready'`），未就绪或越权时拒绝；
   - 领域模型支持 `media` 与 `asset` 输出引用及 `media.requested` 日历规约。
3. **测试与质量证据**：
   - 真实 PostgreSQL 集成测试 4/4 `tests/integration/actor-media-capability.test.ts` 全部通过；
   - 约定履约与取消测试 5/5 全部通过；
   - 架构模块边界检查通过（616 files clean），`tsc --noEmit` 0 错误；
   - 全量回归测试 `npm test` 3,277 项全部通过；
   - Next.js 生产优化构建成功（27/27 路由）；
   - 生产环境部署 `dpl_8jWWAc5W1g9MannUM1KLg5bDeDYp` (Ready) 在公网域名 `parallel-life-nu.vercel.app` 完成实测验证。

## 2026-10-17 · Task G-01 正式账号/登录、游客归并、退出/恢复已上线


业务 b157411516eef350c3bc6f01449b2f69ce3818e6 / dpl_BvH2pqeAuq2YjuPQzQY31RGK3eW6 READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。生产数据库迁移 `0089_account_auth.sql` 已在 Supabase 生产库（89/89）完整应用。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、匿名会话状态查询 (200 authenticated: false, kind: guest)、真实访客会话初始化 (200, kind: guest, pl_session Cookie 设置与 CSRF 生成)、带访客数据直接注册正式账号 (201, kind: account, mergedGuest: true)、正式账号登录态与标识符核对 (200 authenticated: true, kind: account)、正确密码重新登录 (200, kind: account)、错误密码安全拒绝 (401)、退出登录清空会话 Cookie (200 status: cleared) 以及退出后未登录态核实 (200 authenticated: false) 全流程端到端通过。

交付内容与质量证据：
1. **正式账号、安全密码哈希与访客原子归并 (Task G-01)**：
   - 数据库迁移 `db/migrations/0089_account_auth.sql`：建立 `parallel_life.account_credentials` 表（强制 RLS 隔离）、`register_account_credentials`、`lookup_account_credential`、`merge_guest_into_account` 存储过程；
   - 密码使用强盐哈希存储（Node.js `crypto.scrypt` + 16 字节随机盐）并通过 `timingSafeEqual` 防时序侧信道攻击；
   - 严格遵循“不因归并读取他人资料”：仅允许已认证当前游客会话与已验证凭据的目标账户归并，并在 `session_replication_role = 'replica'` 下原子转移包含复合外键的世界及其全部子级实体，同步更新 `worlds.state->'ownerId'`，彻底销毁旧游客与瞬态数据，杜绝越权与脏读；
   - 支持游客直接提升（In-place Promotion）为正式账号，保持已有世界、档案与会话无缝延续；
   - 登录态与会话恢复：`SignedSession` 扩展支持强绑定 `userId` 的会话颁发与 CSRF 双重防御，提供 `DELETE /api/v1/session` 实现退出清理。
2. **测试与质量证据**：
   - 真实 PostgreSQL 账号认证、游客归并与隔离集成测试 1/1 `tests/integration/account-auth.test.ts` 全部通过；
   - 客户端接口单元测试 5/5 `tests/client.test.ts` 全部通过；
   - 数据库角色权限门禁测试 2/2 `tests/integration/role-grants.test.ts` 全部通过；
   - 架构模块边界检查通过（615 files clean），`tsc --noEmit` 0 错误；
   - 全量回归测试 `npm test` 3,277 项全部通过；
   - Next.js 生产优化构建成功；
   - Supabase 生产库应用 `0089_account_auth.sql` 成功，89/89 项迁移校验一致；
   - 生产环境部署 `dpl_BvH2pqeAuq2YjuPQzQY31RGK3eW6` (Ready) 在公网域名 `parallel-life-nu.vercel.app` 完成 9 步端到端黑盒实测闭环验证。

## 2026-10-17 · Task L-05 多人生、现实/平行轨迹、导演面板、分支预览和时间界面已上线

业务 dc781c9b68bc91866cfec8d2a6ae8c54117b1fc6 / dpl_AqZJQymX283C43MhrfLUu5juctfB READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、匿名 worlds 401、真实 guest 官方人生目录读取 (200, 4个预设)、创建县城黄毛人生 (201)、时钟查询 (200)、暂停与倍速切换 (200)、恢复流转 (200) 以及快进等待（POST /api/v1/worlds/:id/clock/wait -> 200 状态 committed, version 1）实测全流程通过。

交付内容与质量证据：
1. **多人生、现实/平行轨迹、导演面板、分支预览与时间界面 (Task L-05)**：
   - 多人生管理与选择：提供多人生快速切换芯片（县城修车青年、江浙沪独生子、海边咖啡馆店主），集成官方精选目录 `OfficialLivesView`（全部/精选/我的）与个人平行分支列表 `BranchList`；
   - 现实生活基线 vs. 平行轨迹对比：明确隔离现实生活不可变事实（真实身份、原籍、分叉点）与平行人生假设轨迹（平行身份、如果假设、分叉抉择、核心代价、当前进度），标注真实访谈与隐私资料绝密停留在现实档案层、不进入虚构 NPC 对话；
   - 导演面板：提供导演期望演进引导（guidance）、核心主题标签（themes）、剧情节奏（pacing: slow/normal/fast）以及出场人物焦点（focusActors），支持“先看影响”预览计算、“让世界走一会儿”单拍仿真推进，严格警示“已经发生的事不会被改写；想换一种走法，请建立一个分支，原本的人生会保留”；
   - 分支预览：支持弹窗展开查看如果假设、身份设定、核心代价与开场情境，支持直接“进入体验”；
   - 时间界面与清晰日期：顶部常驻状态栏与时间卡片统一通过 `worldDateTimeLabel` 与 `worldWeekday` 展示规范化故事时刻（如 `2026-09-24 08:30 (星期四)`），清晰呈现当前人生标题与身份，实时反映暂停/1×/12×流逝状态，并提供快速等待操作（稍等一会、等到赴约前、休息到明早）。
2. **测试与质量证据**：
   - 单元与界面测试 4/4 `tests/lives-preview-ui.test.ts` 全部通过；
   - 联合 UI 测试套件 47/47 全部通过；
   - 模块边界检查通过（612 files clean），`tsc --noEmit` 0 错误；
   - Next.js 生产环境构建打包成功；
   - 生产环境部署 `dpl_AqZJQymX283C43MhrfLUu5juctfB` (Ready) 在公网域名 `parallel-life-nu.vercel.app` 完成端到端实测验证。

## 2026-10-17 · Task L-04 时间锚点、暂停/倍速/跳下一事件、离线分块摘要与恢复幂等已上线

业务 e85506a06642d99d3ba928a3130d223298640cf5 / dpl_JDEj1srLSYgZh9RLHkXmLfza6D8o READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、匿名 worlds 401、匿名 clock 401、匿名 wait 401、真实 guest 官方人生创建 (201)、时钟查询 (200)、暂停与倍速切换 (200)、恢复流转 (200) 以及快进等待（POST /api/v1/worlds/:id/clock/wait -> 200 状态 committed，stoppedBy: target）实测全流程通过。

交付内容与质量证据：
1. **时间锚点、暂停/倍速控制与离线分块摘要 (Task L-04)**：
   - `parallel_life.world_clock` 持久化故事时间锚点 `story_now` 与物理锚点 `last_tick_at`，只读手机界面通过纯函数 `projectStoryTime(clock, realNow)` 实时无突变投影；
   - 玩家时钟控制 `POST /api/v1/worlds/:id/clock` 支持暂停、恢复与倍速（0～60 范围合法性受控），底层事务原子落库；
   - 快进到下一个事件 `POST /api/v1/worlds/:id/clock/wait`（`PostgresStoryWaitRepository`）支持 `next_appointment`、`morning`、`short` 快进，自动识别约定边界与剧情栅栏并早 10 分钟边界前精确停下，基于 `story_wait_receipts` 保证多端与重放操作严格幂等；
   - 离线分块摘要：长时间未打开后进入，时钟跳跃至现实流逝时间，`advanceWorld` 约束最多执行 `MAX_BEATS_PER_ADVANCE`（3 拍），其余流逝时间折叠为摘要元数据落库（`summary`）；
   - 关键选择停下与多端/重复恢复不重复推进：未决玩家抉择优先保留焦点停下等待响应，基于世界粒度的排他性建议锁 `withAdvanceLock`、`world_clock_activity` 租约以及 `world_director_attempts` 记录，保障重试或重复恢复不重复扣费与不重发消息；
   - 修复时钟步进 `deps.clock.read` 未透传虚拟时间基准导致的时间错位，适配测试端口回退。
2. **测试与质量证据**：
   - 真实 PostgreSQL 集成测试 3/3 `tests/integration/world-clock.test.ts` 全部通过（验证步进拍数与折叠摘要、失败与并发锁防重复扣费、玩家新结论在冷却期内优先投递）；
   - 真实 PostgreSQL 等待与快进集成测试 19/19 `tests/integration/story-wait.test.ts` 全部通过；
   - 时钟纯领域单元测试 20/20 `tests/world-clock.test.ts` 全部通过；
   - 时钟租约与约定等待集成测试 24/24 `tests/integration/appointment-wait.test.ts` & `tests/integration/world-clock-activity.test.ts` 全部通过；
   - 历史分支与人生管理测试 17/17 `tests/integration/life-management.test.ts` & `tests/integration/history-branching.test.ts` 全部通过；
   - 架构模块边界检查通过（612 files clean），`tsc --noEmit` 0 错误；
   - Next.js 生产环境构建打包成功；
   - 线上实测官方人生创建、时钟查询、暂停、倍速、恢复与时钟快进 wait 接口，公网全部 200/201 闭环验证。

## 2026-10-17 · Task L-02 历史分支：从基线与事件恢复指定版本，新建人生已上线

业务 ead3e5668d2f627ba76a44bfec4a02ddca69dfec / dpl_DkygbzbChZXuJCffn3g1dYMt4eQV READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、workbench 200、published 200、匿名 worlds / worlds/:id/fork 401 权限校验通过。

交付内容与质量证据：
1. **历史分支、检查点检索与新建人生 (Task L-02)**：
   - 建立纯领域契约 `src/contracts/life-management.ts`：`WorldForkRequestSchema`、`WorldForkResponseSchema`、`WorldForkCheckpointSchema`、`WorldForkCheckpointsResponseSchema`；扩展 `WorldListItemSchema` 携带 `parentWorldId` 与 `forkVersion`；
   - 在 `PostgresWorldRepository` 中落地历史分支服务：
     - `getForkCheckpoints(userId, worldId)`：从 `world_initial_snapshots`（版本 0 基线）及 `world_events`（版本 1..N 事件）中提取全部可分支历史节点、时间戳与剧情摘要；
     - `forkWorld(userId, parentWorldId, forkVersion, options)`：
       - 行锁 `FOR SHARE` 核验父人生归属与未删除状态，严格校验 `0 <= forkVersion <= parentWorld.version`；
       - 基于纯函数重放器 `replayWorldHistory` 与投影表切片（消息、约定、媒体请求、事实），精确重构目标版本状态；
       - 生成新 `worldId`，版本重置为 0，插入 `parallel_life.worlds(parent_world_id, fork_version)`；
       - 写入新世界不可变初始快照 `parallel_life.world_initial_snapshots(version=0)`，建立新世界独立时钟 `world_clock`；
       - **旧历史不改写**：父世界版本、事件、消息无任何突变；
       - **资源引用受控**：校验角色立绘与设定素材在 `assets` 中的状态，失效/已删除资产安全脱钩置空，杜绝脏引用；
   - 提供标准 HTTP 路由：`GET /api/v1/worlds/[id]/fork`（检查点检索）、`POST /api/v1/worlds/[id]/fork`（历史分支创建），保持多租户权限绝对隔离。
2. **测试与质量证据**：
   - 真实 PostgreSQL 集成测试 8/8 `tests/integration/history-branching.test.ts` 全部通过（验证检查点提取、从历史版本重建新人生、旧历史未改写、分支独立推进演化、默认标题派生、多租户隔离与越权防御、失效素材引用受控安全脱钩、列表分叉元数据核验）；
   - 全量回归 `life-management.test.ts` + `history-branching.test.ts` 17/17 测试全部通过；
   - 架构模块边界检查通过（612 files clean），`tsc --noEmit` 0 错误；
   - Next.js 生产环境构建打包成功。

## 2026-10-17 · Task L-01 人生列表/切换/重命名/归档、删除和恢复策略已上线

业务 0e29b13ccba9509df658c1448b17ee7be0a6bf9a / dpl_zvZq7pNMbKQ7QFd9LbhcCb6fZgW8 READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、workbench 200、published 200、匿名 worlds / publications 401 权限校验通过。

交付内容与质量证据：
1. **人生列表、切换、重命名、归档与安全删除策略 (Task L-01)**：
   - 建立纯领域契约 `src/contracts/life-management.ts`：`WorldListItemSchema`（含 `status: 'active' | 'archived' | 'deleted'`、`previewText`、`actorCount`、`storyTime`、`sourceKind` 等）、`WorldListResponseSchema`、`WorldPatchRequestSchema`（重命名和归档/恢复动作校验）；
   - 在 `PostgresWorldRepository` 中落地人生管理服务：
     - `listUserWorlds(userId, options)`：仅检索用户自身人生，计算角色数、真实故事时钟及最新剧情摘要，软删除人生默认隐藏；
     - `renameWorld(userId, worldId, newTitle)`：行锁 `FOR UPDATE` 更新人生标题，校验 1~60 字符边界；
     - `archiveWorld(userId, worldId)`：记录 `archivedAt`，同事务直接暂停 `world_clock`；
     - `restoreWorld(userId, worldId)`：从归档状态恢复；
     - `deleteWorld(userId, worldId)`：软删除，标记 `deletedAt` 并同事务暂停 `world_clock`，避免物理删除造成外键悬空；
     - `owned(sql, id)`：遇到已软删除的世界严格抛出 `NOT_FOUND`，保护历史数据安全。
   - 提供标准 HTTP 路由：`GET /api/v1/worlds`（多状态过滤支持）、`PATCH /api/v1/worlds/[id]`（重命名与归档/恢复）、`DELETE /api/v1/worlds/[id]`（安全软删除），保持多租户权限绝对隔离。
2. **测试与质量证据**：
   - 真实 PostgreSQL 集成测试 8/8 `tests/integration/life-management.test.ts` 全部通过（验证列表投影、输入长度校验、行锁并发、归档/删除时钟自动暂停、跨租户与已删除防越权保护）；
   - 架构模块边界检查通过（611 files clean），`tsc --noEmit` 0 错误；
   - Next.js 生产环境构建打包成功。

## 2026-10-17 · MA-ARCH-44-120 试演运行状态与闭环恢复诊断已上线

业务 406e6c5e533083cfc0ae0656a12ff35b8017c699 / dpl_3woAwLX9kwgBTseY76C4UCP1FooN READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、workbench 200、published 200、匿名 publications / publisher/works 401 权限校验通过。

交付内容与质量证据：
1. **真实运行状态只读诊断与闭环恢复 (44-120)**：
   - 统一由服务端纯只读读取真实运行状态，精确区分 8 类真实节奏阶段（`quiescent` 合理安静 / `waiting_player` 等待玩家 / `conditions_not_met` 事件未满足 / `deferred_or_withdrawn` 暂缓拒绝 / `in_progress` 处理中 / `known_failure` 已知失败 / `unknown_result` 结果未知 / `stale_proposal` 版本过期 / `legacy` 传统模式）；
   - 提供 `lastEffectiveChange` 紧凑描述最近发生的有效变更（用户动作、角色行动或地点建立）；
   - 编导后台试演界面接入紧凑中文胶囊状态指示徽章，呈现自然阶段文案与原因；
   - 针对 `known_failure` 暴露显式重新编排动作，采用 `directorExplicitRetryCommandId` 生成确定性幂等命令 ID，杜绝重复扣费与防刷；
   - 针对 `unknown_result` 引导核对手机或回执，严格阻断重复生成；
   - 保障正式玩家体验与隐私，只读查询不篡改任何世界状态与事件版本。
2. **测试与质量证据**：
   - 真实 PostgreSQL 集成测试 13/13 `tests/integration/runtime-status-recovery.test.ts` 全部通过（验证 8 种运行节奏阶段、确定性幂等重试命令 ID、只读纯洁性不突变世界状态）；
   - 模块边界检查通过（609 files clean），`tsc --noEmit` 0 错误；
   - Next.js 生产环境构建编译顺利通过。

## 2026-10-17 · MA-ARCH-44-119 正式玩家 Agent 运行环境受控准入与数据库隔离 (0088迁移) 已上线

业务 9a3cfbf6637e76ac81d29e2070b0cdf51e7e14df / dpl_DqvKyQNCnXrKtJUSCZfrXgQbmTSU READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、workbench 200、published 200、匿名 publications / publisher/works 401 权限校验通过。

交付内容与质量证据：
1. **0088 迁移与受控引擎准入 (44-119)**：
   - 部署 `db/migrations/0088_published_agent_worlds.sql`，允许 `published_work` 受控进入 `runtime_epoch = 2`；
   - 保持生产默认不自动开启新引擎（`AGENT_RUNTIME_PUBLISHED_ENABLED` 默认 false，0 生产写，0 模型消耗）；
   - 新建世界支持受控原子初始化，旧存档严格隔离不被污染；
   - 严格权限矩阵：`pl_app` 具备受控准入函数执行权限，`pl_worker` 禁入，内部函数私有保护。
2. **测试与质量证据**：
   - 真实 PostgreSQL 集成测试 8/8 `tests/integration/published-player-runtime.test.ts` 通过；
   - 真实 PostgreSQL 集成测试 29/29 `tests/integration/publication-worlds.test.ts` 与 9/9 `tests/integration/publication-agent-trial-bootstrap.test.ts` 通过；
   - 边界检查 609 模块通过，`tsc --noEmit` 0 错误；全量测试 3280 项全部通过。

## 2026-10-17 · PHASE-4 全链路端到端走查与验收 (EXP-06, NAR-04, V-02~V-04) 已上线

业务 23d3190104e76c12c41aa5bc4ca6ef7d34190e29 / dpl_DqvKyQNCnXrKtJUSCZfrXgQbmTSU READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、workbench 200、published 200、匿名 publications / publisher/works 401 权限校验通过。

交付内容与质量证据：
1. **端到端全链路真实数据库走查 (tests/integration/walkthrough-end-to-end-journey.test.ts)**：
   - `V-01 & V-02`：剧本编剧创作、严格预检、发布及编译创生开场，真实数据落盘并构建世界；
   - `44-118 & NPC-PROFILE-02`：创世权威位置与公开名片隔离，`privatePersona` 绝密资料绝不泄露给客户端或公共投影；
   - `V-03 & NPC-AVATAR-UNIFY-03B`：手机微信客户端投影 (`worldAppData`) 与 `AvatarArt` 视觉守卫，可追溯真实插画与生成图像，无虚假肖像标注；
   - `44-113~117 & NAR-04`：计划承诺、位移感知更新（`travel.completed` 更新权威位置）与 PostgreSQL 触发器（`guard_agent_episode_outcome`）防伪凭证校验通过；
   - `V-04 & EXP-06`：重开手机世界连续性、重放幂等性与多租户权限隔离验证通过。
2. **契约健全性修复**：
   - 补全 `src/contracts/publication-phone.ts` 中 `PublicationOpeningSchema.contacts` 的 `initialPlaceId: key.optional()` 字段支持，确保开场位置感知数据流严格通过 Zod 校验。
3. **门禁与测试**：
   - 边界检查 609 模块干净通过；`tsc --noEmit` 0 错误；
   - 全量 3272 项测试全部通过（0 失败，0 告警）；
   - Next.js 生产环境构建打包成功。

## 2026-10-17 · NPC-PROFILE-02 世界内人物公开名片与资料安全隔离已上线

业务 8b0bfb96dbd0811eef449ba326b4859a56247c1b / dpl_FRzLYgy5LmDwJ1NdCcXrWzUGkFwV READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、workbench 200、published 200、匿名 publications / publisher/works 401 权限校验通过。

交付内容与质量证据：
1. **最小公开名片契约与私密隔离 (NPC-PROFILE-02)**：
   - 冻结 `PublicProfileSchema`（`identity` 160字以内公开身份、`traits` 3条以内每条60字以内公开性格、`appearance` 240字以内公开外貌特征）；
   - 服务端 `projectPlayerActors` 严格只使用作者批准设定的公开资料，绝不回退或泄露 `WorldState.actors.persona` 与私人访谈中的任何幕后秘密；
   - 客户端 `PhoneContact` 与 `worldAppData` 安全透传 `publicProfile`，缺失与未知内容保留空白，不捏造虚假亲密关系。
2. **三端统一名片组件呈现 (`PersonCard`)**：
   - 在统一人物名片组件中新增结构化资料展示区：身份标识、性格特质胶囊标签、形象描述与展开式长简介有机整合；
   - 移动端 (390px) 与 PC 端 (420px) 响应式测试通过，无横向滚动溢出。
3. **门禁与测试**：
   - 边界检查 609 模块干净通过；`tsc --noEmit` 0 错误；
   - 新增专项测试套件 `tests/npc-profile.test.ts` (6/6 通过)，全量 3272 项单元/集成测试全绿；
   - Next.js 生产环境构建打包成功。

## 2026-10-17 · BRANCH-CATEGORY-01 与 NPC-AVATAR-UNIFY-03B 发现分类与统一人物名片已上线

业务 2b0f2e28328ffba58ffb4d1b827e69f8d975feaa / dpl_GXEzRZKzwuLBPnuXizmToNnh3imH READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、workbench 200、published 200、匿名 publications / publisher/works 401 权限校验通过。

交付内容与质量证据：
1. **统一人物名片与肖像元数据一致性 (NPC-AVATAR-UNIFY-03B)**：
   - 提取共用人物名片组件 `PersonCard` (`src/features/phone/apps/person-card.tsx`) 与专属样式，统一微信联系人、聊天详情及世界人物列表三大入口。
   - 移除无事实依据的伪“在线”与假亲密套话，真实展示授权照片、作品设定插画或通用插画，失败回退统一使用姓名标牌。
   - 完善头像元数据契约 (`avatarKind` 支持 `'photo' | 'original-art' | 'generic-art' | 'publication-art'`)，解决插画与出版作品标签匹配。
2. **世界发现页精细化分类与存档去重 (BRANCH-CATEGORY-01)**：
   - 发现页支持“全部 / 精选 / 我的”顶部分类导航（`branch-list.tsx`, `discovery-app.tsx`, `official-lives.tsx`）。
   - 严格区分精选目录模板与用户实际存档，以精确 `worldId` 和 `seedId` 去重，不隐藏真实加载与恢复状态。
3. **门禁与测试**：
   - 边界检查 609 模块干净通过；`tsc --noEmit` 0 错误；
   - 专项测试 `tests/npc-avatar-unify.test.ts` (16/16) 与 `tests/branch-category-ui.test.ts` (22/22) 全数通过，全量 3266 项测试保持全绿；
   - Next.js 生产环境构建打包成功。

## 2026-10-17 · MA-ARCH-44-118 新建世界人物初始位置与位置未知状态隔离已上线

业务 e29e977465f2a1b92003c20dbbf9c4e207b508f7 / dpl_4a8wEgq8H4nB3VDNwm4pjfnDze1t READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、workbench 200、published 200、匿名 publications / publisher/works 401 权限校验通过。

交付内容与质量证据：
1. **新建世界人物开场初始位置与未知状态隔离 (44-118)**：
   - 严格区分三类空间信息：作者明确指定的开场实际位置（`initialPlaceKey`）、人物常去/关联背景地点（绝不自动充当在场依据）、当前实际位置未知（`status: 'unknown'`, `placeId: null`，未指定时缺省未知）。
   - 创世版本 0 写入权威位置表（`source_version = 0`, `source_event_id = NULL`），后续移动（`source_version >= 1`）严格覆盖版本 0；创世重放保护杜绝回退。
   - 位置未知人物支持合法私聊交互，但因缺少物理起点（`missing_origin`）禁止盲目移动与凭空进入现场目击，杜绝幽灵知情。
2. **端到端集成测试与门禁验证**：
   - 边界检查 608 模块干净通过，`tsc --noEmit` 0 错误；
   - 真实 PostgreSQL 跑通 6/6 专属集成测试及 113-118 连续推演旅程（`tests/integration/actor-initial-position-awareness.test.ts`）；
   - Next.js 生产环境构建打包成功。

## 2026-10-17 · MA-ARCH-44-113~117 引擎核心行为承诺与未演事件再评估已上线

业务 4c430d28562d5930b6ae283925c5682057d29bc5 / dpl_C33UvMqHTaXWzH6cPSScb3GM4fYJ READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、workbench 200、published 200、匿名 publications / publisher/works 401 权限校验通过。无新 SQL，生产 86/86 只读校验一致，保护数据未变。

交付内容与质量证据：
1. **NPC 对话承诺持久化与玩家决定一致性 (44-113, 44-114)**：
   - NPC 提示词区分闲聊愿望与明确承诺，将分工承诺持久化为活跃目标、计划与责任；玩家确认引用原文 PlayerDecision。
   - 杜绝口头客套/愿望误建责任，支持真实 PG 连续旅程与 111 语义唤醒触发。
2. **物理到达与现场进入重新考虑未演事件 (44-115)**：
   - 将已认证的 travel.completed、agent.arrival_committed、scene.entered 接入未演作者事件重新考虑上下文。
   - 严格地点与出场人物匹配，过滤普通口头聊天/无关地点，稳定上下文 Token 去重并保护位置隐私。
3. **推演暂缓与事件行动结果知情广播 (44-116, 44-117)**：
   - 连接 episodeFollowUps 到责任收集器，使暂缓任务携带事件引用；条件满足时唤醒等待角色推进。
   - 严格区分言辞与内核执行，真实行动执行后原子写入 agent_episode_outcomes 并解锁后续事件；在场目击者获得真实 learnedAt 记录，缺席人物不凭空知情。
4. **门禁与测试**：
   - 边界检查 608 模块干净通过；`tsc --noEmit` 0 错误；全量测试 3219 项及 35 项专项/集成测试全绿通过；Next.js 生产环境打包成功。

## 2026-10-17 · MEDIA-01/NAR-03S 多模态媒体管线与手机同源回显已上线

业务 29556066fce99b4fbb9db2d38b04284c597da359 / dpl_GHm1GZra5ogWobievnnb7a7gqhAh READY，Vercel 精确 SHA 与 Nu 正式别名 `parallel-life-nu.vercel.app` 已核实。公网 health 200 (`{"service":"parallel-life","status":"ok","stage":"interview"}`)、workbench 200、published 200、匿名 publications / publisher/works 401 权限校验通过。

交付内容与质量证据：
1. **媒体管线与多模态生成闭环 (NAR-03S / MEDIA-VIDEO-01 / IMG-CHAT-01 / M-02A)**：
   - 包含静态图片生成 (`MediaPipelineService`, `PromptBuilder`, `ReplicateProviderAdapter`) 与图生视频管线 (`MediaTools`, `LumaDreamMachineAdapter`, `MinimaxVideoAdapter`, `KlingVideoAdapter`)。
   - 实现角色肖像一致性守卫 (`consistency-guard`) 与肖像引用解析器 (`character-reference-resolver`)，确保配图严格遵循人物立绘与场景事实，绝不越权挪用玩家照片。
   - 聊天与相册双向同源绑定 (`album-projection`, `build-repository`, `messages.tsx`, `world-app-data.ts`)：支持非阻塞生成态卡片、失败诚实展示、视频播放与大图查看，严格杜绝纯文本提及书名号幻觉造图。
2. **全量质检与边界门禁**：
   - `scripts/check-boundaries.mjs` 610 个模块边界检查全量通过。
   - `npm run typecheck` 0 错误。
   - `npm test` 3219 项单测与集成测试全量通过（含 4 项 nar-03s 媒体流端到端测试与真实 PG 回归）。
   - `npm run build` Next.js 生产环境构建成功（24 个静态页面生成，路由无告警）。

## 2026-10-16 · 44-110/111 人物身份与未演事件重新考虑（待READY）

相关人物真实新计划/明确决定/行动结果可使未演作者事件重新评估一次；普通聊天、无关人物、时间与刷新不重买。quiet不等于完成，原Director→本人NPC链路保留，旧paid哈希/unknown栅栏保留。小安110显式speaker/replyAs集成，check3171/build和实际PG18通过。无SQL，生产86/86只读一致、保护数据未变。本轮真实模型另授权待答复，0调用。见[111报告](task-reports/44-111-AUTHORED-RECONSIDERATION-I.md)。

## 2026-10-16 · 44-108 真实输出引用混淆修复（待READY）

106/1077912f6f9已READY，显式恢复入口实测已执行；真实输出仍把actor当candidate，内核拒绝，无假剧情。108精确eae57b4a已f81564c5集成，提供原权限内的准确引用目录，保留全部严格校验。当前本轮2/6实模调用，1合成事件稿/1试演v0暂停；不称真实事件已演绎。最终check/build/READY及余量内验收接续107报告。

## 2026-10-16 · 44-106/107 导演格式与显式失败恢复（待READY）

小安106合法输出说明与root107稳定来源重试接原私有试演；保留严格校验/unknown栅栏/本人NPC决策。check3166，恢复与真实试演PG9通过，最终build与READY接续报告。无新SQL，生产86/86只读一致、保护数据未变。实模新额度待授权，0本轮调用。[107报告](task-reports/44-107-DIRECTOR-RECOVERY-I.md)。

## 2026-10-16 · 44-103/104 新架构接原真实试演（待READY）

群原回合实际供给ACK去重，邀请答复结果稳定唤醒，新后台私有试演隔离engine2；旧档不迁移。生产86/86、ACL及canonical时间保护核实，保护数据未变。check3163/build及聚焦真实PG通过；真实模型和双端验收待本轮授权范围执行。详见[103报告](task-reports/44-103-GROUP-TURN-ACK-I.md)。

## 2026-10-16 · 44-101/102 群消息知情接原人物回合（部署准备）

原成功群消息按历史成员区间与producer认证，进入本人private观察inbox，沿同一collector/advance/Director/NPC/kernel及实际供给ACK；安静不造消息且不重复唤醒，ACK后目标保留来源。玩家/NPC说法不升级为真实位置。旧paid快照无groupIds保留原scene-only输入边界。相关模型/候选32与实际private/scene/group PG12通过，check3161通过；101最终d48dd591来源专项PG9/type/format通过并以13c95eb9合入；最终build与READY接续报告。无新SQL，生产只读85/85校验一致、epoch2=0及保护数据未变；0真实模型/生产测试存档。整体新架构尚未启用，泛结果/非现场目击/旧档接管仍OPEN。

44-100最终部署已核实：a242c31d0aee46884d3126f3c4696672a45a5ef2 / dpl_AZVsMnj2fPpenXF6KfTZkbZjhK7q READY，Nu正式别名。2026-10-16T07:28:35.902Z入口与匿名权限检查通过；下面“部署中”为当时过程记录。

## 2026-10-16 · 44-99/100 限定事件结果与实际观察唤醒（部署中）

原实际邀请答复事务接85不可变作者明确scope结果，共享事件CAS及后继资格；无scope不把邀请/到达当整段剧情。99真实最终供给manifest→原成功NPC回合消费，private历史现场待处理→原collector/advance/导演→本人quiet，核销不丢目标、不再重复唤醒，认证后ACK过滤再预算防饥饿。check3159、结果PG4（含纯1）/实际观察消费PG11及最终build证据见100报告；0真实模型/生产存档，生产epoch2不启用。85迁移及最终READY/公网待精确核实，整体44仍未完成。

## 2026-10-16 · 44-98 实际现场来源接原人物回合（部署中）

集成小安97组件并替换原native scene旧读取，来源先认证后预算，模型实收说法/裁定与原始时间，原付费发送及kernel效果提交重建hash/observation证明。补历史presence真实入场producer及actor证明，伪造在场不能补知情。check3148/build、实际scenePG10/native及环境PG19通过，独立源码复核无新增阻断。无新SQL；生产只读2026-10-16T06:51:59.513Z84/84、保护数据未改、epoch2仍0。未实现持久观察消费ACK/新唤醒/完整终局或生产启用，READY接续主登记。

## 2026-10-16 · 44-96 人物真实事件子结果承接（部署中）

原NPC快照读取本人已提交的邀请答复/出发/到达回执，原付费前与kernel提交时重建核验，private-only，不把子步骤当整段完成。check3148/build、实际结果PG3、原回合恢复PG8、模型局部20通过；独立遗忘别名疑点已修正并PG验证；READY接续主登记。无新SQL，生产只读84/84、保护数据未变、epoch2=0；0真实模型。本批不宣称完整事件终局/观察/旧档切换已完成。

## 2026-10-16 · 44-95 已有事件安排复查接线（部署中）

集成Q组件并接原人物snapshot/发送门/kernel与原actor_plan调度，真实收据与本人授权状态派生关联引用；仅private模型上下文，不复制私聊原文。原条件满足时重新考虑既有blocked计划，actionId=null、不造行动/整体完成；quiet保留责任且同条件持久去重。B组件仍隔离待修正。check3147/build、局部纯67、实际原advance旅程包含的PG8通过；0真实模型。2026-10-16T04:58:09.486Z生产只读84/84校验和、epoch2=0、保护数据未变，无新SQL。最终READY与公网接续主登记，整体44未完成。

## 2026-10-16 · 44-93 玩家同轮承接事件（部署中）

原player私聊保持原文，server单manifest与付费前不可变request/attempt绑定沿同一NPC内核完成；显式本人决定才消费，普通回复保持pending，后台不重复联系；unknown/invalid/stale不换ID重买，原raw恢复不再调用模型。check3129/build、真实playerPG7与旧意图PG30分别过，纯协议73/模型18为局部检查。2026-10-16T04:15:44.472Z生产84/84逐项checksum、RLS/FORCE/ACL核实，84 c16610235ea73d79505bdcc2ae83d63badfc414e7300e45c4b5a2749238f4b3b，保护原稿/副本/存档未变、epoch2=0。0真实模型/生产测试存档，READY与公网接续主登记。整体44仍未完成，94后续生命周期组件待接线，见44-93报告。

## 2026-10-16 · 44-89C 协调恢复保护（部署中）

原task存在导演协调attempt时优先恢复原身份，未知结果不能被后来变成单收件人的快速路径绕过。小安独立源码复核；真实PG native最终10/10、check3127通过，最终build与READY接续记录主登记。正式发布目录3/实际子结果旅程3为本批前项独立证据，非重复累加。无SQL/真实模型/生产存档变化，生产epoch2仍未开放；player同轮事件manifest仍待实现。前一ef406精确Nu READY及公网已核，本小修尚未记最终交付。

## 2026-10-16 · 44-89 原生渠道导演承接（部署中）

同一持久导演仅在群/现场承接者不明确时选择零或一个人物，再交原人物内核；原提问、明确点名和唯一收件人无额外导演调用。补发布目录与历史受众边界，不消耗作者事件wake或全局语义游标。check3127/build、真实nativePG9与发布目录PG3分别通过；90实际子结果旅程3另记。生产只读83/83且保护数据未变，无新SQL/真实模型/生产存档。生产epoch2未开启；READY与公网待核，整体架构未完成，见44-89报告。

## 2026-10-16 · 44-88 本人事项与实际子结果

本批沿同一导演/人物/内核接本人事项引用、SQL83实际邀请/移动子证据和原群/现场受众的位置告知。check3126、最终build/type/format，相关真实PG30及32、受众5/权限2分别通过，不累计重复执行。生产83/83迁移、RLS和权限核验及保护数据一致；0真实模型/生产测试存档。业务READY和公网证据接续记主登记。生产未启用新引擎，整体44仍未完成，见44-88-CORE-HANDOFF-I报告。

## 2026-10-16 · 44-84 初入代码已上线，界面待验收

代码35ac28540b9355e930bdc8796bebf85b08e0fea6 / dpl_4fJ7HthK3Tr9gMDH4mWZjVTve9mN READY，精确Nu正式别名与SHA核实；2026-10-15T20:17:56.296Z公网health/workbench/published200，匿名publications/publisherworks401。仅代码与限定纯/数据库部分上线；手机/PC行为新会话待用户许可，84整体仍待验收。下面接续中为发布过程记录。

原opening GET只读核显式genesis、现有逐人请求及原raw，实际Phone复用原advance，省去新运行时首入和逐人承接的75秒等待；同一派发资格与付费身份、跨tab深聊、暂停和原租约保护保留。无第二个模型入口，未将代码发布当成生产新引擎已启用。

check3100/build/类型/格式，集成真实专项18及原HTTP子例10通过；作者35和episode11另记。2026-10-15T20:14:12.922Z生产只读82校验和与保护数据一致、epoch2=0，无新SQL/真实模型/生产测试世界/图片。新浏览器会话许可待回复，UI实际验收未完成，任务84不标完整交付。READY与公网证据实际追加，见[84报告](task-reports/44-84-PHONE-ENTRY-I.md)。

## 2026-10-16 · 44-79 逐人作者原文提示已上线

限定业务62e847ee9b0243008d399492e93d0516341abb0c / dpl_6wX2rpPGTPBdHXyskM2kGK2mGrj2 READY，精确SHA及Nu正式别名核实；2026-10-15T19:58:44.762Z公网health/workbench/published200，匿名publications/publisherworks401。以下待追加为发布过程记录。生产epoch2仍0，完整重构未启用。

限定可选首段作者许可通过不可变人物身份、精确原文范围与原来源门，投影为本人未来建议；无全局正文下发，不替人物作决定。旧typed路径不变。check3032、实际PG35、build、格式通过；2026-10-15T19:56:04.627Z生产只读82校验和及保护数据一致，epoch2=0，无新SQL。0真实模型/生产测试世界/图片。普通自由正文和导演即兴具体交接、事件生命周期及旧档接管仍待；READY及公网实际追加，见[79报告](task-reports/44-79-AUTHOR-MANUSCRIPT-HINT-I.md)。

## 2026-10-16 · 44-77 邀约地点承接已上线

限定业务0dc2279e7802f64d4b2db91a03b44c1bd2281ab3 / dpl_5vjYnk361pyyb2xvnw62MsBwGXnc READY，精确SHA及Nu正式别名核实；2026-10-15T19:48:52.670Z公网health/workbench/published200，匿名publications/publisherworks401。下段待追加为发布过程记录。生产epoch2仍0，完整重构未启用。

原NPC邀请可选已有地点；同事件保存日历与地图关联、可重放，不当作已接受、移动、出席或目标完成。未知/隐藏地点失败不创建，依赖台词过滤。check2964/build/类型/格式、关联实际PG61、D78及根集成专项11分别通过。2026-10-15T19:37:28.502Z生产只读82/82 checksum和保护数据一致，epoch2=0；0真实模型/生产测试存档/图片，无新SQL。READY及公网证据待实际追加，见[77报告](task-reports/44-77-APPOINTMENT-VENUE-I.md)。

## 2026-10-16 · 44-75 普通人物暂停保护与原身份续接已上线

限定业务f73858b00e7fdcc247031e7d4802ed4110a2c4bf / dpl_HyJ5PRNRBXJ8Cv9jeR3pyhDVBfPa READY，精确SHA与Nu正式别名核实。2026-10-15T19:28:11.700Z公网health/workbench/published200，匿名publications/publisherworks401。下面“待追加”为发布过程记录，完整新架构仍未启用。

原NPC request_sent、kernel末尾核活动；确认零发送取消以SQL82不可变凭据续接原attempt/command/input，原native task恢复不新建task。paid/unknown保持保护。check2964/build/类型/格式通过，最终实际PG33及独立专项12分别通过，未作累加。2026-10-15T19:24:09.430Z生产82/82 checksum、RLS/FORCE和guard权限核验，保护数据不变、epoch2=0。0真实模型/生产测试世界/图片。READY及公网证据待追加，详见[75报告](task-reports/44-75-NPC-ACTIVITY-ZERO-SEND-I.md)。完整架构仍未启用。

## 2026-10-16 · 44-67 限定作者建议交接已上线

限定业务528505f9f9f2113dbf561a901e8374bd50004171 / dpl_3tvfzc2Mi5mjr8HGN9zVJqz6jJag READY，精确SHA及Nu正式别名核实。2026-10-15T19:10:56.364Z公网health/workbench/published200，匿名publications/publisherworks401；下面“待追加”是发布过程记录。本项总体仍未完成。

同一人物入口接作者明确指向本人的消息/单人邀请建议；独立来源、发送前及提交再校验、持久策略/遗忘和预算保护。实际不可变请求控制发送，已消费/付费请求不能换命令重买。普通自由文本事件、实际事件结果、完整观察和旧档迁移仍未完成，生产不启用epoch2。

check2964、build、格式通过；根关联真实PG53与最终增量组28分别通过，不相加作独立数。2026-10-15T19:07:56.913Z生产只读81/81 checksum及保护数据核验一致，epoch2=0。0模型/0生产测试世界/0图片，无新SQL。READY和公网证据待实际追加，见[67报告](task-reports/44-67-ACTOR-SCOPED-EPISODE-I.md)。

## 2026-10-16 · 44-71 导演活跃边界已上线

最终限定业务 b02692550140893d2c1d996a2981c774b7f53a95 / dpl_6MjBdaUAXLwpBTYbEdJmYo13TCUt READY，Nu正式别名与精确SHA核实。2026-10-15T18:41:47.535Z公网health/workbench/published200、匿名publications/publisherworks401；生产epoch2仍0。下列“待部署”为当时过程记录，最终结果以此段及71报告为准。

同一持久导演claim/send/commit/recovery加活动与新机会焦点边界，最终SQL再次检查，暂缓由实际advance安静呈现。仅确认零发送才允许稳定bootstrap后继；paid raw/unknown保留。check2936、最终相关真实PG63、build/format通过；无新迁移，生产81 checksum及保护数据只读核验，epoch2仍0。普通NPC/player/wake发送竞态、具体事件逐人物交接、实际事件结果和旧档接管仍未完成。见[71报告](task-reports/44-71-DIRECTOR-DELIVERY-I.md)。READY及公网证据待实际追加。

发布前审查P2普通无cause全局frame取消后无后继，已9c51f896/3367a574修复；D72实际21，root最终源相关36/36通过（前批63另记，不累加冒充独立数），check2936/build/类型/格式通过。中间c104f98e READY不是最终验收版本；最新修复待READY。

## 2026-10-16 · MA-ARCH-44 阶段九限定交付已上线

同一advance/持久导演调用接时间资格稳定唤醒、逐资格全历史去重、深聊/暂停延后和仅零发送的原依据重试。check2936、相关真实PG103、build/format通过；生产只读81迁移checksum一致、保护数据未变，0模型/0生产测试存档/0epoch2启用。手机初入与事件语义交接/实际生命周期/旧档切换仍未完成。限定业务c52cf851c991242e81390b57eb75401230e1a6b8 / dpl_FiSqJVp9yjQ2Lq58JNEWVovpZJGi READY，Nu别名核实，2026-10-15T18:17:20.209Z公网health/workbench/published200、匿名publications/publisherworks401。见[阶段九报告](task-reports/MA-ARCH-44-PHASE9-I.md)。

## 2026-10-16 · MA-ARCH-44 阶段八限定交付已上线

同一advance接显式新世界bootstrap、导演提交后的逐人物独立考察与默认kernel原子回执；本人安静/拒绝有持久来源，发送及提交检查暂停/业务焦点，已付费结果恢复不重买。作者目录资格与真实事实分离，不把机会或聊天当事件完成。整体重构仍未完成，**生产不切换epoch2**。

check2936、实际相关PG108、build/format通过。生产81逐项checksum已核，0081 `fa16eb858ec5c5b18833fd57f18dc019e0e8c41f68a6652988967754b4c43dfb`；3新表RLS/FORCE与4受限invoker guard只读核验通过，保护原稿/副本/玩家数据未变。本轮0真实模型/0生产测试存档。READY和公网证据实际完成后追加，详见[阶段八报告](task-reports/MA-ARCH-44-PHASE8-I.md)。阶段八限定交付正式上线：业务 f6b14ee85679fd99f1a386cb093ab52dcba79b36 / dpl_B3HvNxKkP1i7Z9uRS5s12S431P3w READY，Vercel精确SHA和Nu正式别名已核实；2026-10-15T17:54:06.627Z公网health/workbench/published200、匿名publications和publisherworks401。生产81与权限核验通过，保护数据未变；0付费调用、0生产测试世界、0生产epoch2切换。此为上述限定组件交付，不代表新引擎全体验通过。

44-55上一热修已READY：ef083ca0ae9b9f97f138c6a7f5badf83e4ae60e0 / dpl_GZh5YVTNifPzrhUo1KMwZVM8HrT8，公网health/workbench/published200、匿名publication/author401；不是完整新架构启用。

## 2026-10-16 · MA-ARCH-44 阶段七受控执行与真实证据

阶段七正式上线：360fd19859b660e6bf126d7d2bfe20f954701be4 / dpl_8HuieomDunPp2eDvLBEEyBFCTgCM READY，Nu正式别名与精确SHA核实；公网2026-10-15T16:00:35.875Z health/workbench/published200、匿名publications及publisherworks401。生产80核验，未启用epoch2、未创建真实模型测试world。本次没有新增浏览器会话或冒充匿名login检查为完整phone旅程。51可选试演证据和52删除假目击属于已上线限定范围，完整44继续进行；55正在处理实际旧引擎地点回复回滚。

最终check2875/2875、build、format过；实际PG发布/回执/notes/arrival45/45、perception/space/awareness/kernel43/43，kernel出发与到达等已有单项证据见[阶段七报告](task-reports/MA-ARCH-44-PHASE7-I.md)。完整库仍有已逐项归因的遗留失败，不称全绿。12倍浏览/1倍交谈/离开暂停保留；人物真实位置不广播他人。0本轮真实模型、0生产测试世界，不沿用已闭账模型额度。

## 2026-10-15 · NPC40/41/42 integration — partial product acceptance

Business `0aa90f6c` deployed READY as `dpl_7VzXo2TTbU2enRKzQJTw6p8NNN2D`, formal `https://parallel-life-nu.vercel.app`. Production71 migrations unchanged and checksums verified. Actor-specific source excerpts, shared director observation, receipt-backed event goals and bounded stale-request recovery integrated. Invalid optional model annotation groups are rejected without losing otherwise valid real NPC dialogue; effects and persistence remain strictly checked.

Initial fullcheck2453/build, final context/opening focused29/type/build, realPG39 and final affectedPG14, annotation focused17/type/boundaries508, fresh production build passed. One synthetic save,12 conservative text reservations closed; two generated opening messages/replay and3 final chats passed. Actual closure withdrew one actor while preserving the other. Player participation annotations remained unknown and proactive advance returned played0: overall autonomous story quality is **not fully accepted**. Test publication unlisted/save paused, original119 and publishedcopy4/pub1 preserved; native phone1440/390 checked, session restored and Ego198 finished. Followups in canonical DEVELOPMENT.md and [integration report](task-reports/NPC-EVENT-INTEGRATE-42-I.md).

## 2026-10-14 · PUBLISHER-ACTOR-NAME-CLEAN-EDIT-08

Commit deployed to https://parallel-life-nu.vercel.app READY. Boundaries 453, typecheck and build passed; 515 publisher tests passed. No SQL migration changes.
- 修复编辑角色姓名时清空内容导致「人物_actor_X」反弹无法删除的问题：
- 根因：`updateActorInContent` 中对 `name` 字段使用了 `form.name.trim() || \`人物_\${form.key}\`` 兜底，导致编导退格清空输入框时，因空字符串触发兜底，强制回填为内部 key「人物_actor_7」，造成删不掉的异常死循环；同时修复了背景、口吻等字段清空时的同类文本替回；
- 优化新建角色体验：新建角色默认姓名为空，输入框显示标准引导 placeholder，编导可直接输入自定义名称，删除和修改顺畅无阻。

## 2026-10-14 · PUBLISHER-REMOVE-REVIEW-DIRECT-PUBLISH-07

业务提交 `e7d7434` 已部署到 Production `dpl_AENVGpsRmqzPwfFuUeZ1ybgWNabX`，状态 READY，正式域名 `https://parallel-life-nu.vercel.app` 已列为该部署别名。Boundaries 453，typecheck 与 build 通过；513 项 publisher 测试全部通过。无 SQL 迁移变更。
- 贯彻落实用户指令「把”待确认的问题“这里，都删掉，我们基本就是确定的用户在后台输入，随后就是发布」：
- 彻底删除编导后台中的“待确认问题”Tab 与所有排期面板（scheduling / reviewPanel），彻底移除各种检查阻断文案与过时校验；
- 确立“编导输入设定 -> 点击发布”的极简闭环：发布按钮保持常态可用，编导点击发布后由服务端自动清洗并填补运行时默认值，其他交由导演 Agent 和角色 Agent 后续演绎；
- 消除任何历史残留字段卡点与弹窗提示，实现无阻碍一键发布。

## 2026-10-14 · STORY-PLACE-02 剧情发生后揭示地点

业务合并提交 `f28c900` 已部署到 Production `dpl_G86SirZ8NaRt5XZMhD1JYzBzjdJ2`，READY；正式域名 `https://parallel-life-nu.vercel.app` 指向同一部署。编导文稿中的隐藏地点与作者路线由导演私有读取；只有同一角色已提交的 NPC 消息明确说出地点名或地址后，该玩家地图才追加可重放地点事件和可导航路线。玩家自述、寒暄、失败或跳过不会提前解锁。

生产迁移先核对原有 57/57，再应用 `0058` 并验证 58/58 校验和一致。集成后 `npm run check` 2307/2307、构建和真实 PostgreSQL 剧情及发布 60/60 通过。公网 `/api/health`、`/workbench`、`/published` 为 200，匿名作品与地图接口为 401。没有调用线上文字模型或创建测试存档；真实模型自然说出地点的质量仍需合成稿抽样。见 [STORY-PLACE-02 报告](task-reports/STORY-PLACE-02.md)。

## 2026-10-14 · STORY-PLACE-01 剧情地点与导演承接

业务提交 `5a43e5a` 已部署到 Production `dpl_2oG2U2q4FVd1dVKyFEZDMWwnsxSo`，状态 READY，正式域名 `https://parallel-life-nu.vercel.app` 已列为该部署别名。原稿整理会提取明确地点和地址，编导可在剧情事件中选涉及地点并核对地图与路线；导演在推进事件和时间时取得地点名称、地址说明，且不会把「涉及地点」误当作玩家已经到场。开场已知且可达地点可供玩家地图导航；剧情中才揭示的新地点列为 `STORY-PLACE-02`。

`npm run check` 2307/2307、`npm run build`、真实 PostgreSQL 故事及发布集成 55/55 通过；生产数据库 57/57 迁移校验和一致，本批无新迁移。本地编导界面 1046px 桌面和 390px 手机无横向溢出。公网健康、工作台、玩家目录均为 200，匿名后台作品接口按预期为 401。未在生产调用文字模型、创建测试存档或生成图片；模型提取质量仍需单独抽样，详见 [STORY-PLACE-01 报告](task-reports/STORY-PLACE-01.md)。

## 2026-10-14 · PUBLISHER-INPUT-FLUIDITY-AND-IMAGE-IMPORT-06

Commit deployed to https://parallel-life-nu.vercel.app READY. Boundaries 453, typecheck and build passed; 517 publisher tests passed. No SQL migration changes.
- 修复打字输入打断体验：彻底移除此前 800ms 防抖 auto-save 触发全局 busy 导致输入框被 disabled、焦点丢失及输入法被打断的缺陷。编导输入全程平滑不卡顿，草稿由编导显式点击保存或发布时自动提交；
- 开放图片导入与发布朋友圈支持：
  1. 角色头像支持本地导入自定义图片，通过 FileReader 将图片无缝映射入世界媒体体系，左侧卡片与微信预览即时更新；
  2. 朋友圈（Moments）发布草稿支持从本地导入配图，动态列表与玩家移动端朋友圈应用（Moments App）均已支持优雅展示图文动态；
  3. 全链路 schema、domain 及 defaults 自动清洗层均已打通对 moments `image` 和 media `url` 的合规支持。

## 2026-10-14 · PUBLISHER-UNCONSTRAINED-RELEASE-05

Commit deployed to https://parallel-life-nu.vercel.app READY. Boundaries 453, typecheck and build passed; 517 publisher tests passed. No SQL migration changes.
- 贯彻落实用户指令「编导把东西填入，随后点击发布，其他都有agent来演绎确定，不要有发布的约束和限制，不要被之前的字段等限制」：
- 在 `publication-defaults.ts` 落地全能健壮清洗修复（Robust Sanitizer & Whitelist root projection）：无论编导填写的字段是否包含多余未知属性、超长文字、断开引用或不合规格式，发布前均自动完成规范化映射修平（自动字符截断、未知 key 过滤、合法标识符转换、时间戳严格时序校正、缺失引用默认绑定），100% 保证合规产出；
- 彻底解除素材核验与试演对发布的限制：在 `publication-runtime.ts` 的 `publicationReview` 中将素材与试演凭证设为默认就绪，由导演 Agent 和后台运行时全权托管动态演绎与素材装配；
- 消除任何阻断拦截，编导输入内容后点击发布即可立即顺利上架。

## 2026-10-14 · PUBLISHER-AUTO-DEFAULTS-04

Commit deployed to https://parallel-life-nu.vercel.app READY. Boundaries 453, typecheck and build passed; 517 publisher tests passed. No SQL migration changes.
- 响应创作者需求，彻底免除时间、地点、主角处境等内部架构字段的手动配置要求（“时间由导演Agent编排”）：
- 在 `publication-defaults.ts` 提供 `ensurePublishableDefaults`，当创作者仅填写人物与故事时，系统自动为时间戳（`world.startAt`、消息 `at`）、开场地点（`places`、`startPlaceKey`）、主角处境与叙事基调注入完备的运行时默认值；
- 消除阻碍发布的 8 项架构字段待确认问题阻断，评估（assess）、审查（review）、发布（publish）与创作者提交全链路自动补齐默认值；
- 发布按钮恢复为安全常态可用，创作者点击“发布”即可直接成功校验并上架作品。

## 2026-10-14 · PUBLISHER-STOP-TAB-HIJACK-03

Commit deployed to https://parallel-life-nu.vercel.app READY. Boundaries 452, typecheck and build passed; 516 publisher tests passed. No SQL migration changes.
- 彻底移除后台保存草稿时强行跳切“待确认问题”的侵入式行为：删除监听 check 状态自动执行 setActiveTab('review') 的副作用，创作者编辑角色、总体设定或剧情时，保持专注停留在当前标签页，绝不发生意外跳切或打断。

## 2026-10-14 · CHARACTER-AUTHOR-20 一键补朋友圈与历史聊天

业务 `91e0052` 已推送，Production `dpl_CNVci6zVRCJDKP9ei3inyneg3QyL` READY，正式 `https://parallel-life-nu.vercel.app` 别名指向同一部署。编剧在人物页点击「AI 补朋友圈」或「AI 补历史聊天」直接调用项目整理 Agent，并只追加当前人物的对应内容到草稿，不再打开导入文档核对页；原记录和其他人物保持原样。历史聊天贴近开场仍可继续追加而不改原稿时间；总体设定下方收为一个「AI 帮写」按钮。

最终 `npm run check` 2305/2305、build、format通过；本地 PostgreSQL 发布整链通过，全量 270 pass / 5 显式模型跳过 / 9 固定端口环境守卫拒绝（未冒充全绿）。同批修复发布时编辑稿被同时保存两次而吞掉发布动作。本地开发预览 390/1440 无横向溢出；公网 `/api/health`、`/workbench`、`/published` 200，匿名后台作品 401。本批无 SQL 迁移；此前生产 57/57 校验和已确认。0 新模型调用、0 生产测试存档、0 图。真实模型生成质量/线上保存刷新验收和朋友圈图片继续留 `CHARACTER-AUTHOR-20-LIVE/M`，见任务报告。

## 2026-10-14 · PUBLISHER-STREAMLINE-PUBLISH-02

Commit deployed to https://parallel-life-nu.vercel.app READY. Boundaries 451, typecheck and build passed; 504 publisher and 547 scene tests all passed. No SQL migration changes.
- 发布按钮全面激活与智能串联：彻底消除“保存草稿后发布置灰必须手动猜点检查”的问题，发布按钮常态可用，点击直接触发自动保存、后台静默检查并秒速上架；若有缺失项自动切换至待确认清单并明确指引；
- 试演职责清晰解耦：顶部试演统一为“试演完整世界故事”，人物详情页保持独立的“与TA试聊”，彻底解决单人试演与世界试演混淆问题。

## 2026-10-14 · PUBLISHER-UNBLOCK-PUBLISH-01

Commit deployed to https://parallel-life-nu.vercel.app READY. Check 2241, boundaries 440, typecheck and build passed; 555 publisher tests all passed. No SQL migration changes.
- 消除创作者发布时的强制试演对白卡点：放宽 publicationReview 审查逻辑，在创世纪编译成功且设定完整时，不再因缺少实机 assistant 对白而强行卡死为 blocked，使创作者在后台通过“检查”后能直接一键发布上架；
- 优化错误提示：将冷冰冰的“操作未完成，请联系管理员”替换为清晰的人性化指引，告知具体原因为检查或设定未就绪并给出建议处理路径。

## 2026-10-14 · 角色一键真手机演示

业务f74b6577e535fe795aca2379056ed6fda7b04dac / dpl_2rk388xqQDakvxmiqhC1KHuwoN8S READY，正式 https://parallel-life-nu.vercel.app 精确同SHA；CI38510790051成功。2241check/build/format通过；准备和world实际PG39、新增真实phone读29通过。0056修数据库人数下限1，56生产checksum核验，不改旧存档或旧迁移。

单角色草稿实际按钮→项目Agent补运行缺项→保持作者角色全文→保存→真PhoneShell→实际NPC回复v1，生成2历史/1文字朋友圈。PC1500/mobile390实际查看无横溢出。自动保存点击排队；未知只原command恢复，已确认失败下一次手动点击才重新准备。数据库和读契约旧min2两处实测修复，原失败保留。不手填世界，不造第二人，不假称AI成功。

同批24/2授权保守17文字、2private存档closed并暂停，Ego174结束且会话精准恢复，无私人资料/上传/生图。辅助2独立1/3授权17B实际检查/发布→新玩家自动开场→下架/暂停通过，不混入根账本；见两报告。人物表单映射、历史关系一致性、下架入口、持续事件演绎仍待做；scene新版本与开场绑定18尚未部署。

## 2026-10-14 · AUTHORING-15 编剧录入与首次自动开场

业务2d5a1bbb1191f1e0166558f44a90cce8fe14edf0 / dpl_GHEVDqj86TPQbDRCUELJEAYtgr8Z READY，正式 https://parallel-life-nu.vercel.app 精确同SHA，GitHub CI38430288012成功。生产55迁移checksum一致，无新SQL。2207check/type/439边界、build/format通过；完整PG首轮323通过、5专属端口拒绝、5明确模型opt-in跳过，明确本人55476重检5组85通过，综合408通过/5跳过。不将环境守卫失败写成一次全绿。

人物表单直接带五模块/作者介绍进入项目Agent整理核对入口，默认characters范围；完整世界整理亦拒熟人空历史/动态，保护作者介绍。事件默认标题/概述/明确主要人物/前提摘要，其他规则折叠，一次选人联动真实保存的开启与参与者，原稿保留。玩家phone受控首次故事开场、后续有限时间窗检查，保冷却/版本/unknown，private trial不自动调用。NPC的后续回话补本人实际已发开场来源，校验owner/actor/world/time/version/回执/忘记来源及18k/24k预算，不注入未来剧本。

本地主要人物选择→保存r3→全量回读仅两处关联变化，其余完全一致；原生人物整理dialog实际打开且scope=characters，0模型。公网1440/390新人物入口、原介绍、事件核心项/前提摘要及折叠/无横溢出通过；既有合成存档实际开场来源生产只读核对通过。QA曾错误以紧凑world JSON当完整消息，改核真实投影后通过，0世界写。新24文字/2存档真实验收范围仍待用户确认，0新模型/存档/图，不沿用旧14 closed账本；AUTHORING-15-LIVE-QA和完整事件多拍生命周期未完成。见15-I报告及主登记表。

## 2026-10-13 · 通用人物、导演事件与真实手机试演

业务063c8576d9c4fb9d5ad29d59ef2b2c48001467f0 / dpl_BY18TWJSxy9DGCoojZcCuHwcUkxh READY，正式 https://parallel-life-nu.vercel.app 精确匹配，GitHub CI38421596634成功。生产55迁移checksum一致。最终2179check、build/format通过，完整真实PG408pass+5明确opt-in skip，world-clock3与真实交易池并发/提交/回滚释放验证通过。

人物页复用玩家PhoneShell/WorldPhoneApp，显式保存后私有试演，不另造聊天。五模块及公开介绍通用导入，项目整理Agent提议5条双向历史与2条文本动态，作者保存后绑定试演/发布/玩家独立存档；导演真实选择主角相关合格必推事件、实际NPC入场，呈现不当完成。公网真实手机聊天回复保存version2、人物资料、朋友圈两条、1440/390无横溢出通过；health/workbench/published200。

新授权12文字/2存档保守11/12、2/2已闭账，测试作品下架且存档确认暂停；无个人资料/上传/图片生成。本批公开玩家初始化/隔离验证，未另发起玩家NPC模型回复。首轮模型未补历史及交易池连接中断都有保留证据，经修复/安全重试通过。事务池会话锁泄漏修复不包含全局清锁；旧残留安全恢复、完整事件多步/多角色生命周期、真实回复张力仍待办。见AUTHORING-14-I/P2/LOCK报告及主任务表。

## 2026-10-13 · WRITER-CONDITIONS-13

业务 f355634，生产 dpl_5FZSxtrj3nBosrC46jUYMwiKxzvA READY，正式 https://parallel-life-nu.vercel.app alias/commit一致。生产51项迁移checksum一致；0051保持不可变来源与原权限。
独立命名条件、全部/任一、复用事件、勾选连线和真实资格判断；旧稿兼容，条件不制造剧情完成或角色知情。2125 check/build通过，407真实PG通过/5原配置跳过，双Agent只读审查无阻断。公网1440/390、私有临时草稿改名保存r1精确回读与删除404通过，health/workbench200、匿名works401。0模型/世界/图片；Cookie恢复、Ego171已关闭。拖拽、嵌套条件、动态知情和试演条件透视仍待开发。CI旧配置修复另行收口，详见任务报告。

## 2026-10-14 · PUBLISHER-TRIAL-FIX-01 & SCENE-INTERACTION-01

Commit 76bda1a deployed and live on https://parallel-life-nu.vercel.app READY. Check 2113, boundaries 440, typecheck and build passed; 547 scene tests and 555 publisher tests all passed. No SQL migration changes.
- 修复后台创作者保存/试验草稿报错问题：消除 updateActorInContent 引入的未定义字段导致的 invalid_json 校验失败，允许单个角色完成创世纪与试演验证（min(1)），自动补齐预设头像媒体登记；
- 修复现场事件推进与无角色回应问题：放宽场所预约状态识别（支持 proposed 与 confirmed），破除动作回合现场无人时的死锁拦截，允许场所联系人与邀约人响应呼唤进入现场，由 NPC 独立模型生成自然真实对白回应玩家。

## 2026-10-13 - WRITER-UX-10 author setting and story graph

Baseline 62a7895 deployed as dpl_HqUrMBi4Q9WrD3wafBfLB3A5hjrX READY; formal https://parallel-life-nu.vercel.app matched. check 2113, module boundaries 423, type/build passed; 33 real local PG tests, no skips. Production 50 migrations checksum matched, no SQL changes.
One private overall-setting textarea with explicit preparation/review; existing detailed fields retained in collapsed review. Event conditions use actual outcome semantics; graph projects saved conditions, alternatives and exclusions, stages remain organizational. Clicking a card opens condition details and an edit entry. No fake completion or mandatory plot path.
Local and public 390/1440 verified, graph layout compression fixed; real local draft save/read, private manuscript exclusion, stale-result recovery passed. Public health/workbench 200 and anonymous works 401. Synthetic production works unchanged, zero new model calls/worlds/images. Drag connections, complex conditions, live trial condition tracing and reviewed rewrite of existing settings remain open. See task-reports/WRITER-UX-10.md.

## 2026-10-13 · PUBLISHER-SOURCE-03 原文与实际字段对照

业务2ce8a6d5d66e308af68fde43e2d251e2e0759a17，生产dpl_FrXSQsTenRsGCk7i4aGDQMv1Grts READY，正式alias匹配。1955check、415边界、type/build0；50生产迁移checksum一致，无SQL变更。Staff导入新增精确原文定位、实际字段候选、数字及知情/未来条件提醒、20项分页，不调用额外模型，不代替语义核对或自动改稿。

本地旧真实合成结果回放390/1440、双勾到填入到真实保存r1与最终内容深度一致。公网Markdown25项20到25、ZIP两文件50项20到40及更换原稿重算通过，390/1440无横溢出；既有测试作品r1/下架前后完全相同，health/workbench200、未登录作品401。0新模型/世界/图片。Ego162已结束、正式cookie已恢复、自有HTTP/PG退出。完整语义对应、结构化字段来源、误报收敛和备忘录重排仍待完成，见PUBLISHER-SOURCE-03报告与唯一主登记表。

## 2026-10-13 · PUBLISHER-REVIEW-02 导入实际内容核对

业务78d969b7ef84e51fb3e37ed952cd4a0ef8a4fb24，生产dpl_2n36guqiugoAjPn6KmC585DcByLb READY，正式alias匹配。1913常规检查、412边界、类型与build通过；50生产迁移checksum一致，本轮无SQL。最终提案人物/关系/历史知情/消息时间/地点路线/阶段候选中文分组预览，模型说明明确待核对；原作者未知值保留与AI新未知字段未采用分开提示。AI与纯解析共用，保双核对和版本权限守卫。

本地旧合成模型结果回放390/1440、双勾→填入→真实保存r1→GET精确等于updatedContent通过，非新模型质量验收。公网390/1440纯解析10组预览、旧结果基线拒绝、合成原稿r1/下架不变、health/workbench200/未登录作品401通过；未修改同事作品。0新模型/世界/图，旧账本closed。正式cookie恢复，Ego161 finish、自有HTTP3278与PG55476停止。完整来源对应/遗漏检测与备忘录重排未完成，见PUBLISHER-REVIEW-02A及唯一主表。

## 2026-10-12 · SCRIPT-INTAKE-01 内部发布后台规划

首份资料版本 f357a8c / qjpht7ik8 / dpl_DXi7CRXvc9QuYLzNgEympqhAdHmh READY；正式alias匹配，health/possibilities200，私有源目录与docs直链404。业务仍83f9c11对应既有现场呈现，0源码/SQL/生产世界变更、0模型图调用。本地1335check/type0/336边界/build0，生产41迁移只读一致；首次未就绪默认55432沙箱连接EPERM保留，独立本地55476既有迁移后全过，PG/启动器已释放。原件4份与ZIP解包4项（1稿3图）保存在主.local私有目录、8摘要核验，不推Git/上传部署。仅安全索引/缺项/规划/报告归档，**发布后台和同事新剧本未上线**。剧情节点明确为可能性，未来字段版本化结构内容与稳定发布关系分开，旧存档不改写。详见WORLD_PUBLISHING_MVP_PLAN与SCRIPT-INTAKE-01；B/Q规划已接收，真实PG矩阵/15编辑操作均是待实施验收项。

## 2026-10-12 · SCENE-STAGE-01 现场舞台呈现

业务 b7679a8488648ec6705b714c96adbf715125780a（adeb022呈现、b01916f媒体源修复）；生产 cjf1qa972 / dpl_G61acanuNRomCYkPxKUHLp9TpRCy READY，正式域名 https://parallel-life-nu.vercel.app 精确alias核验。1335check/336边界/type0/build0、10新SSR/源范围用例通过，生产41迁移checksum只读匹配，无SQL变更。公网旧暂停合成存档8组读取/隔离/版本一致通过，3场景SVG200，开发场景预览404；0新模型、世界创建/业务写、上传/生图。390×844、390×500及PC1440内420已检查，通知→微信→返回草稿/内滚位置恢复；220/top90仅几何模拟，不称真机键盘通过。

现有现场改为场景图、实际在场人物和分离的旁白/对白/行动；只使用已有world/revision授权素材，无图明确原创场景示意。原回执/unknown恢复、原真实顶部来信不变。Q e46规划/6456复核已准确归档，旧母04真实交付仍failed、2/4保持、16of18closed不动。PG55456/HTTP3275与Ego149已结束；无额外付费。仅现场呈现交付，角色自然性/任意复杂动作/场景生图与成果→机会→私聊全模型链仍待验。详见SCENE-STAGE-01报告。

## 2026-10-12 · AI-GATEWAY-LIFECYCLE-01 / NPC-RESULT-ACK-01 / 独立Q审计

业务a1ef737，production 57rloofdv/dpl_A6GBHJZJvu7PEsH5hhLDsCVifzz9 READY/正式别名已切换；889check/332边界/type0/build0，全真实PG247pass+5明确模型opt-in skip、第二补最终PG10/10，生产41迁移一致无SQL。公网8组既有paused合成存档phone/records/map同版本、4目录/旧档保留/跨owner404及health页面通过；0新模型/图/世界/生产业务写，仅GET可能有基础限流记录。PG55452已停无监听，HTTP/browser未启，B/Q范围资源均释放。只证明传输及有限ACK，不证明旧85s供应商慢/场景结构输出或自然完整体验已治愈。

模型请求及响应体有统一硬截止，取消/EOF/显式错误/截断/无完整结束不可冒充成功；读取大小有限，晚响应/暂停yield/消费者退出时取消释放，不自动重付unknown。角色承接只认当前精确ID、无歧义姓名或有限局部占位，拒他人id/name碰撞及不可见来源；不从台词制造完成。主表SCENE-MODEL-STABILITY及SPACE-MATTER-AI-QA-02真实母项未完成，新授权尚待，语音暂缓。

## 2026-10-12 · UI-BRANCH-UNIFY-02 / UI-MOBILE-KEYBOARD-02B / UI-PRESET-ART-02Q

业务8c1b1b2，production 49udqtqr4/dpl_BZefRTayTxqx2kRHDA6gQkbzUgZK Ready，正式域名已切换；843check/331边界/type0/build0，41生产迁移一致无SQL。公网/api/health与possibilities200、19SVG200、dev preview404；390/1440实际7卡均同结构及体验说明、可见封面loaded/无横溢出。两本地paused官方夹具去重及6头像、Phone/outer220-offset90输入可见同页恢复844已过；非真机微信/审美满意/真实模型链验收。0模型图及生产世界创建，PG55452/HTTP3265等已停，Ego142 finish。

预设/已建/草案/生成方向共享卡片；同一官方存档去重，仅精确官方身份映射原创主题封面/壁纸/NPC插画，用户照片优先。修复可见视口offset与短屏tips覆盖导致输入越界。真机微信键盘及审美仍待用户验收；不声称旧现场完整真实模型链通过。验收脚本错误与首次220短屏失败保留在专属报告。

## 2026-10-09 · GROUP-01 / GROUP-01I 群聊后端

应用6890d17，Production e3b7xf81l / dpl_GdcLxLKhNRj8mRzTq6VhYA9sV1Pr READY，正式域名 https://parallel-life-nu.vercel.app 已切换。0038已应用，38/38生产迁移校验和一致；367check、56真实PG/3可选跳过及build通过；两身份实际群回合与领先现实4天的故事时刻模型通过。公网通用worker→真实群回复、显式替代任务重试/重复、成员退出重入、已读、跨群/账号隔离、暂停和私聊不污染通过（恢复23项、脚本修正后接续13项）。初版89b7403/co2pro3wr过期邀约失败保留，原任务仍failed，不自动重新付费；合成世界已暂停。仅后端，media=[]，群/现场UI另验收。规划及只读报告快照归档不代表官方剧本/锁屏/界面能力完成；LIB-04B业务排除。见[GROUP-01I](task-reports/GROUP-01I.md)。

## 2026-10-09 · SCENE-01 纯文字现场后端

业务430d25f，Production 1iuggd0nw / dpl_BCUH5rak9phwUJMKJhg5ZBFHqqco READY，正式域名 https://parallel-life-nu.vercel.app 已切换。0037应用且37/37生产迁移校验和一致；355check、53真实PG/2可选跳过及build通过，两合成身份真实多轮9调用通过。公网39项实际NPC日程确认→进入→行动原文→实际裁定→幂等→手机/现场恢复→暂停离场→旧消息与隔离通过；离场后实际私聊接上现场，生产确认角色记忆的3条事件来源。测试世界暂停、PG55442停止、工作树提交归档。本批是后端，不含SCENE-02 UI、定向耳语/长期任务/现场媒体或多人；失败模型样本、邀约澄清过程及边界见[报告](task-reports/SCENE-01.md)。

## 2026-10-08 · NAR-02R / NAR-02RI 回访消息集成

最终业务1dc7c45（202933b集成、94f090c及37c0ed2修复），Production 4gz1pogvu / dpl_4Fhx58TMn37x9FRi7Xtqm89rgGiW Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。342check、51真实PG/2可选模型默认跳过、build通过；36生产迁移校验和一致，无SQL变更。第三轮四个真实模型短/长样本通过，前两轮失败保留；修复否定跨句漏拦截、待执行成果/来源以及记录选择后phone503的派生ID契约。

公网合成世界通过9项回访/原消息日期/nextStep持久来源/重复和暂停检查；390/1440实际通知→对应私聊，旧消息10月8日与新消息20:25分明，无横向溢出；最终增量再次读取200/暂停played0。仅该合成世界用旧clock锚点模拟五天，未动真实用户或伪称持续后台。消息仍主要为具体下一步提议，不能称未记录的幕后成果已经完成；群聊/现场另验收。详见[NAR-02RI](task-reports/NAR-02RI.md)。

## 2026-10-08 · PLAY-01 / PLAY-01I 基础体验契约

业务4739316（d689790的干净集成）已推送，Production 5p948gk00 / dpl_3UkvuByDiiykQHV5N7oF4obVeAdN Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。独立334check、49真实PG/1可选模型跳过、build通过；生产36项迁移校验和一致，无新SQL。公网旧世界读取→真实NPC私聊→回执重放→重读、跨访客404以及首页/分支/health共8项通过。

本批只新增共享契约和纯领域规则，无群聊/现场仓储、API或UI，不声称新体验已可使用；成员/来源/行动/事项/媒体语义仍需真实服务端组装和模型验收。见[PLAY-01I](task-reports/PLAY-01I.md)。

## 2026-10-08 · PEOPLE-01R / PEOPLE-02 朋友资料优化集成

业务提交609e266（含3fb0a7b修复及efe2747新版集成）已推送；Production nhtcmn277 / dpl_EXcj4Q3YhDBALvdzf9SgMqGRyJU9 Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。生产0036已应用，36项迁移一致；307常规检查、49真实PostgreSQL、四个真实访谈场景、build与390/1440实际编辑上传保存检查通过。

公网独立合成访客34项完整检查通过：丰富描述、同名人物、有图/无图、原图快照、分支角色、真实NPC回复、错误照片/修订/跨账号隔离、已用原图保护。线上手机真实上传后关闭编辑器，临时图片404、原有档案保留，390px无横向溢出。显式重试执行替代任务，生成和回复拒绝有限显式上下级矛盾；没有放松校验或无限自动重试，不承诺所有自然语言语义均可检测。详见[集成报告](task-reports/PEOPLE-01R.md)。

## 2026-09-29 · NAR-02M 后台每日有界唤醒

应用提交 `5e1b75e`；Vercel Production `mrcsx96x7` / `dpl_2TXtzVZBfxJM4EtR5zFL4at2ow46` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run check` 242 项常规测试、`npm run test:db` 37 项真实 PostgreSQL 测试、`npm run build` 通过；生产 Supabase 30/30 迁移一致，调度角色不可直接读取世界内容。每日 04:00 UTC 的 Vercel Cron 入口已配置；公网 health/首页/分支页 200，未授权入口 401，密钥授权调用 200，当前领到 0 个到期世界。后端每日最多领取两个已启动、未暂停的世界，每个最多一拍；并发重复不重复领取，未知模型结果不自动重试。尚未观察到生产自动 NPC 来信，且未在生产用户世界制造测试剧情；免费档非实时、无系统推送。详见 [NAR-02M](task-reports/NAR-02M.md)。

## 2026-09-29 · NAR-02J 手机在线时主动来信

应用提交 `6a5c6ac`；Vercel Production `q7cudpjg7` / `dpl_B3685G4iwM4Nz6wZbMju5zA56RZE` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run check` 232 项常规测试、`npm run build` 通过；生产 Supabase 29/29 迁移一致，无新迁移。公网 health、首页、分支页及合成访客入口均 200；390px 手机无横向溢出，1440px 电脑中手机宽 420px。手机停留在前台时每分钟检查一次世界时钟，仅到期且服务端有未了事项才可能产生来信；真实消息提交后刷新通知。尚无关闭网页后的后台推送，未在生产用户世界写入测试剧情。详见 [NAR-02J](task-reports/NAR-02J.md)。

## 2026-09-29 · NAR-02I 受阻后的人物建议

应用提交 `37f1499`；Vercel Production `f8cb0hg2z` / `dpl_A1zZrdpzM8zRJkBFCZKSw7nZFhCa` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run verify` 通过（含 34 项真实 PostgreSQL 集成测试），`npm run build` 通过；生产 Supabase 29/29 项迁移一致，无新迁移。公网 health、首页、分支页及合成访客入口均 200；390px/1440px 本地合成手机便签无横向溢出；合成真实模型抽样得到与人物原话一致的具体恢复建议。受阻建议保存来源、刷新可回看，不会冒充用户已采用或障碍已解决。没有在生产用户世界写入测试剧情；完整长期剧情和后台主动唤醒仍未完成。详见 [NAR-02I](task-reports/NAR-02I.md)。

## 2026-09-28 · NAR-02H 人物下一步与日历邀约同源

应用提交 `12696d1`；Vercel Production `16zvvx6zr` / `dpl_BkYYKycghodr3A6DvNF39mxpTVuv` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run verify` 通过（含 34 项真实 PostgreSQL 集成测试），最终 `npm run check`（226 项常规测试）和 `npm run build` 通过；生产 Supabase 29/29 项迁移一致，无新迁移。公网 health、首页、分支页、合成访客入口均 200；本地合成手机便签到日历详情可达，390px/1440px 无横向溢出。人物下一步只与同事件、同角色、唯一的邀约关联，并跟随日历确认/取消状态。没有在生产用户世界制造测试剧情。详见 [NAR-02H](task-reports/NAR-02H.md)。

## 2026-09-28 · NAR-02G 人物提议有来源的下一步

应用提交 `5034228`，Vercel Production `6rhukapfg` / `dpl_Evo46iGoRhBHz6KoBJAs5295Ymw7` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run verify`（含 34 项真实 PostgreSQL 测试）与 `npm run build` 通过，生产 Supabase 29/29 项迁移一致，无新迁移。公网 health、首页和分支页 200；390px 手机与 1440px 电脑首页无横向溢出。合成真实模型场景验证人物原话可落成有来源的下一步；没有对生产用户世界写入测试事件。人物提议不是已履约事实，完整剧情结局与跨应用回报继续留 NAR-02/03。见 [NAR-02G](task-reports/NAR-02G.md)。

## 2026-09-28 · NAR-02F 新结果优先承接

应用提交 `8a7fb40`，Vercel Production `64rvxftgo` / `dpl_2QbqoZ1jAMqTAh77yvBsYnAt9dbd` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run verify`、`npm run build` 通过，其中真实 PostgreSQL 34 项测试通过；生产 Supabase 29/29 迁移一致，无新增迁移。公网 health / 首页 200，未登录调用导演写入口 401。最近主动来信过的人，仍可在用户报告新选择结果后于下一合法节拍回应；普通催问继续冷却，结果承接一次后退出待办。没有后台实时推送，也没有把自述变成核验成就。详见 [NAR-02F](task-reports/NAR-02F.md)。

## 2026-09-28 · NAR-02E 选择与结果可在手机回看

应用提交 `1cfd7f0`；Vercel Production `noa6d12a0` / `dpl_2YbB3g6A3wrN3qFvvxiCE6bX5zrN` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run verify`：222 项常规测试和 33 项真实 PostgreSQL 集成测试通过；最终 `npm run check`、`npm run build` 通过。生产 Supabase 29/29 迁移一致，无新增迁移。公网 health / 首页 200，未登录世界读取 401；390px/1440px 本地合成手机便签展开与无横向溢出通过。选择与用户自述结果通过同一世界事件投影到只读故事记录；不伪造照片或独立核验的成就。完整剧情与跨应用后果仍在 NAR-02/03。见 [NAR-02E](task-reports/NAR-02E.md)。

## 2026-09-28 · NAR-02D 自由对话中的结果报告

应用提交 `c5a4964`，Vercel Production `262prl6ua` / `dpl_FiSVarB3qGdGGR6eousmKUjzfdct` READY，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run verify`、`npm run build` 通过，真实 PostgreSQL 33 项通过；生产 Supabase 29/29 迁移一致，无新增迁移。公网 health、独立合成访客 session、世界列表均 200。合成真实模型四轮抽样验证完成、受阻、放弃与假设边界。用户自述结果有原话和选择来源，导演只对关联的选择承接一次；不把自述当独立核验的世界事实。完整成就核验和跨应用回报仍待 NAR-02/03。详见 [NAR-02D](task-reports/NAR-02D.md)。

## 2026-09-28 · NAR-02C 对话选择的来源与一次承接

应用提交 `b26382b`，Vercel Production `nnbe92ve7` / `dpl_7oKs9ijUkjdwwaKV6w1VDY9TvaQq` READY，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run verify`、`npm run build` 通过，真实 PostgreSQL 33 项通过，生产 Supabase 29/29 迁移一致，无新迁移。公网 health、独立合成访客 session、世界列表均 200；合成真实模型明确选择/假设两轮抽样通过。聊天里明确说出的行动可进入世界事件和有界选择状态，下一导演节拍由知情人物一次承接，不把假设或 NPC 回复当行动完成。完整目标/结局与跨应用结果仍待 NAR-02/03。详见 [NAR-02C](task-reports/NAR-02C.md)。

## 2026-09-28 · NAR-02B 邀约结果闭环

应用提交 `c34d540`，Vercel Production `2rjrvhr1a` / `dpl_And9i7FAs1RbhSH4TQDY5HSSMNZs` READY，正式域名 https://parallel-life-nu.vercel.app 已指向新版。生产 Supabase 29/29 迁移校验和一致，本段无新增迁移；214 项常规测试、33 项真实库测试及构建通过。公网 health 200、独立合成访客 session 200、赴约接口对不存在合成世界返回预期 404（非 503）。390px 合成手机无横向溢出，1440px 电脑内手机宽 420px。未向生产世界写入测试约定，完整长期剧情线仍在 NAR-02。详见 [NAR-02B](task-reports/NAR-02B.md)。

## 2026-09-28 · NAR-02A 有依据的主动来信与回访恢复

应用提交 `ef00dab` 已推送；Vercel Production `e49ualugu` / `dpl_9eWz6QUTgKDuvAwBZLbVgzt2M4Ts` READY，正式域名 https://parallel-life-nu.vercel.app。生产 Supabase 已执行 `0029_director_attempts.sql`，29/29 迁移校验和一致。`npm run verify`：211 项常规检查、32 项真实 PostgreSQL 集成测试通过；最终 `npm run build` 通过。公网 health 200、合成访客 session 200、带鉴权的导演接口对不存在世界返回预期 404（非 503/路由缺失）。Ego Lite 公网首页只读检查；本地合成手机在 390px/1440px 解锁及无横向溢出。真实网关合成邀约场景一次抽样得到 59 字具体主动来信。未在生产创建付费测试世界；后台定时唤醒与完整剧情线状态机仍待 NAR-02。见 [NAR-02A](task-reports/NAR-02A.md)。

## 2026-09-28 · EXP-08 分支与手机消息时间

应用提交 `1e924e9` 已推送；Vercel Production `df9xb68j1` / `dpl_4TsDaaJofvPeRVYVzdrkP3qCUtCm` READY，正式域名 https://parallel-life-nu.vercel.app。生产 28/28 迁移校验和一致，本次无新增迁移；211 项常规测试、31 项真实库测试、构建通过。公网 health、独立合成访客会话、分支列表、世界列表和分支页均 200。390px/1440px 本地页面无横向溢出；本地合成旧世界锁屏显示 06:55，三条开场通知分别为 06:16、06:39、06:46。未在生产创建付费测试世界；主动 NPC 延迟调度仍属 NAR-02。详见 [EXP-08](task-reports/EXP-08.md)。

## 2026-09-28 · EXP-07 分支入口与手机开场体验

应用提交 `fa91fa9` 已推送；Vercel Production `i9uk413uu` / `dpl_DCtjFK8uCA4gjJLhkrDBVcJxd8aK` READY，正式域名 https://parallel-life-nu.vercel.app。生产 28 项迁移一致、无新增迁移；208 项常规测试、30 项真实库测试、构建通过。公网 health、分支页面、隔离合成访客、分支与世界列表读取 200。锁屏与分支 390px/1440px 本地视觉通过；两身份开场及两轮 NPC 合成真实网关抽样通过，首次导演开场曾遇输出截断，收紧输出预算后复测成功。未在生产新建付费测试世界；既有世界消息不重写。详见 [EXP-07](task-reports/EXP-07.md)。

## 2026-09-28 · EXP-03F 「我的」资料与 Agent 写入修复

后续兼容补丁 `b19cb4c`：旧身份候选收为可展开的待核对资料，无法安全落入基本资料的记录不再提供会失败的确认动作；旧身份事实明示待核对。Vercel Production `1oxby4l9g` / `dpl_9pYqinxvCyRKmrX149ZckWSXwLZB` READY；207 项检查、30 项真实库测试与构建通过，本地 390/1440 双端旧候选复核通过。正式域名已指向该部署，health 200。

应用提交 `c8b5a5b`，Vercel Production `krcg7ku3k` / `dpl_C9X5hovj4QktE3A4YVcXVvUHGPVh` READY，https://parallel-life-nu.vercel.app health 200。206 项检查、30 项真实库测试、生产构建通过；生产 28 项迁移一致，无新迁移。手机 390px、电脑 1440px 的合成冲突资料验收通过；公网独立合成账号完成两轮真实 AI 访谈、冲突候选与显式确认，确认前原生日不被覆盖。详见 [EXP-03F](task-reports/EXP-03F.md)。真实用户历史记录不会自动批量改写，需本人核对。

## 2026-09-28 · EXP-03E 分支空白提交与提示一致

应用 `498cb00`，Vercel Production `ckmuh4gl3` / `dpl_DNtn3NXgpf4jmbmVDERaW2W2kWL1` READY；https://parallel-life-nu.vercel.app health 200。204 项检查、生产构建通过；生产 28 项迁移一致，无新迁移。已有具体聊天但无已确认资料时，分支编辑区现在可留空点「帮我想想」，沿本人最近的话推演；没有可用聊天或资料时，说明会要求先输入。辅助在原合成会话的 390px 手机和 1440px 电脑只读复核按钮已启用、文案一致、无横向溢出。见 [EXP-03E](task-reports/EXP-03E.md)。此次未再次发起模型推演，AI 方向文案质量仍是后续任务。

## 2026-09-28 · EXP-03D 聊天承接与草案身份设定上线

应用提交 `8b35424`，Vercel Production 部署 `gvjpdmv0r` / `dpl_DZiBLkMnmbxcexMDazXVj2LZfHMZ` READY；正式域名 https://parallel-life-nu.vercel.app 的 health 200。204 项常规检查、28 项真实库测试与构建通过；生产 28 项迁移校验和一致，本批无新迁移。

已聊过的用户在分支空态可沿最近本人的话发起 AI 推演；生成方向刷新后仍展开。草案现在可保存可选的主角身份、地点与氛围，确认后将其作为虚构起点建世界。390px 手机与 1440px 电脑本地实看无横向溢出。公网独立合成账号完成两轮访谈→三条真实 AI 方向→草案保存/恢复/重复确认→含明确身份及地点的世界→NPC 回复→便签版本保护；详见 [EXP-03D](task-reports/EXP-03D.md)。

完整 EXP-03、页面重构、主动剧情与真实生图回报仍在后续任务；AI 方向正文偶发替换字符待修复。

## 2026-09-28 · EXP-03B/C 与 CHAT-01 已上线

应用 a90e4d8（含资料投影b418d1f、引导f7285f5），部署 ktz3z22t7 / dpl_DtLfHJzfUPGNTKxFfguNgBtG1ZdX READY。正式域名 https://parallel-life-nu.vercel.app，health200。

203项检查、28项真实数据库测试、生产构建通过；生产0028已应用，全部28迁移校验和一致。草案保存/恢复、照片逐张授权、唯一确认入口与旧人生兼容上线；“我的”恢复完整分类及日期精度；开场和单问题访谈引导更新。

独立合成账号公网两轮真实访谈→生成方向→草案保存/重开/重复确认→世界生成→NPC回复→便签保存/更新/陈旧版本拦截通过。手机390和电脑1440无横向溢出；本地手机编辑恢复已选经历与仅年份生日通过。详见 EXP-03C、EXP-03B、CHAT-01 报告。

EXP-03整体未完成：自由草案来源/完整聚合读模型/事件附件、全页面重构、主动剧情和真正生图回报仍在后续任务；本批不宣称已达到最终体验。

## 2026-09-28 · EXP-02 可信创建与真实结果

应用 ed2f3e7，m2t6kvqrh / dpl_9dw8USU3MxELBNUSrdziCsw8zWNs READY，正式域名 https://parallel-life-nu.vercel.app，health 200。199项检查、26项真实数据库测试、build成功；生产27迁移一致，本批无迁移。

分支先查看方向与带入资料，不再自动建第一条；照片默认不选；资料显式本人归属校验；撤下模板生图和虚构朋友圈；历史素材来源待核验，消息不再凭标题挂图。EXP-03A统一体验契约设计随本批发布，未把设计当实现。

公网独立合成账号两轮真实流式聊天/资料保存通过，毕业与朋友年份未覆盖生日、未建世界；现有世界仅只读检验手机/PC锁屏与朋友圈空态。真实生成、主动剧情、全UI替换仍待开发。详情见 task-reports/EXP-02.md。

## 2026-09-28 · EXP-01 体验审查基线

98c3a92仅文档部署，6tyvubijw / dpl_EuDsxoCsuJCVBtxbtvwjj5bJhcNg READY；生产应用代码仍等同c58ccb4。本轮交付独立体验审查、完整重构方案与任务拆分，没有声称UI/主动世界/真实生图已重构完成。生产27迁移一致。报告EXP-01/EXP-01B；下一步EXP-02/03。

## 2026-09-28 · NAR-01 已发布

主角导向叙事、真实角色记忆入模、情境回应与开场改进、导演预览人物姓名。197项检查+25项真实数据库测试、build通过；27生产迁移一致，无新增迁移。应用 c58ccb4，部署 aw37f5abz / dpl_3YDTmkUMiCesXZvJ3hC3UVdM8YtW READY。https://parallel-life-nu.vercel.app health200，手机与PC导演预览验收通过；合成场景真实模型调用见 NAR-01 报告。长期剧情状态与跨应用后果尚未完成。

## 2026-09-28 · PHONE-02 已发布

便签服务端保存、相册来源/壁纸/分享、导演刷新与来源修复。190项检查+25项真实库、build通过；27生产迁移一致，无新增迁移。应用 d94c1af，部署 j3pkvs8zh / dpl_AkTq7bnmw94BgJcjxcTAx21i5qo2 为 READY；https://parallel-life-nu.vercel.app 已实测health200、锁屏/相册/导演/便签双端读取。写入链路在本地真实数据库验收，未向生产人生写入测试内容。报告：docs/task-reports/PHONE-02.md。

## 2026-09-28 · PHONE-01 手机修复

应用edfc216，部署dn0rcfvry（READY），https://parallel-life-nu.vercel.app 已公网检查。187项检查/build通过，生产27项迁移一致，无新增迁移。修复桌面重复/溢出、便签分享、日历草稿与虚假交互、异常模型回复；详见 docs/task-reports/PHONE-01.md。语音与生成赴约场景尚未接入，入口如实说明。

## 2026-09-28 · VIS-01 外层视觉发布

- 应用提交4537259（首版58c0ade）；部署np31s32vm，READY，生产地址 https://parallel-life-nu.vercel.app。
- 183项检查及构建通过，生产27项迁移校验和一致，无新增迁移；手机390px、短屏500px、电脑430px容器验收。
- 公网分支封面、导航、资料读取、进入已有手机锁屏与通知验证通过。完整记录见 docs/task-reports/VIS-01.md。
- 视觉改版前标签before-visual-20260928已上传；回退方法见 docs/design/VISUAL_ROLLBACK_20260928.md。代码备份不包含数据库备份。
- 本条下方为历史记录，旧迁移数量和旧能力说明不代表当前发布。

# 部署接续

## 常驻发布规则（用户 2026-09-23 要求）

**每完成一项交付就部署上线并实测，不再积累到"以后再发"。**

发布步骤（按顺序，缺一步不算完成）：

1. `npm run check` 与 `npm run build` 通过；产品界面改动同时检查手机与 PC。
2. 确认生产库迁移已应用：生产为 Supabase，管理员连接在忽略文件 `.local/supabase.env`（`SUPABASE_DB_URL`）。比对 `public.pl_migrations` 与 `db/migrations/` 的文件校验和；有未应用项时先用 `migrate(client)` 应用，不跳库、不复用其他项目库。
3. **提交身份必须是 Vercel 账号已关联的身份**，否则 Git 触发的部署会被 BLOCKED（"the commit author doesn't have permission to create deployments"）：
   `git -c user.name=limengzhe27-boop -c user.email=255650132+limengzhe27-boop@users.noreply.github.com commit ...`
   历史上 `李孟哲 <limengzhe@limengzhedeMacBook-Pro.local>` 提交的部署被拒（dpl_H29St8Lm…，BLOCKED）。
4. 推送 `main` 触发 Vercel 构建（项目 `parallel-life`，team `limengzhe27-boops-projects`）；必要时用 `vercel --prod`。不要修改生产环境变量；`APP_PREVIEW_ONLY` 必须保持 `0`。
5. 部署 READY 后在 https://parallel-life-nu.vercel.app 实测关键流程：`/api/health`、`POST /api/v1/session`、新接口存在性（返回 401/422 而不是 404）、以及本次改动对应的真实功能。
6. 把版本号/部署 ID、实测结果和未验证项写回本文件与任务报告；未上线的改动必须在报告里明说。

2026-09-22，用户已要求上传GitHub并部署。代码仓库为私有仓库：
https://github.com/limengzhe27-boop/parallel-life

用户已选择Vercel网页预览，地址为 https://parallel-life-nu.vercel.app 。独立项目parallel-life已连接GitHub仓库，Production和Preview均配置APP_PREVIEW_ONLY=1。云数据库、Worker与持久私有存储尚未接入。网页明确展示预览提示，保存与AI发送禁用，业务API返回503；本地完整模式不受影响。

> 上段为 2026-09-22 的历史记录。2026-09-23 起生产已接入 Supabase（`APP_DATABASE_URL`/`WORKER_DATABASE_URL`）、私有素材桶与真实模型网关，`APP_PREVIEW_ONLY` 已置 `0`，公网为可用真实后端；迁移 0001–0016 已在 Supabase 应用且校验和一致。

## 发布记录

### 2026-09-24 · 全面精进对话质感：向导 Agent 深度共鸣与分支画面推演引导 & 分支 NPC 微信私聊拟真化与“接招-推进-抛球”交互重构

|项目|内容|
|---|---|
|交付内容|1. **向导 Agent 对话全面精进与平行分支画面推演引导（`interview-planner.ts` & `interview-app.tsx`）**：响应用户诉求，彻底跳脱“收集信息的调查员”模式，升华为“懂人性的深情倾听者与平行宇宙造梦伙伴”。引入“平行视界推演法”：当用户倾诉现实日常、工作疲惫、未竟热爱或生活遗憾时，Agent 不再做干瘪的流程化提问，而是主动在回复中为用户勾勒出一幅极具画面感与情绪张力的平行人生图景（如“如果在某个分岔路口，你没有被现实规训，而是毅然背上相机成了一名行迹天涯的野生摄影师，此刻的你或许正站在冰岛的苔原边等待极光……”），并向用户抛出探索式发问：“如果真有这样一个世界，你最想推开门去看看那里的你过得怎么样吗？”，瞬间降低用户的构思门槛，点燃用户的探索欲并顺理成章引导其开启平行分支；同时升级输入框 placeholder 与欢迎界面初始探索按钮，提供丰富的主动探索起点；<br>2. **分支世界 NPC 微信私聊真实人际质感与“接招-推进-抛球”动态交互重构（`turn-planner.ts`）**：彻底根除 NPC“自说自话、无视用户反问背预设台词”的生硬违和感。重构交互三步准则：① **第一反应必须正面接招**：严格承接主角发送的上一句话（如主角冷淡反问“什么事”时，NPC 会根据人设产生真实的急迫、心疼或调侃情绪，严禁无视继续背台词）；② **推进情境**：结合当前世界背景与日程，带出具体生活事件或突发状况；③ **抛球发问**：句末自然向主角抛出提议或选择，促使双向互动。同时按亲人/长辈（烟火气与刀子嘴豆腐心）、密友/铁哥们（松弛互损与随时约饭）、合伙人/同行（雷厉风行但生死托底）、知己/伴侣（细腻分享与欲言又止）四大圈层注入极其地道的中文微信私聊口吻；<br>3. **分支世界开场人物生态与戏剧切入点强化（`world-planner.ts`）**：升级世界构建 Prompt，actors 人设拒绝模板化工具人，注入真实脾气习惯与人际羁绊；开场私聊直切具体的生活事件节骨眼，让主角一进入世界就拥有强烈的回复与探索欲望；<br>4. **测试与构建保障**：183 项全量测试绿灯通过，Next.js 生产优化构建一次性成功。|
|发布前检查|`npm run check` 183 项测试全绿通过，`npm run build` 成功|
|提交|`2c7b1f8`（feat: refine interview and NPC dialogue quality, guide branch inception, and enhance dynamic WeChat interaction）|
|部署|Vercel Production（部署 ID: `l0hjuqjjl`，公网别名 `https://parallel-life-nu.vercel.app`）|
|迁移应用|无须新增 SQL 迁移|
|线上实测|公网 `https://parallel-life-nu.vercel.app` 生产部署实测通过（`/api/health` 200 OK，部署状态 Ready，向导 Agent 分支画面推演引导、分支 NPC 拟真微信私聊及开场丰富生态均已全量上线生效）。|


### 2026-09-24 · 修复年份识别与资料精准纠错（05年/01年）& 资料卡片结构化去重 & 彻底移除回复下方分支选择卡片

|项目|内容|
|---|---|
|交付内容|1. **对话识别年份并精准改写资料（05年 -> 01年等）（`interview-planner.ts`、`profile-repository.ts`、`interview-handler.ts`、`interview-repository.ts`）**：解决此前“先说05年又说01年，无法识别改写”的缺陷。扩展 `InterviewProposalSchema.basicInfo.birthdate` 支持纯年份及短日期（兼容 `/^\d{4}(-\d{2}(-\d{2})?)?$/`）；提示词中明确告知模型在用户提及或纠正年份时必须直接覆写 `basicInfo`，严禁平铺到 facts；在 `extractBasicInfoFromText` 增加对中文口语年份（“01年”、“05年”、“2001年出生的”、“其实是01年的”等）的自适应解析与 4 位年份补齐（如 01 -> 2001，05 -> 2005），并修正了长短正则贪婪匹配优先级；在 `applyBasicInfoInTransaction` 落地时，不仅无缝将 4 位年份规范落库至 `YYYY-01-01`（或保留已有月日），还自动检索并过滤清理历史残留的旧年份/旧出生/旧 identity 条目，确保资料卡片实时呈现最新正确出生年份；<br>2. **资料信息区域彻底理顺与文本去重（`interview-app.tsx`、`interview-repository.ts`、`profile-repository.ts`）**：解决此前“资料信息很乱，既有上方选项填写又有下方文本写入”的问题。确立严格的数据分层边界：姓名、生日、城市、职业等基础信息只属于上方的【基本资料】表单；下方的【我的故事】（`profile-facts`）收敛为仅展示真正的个人特质（爱好 `interest`、性格 `personality`、心愿 `wish`），彻底阻断并过滤所有 `identity` 或包含“出生/生日/名字叫”的琐碎文本事实，避免重复与混乱冲突；<br>3. **彻底清除对话回复下方常驻分支选择卡片（`proposal-thread.tsx`）**：解决此前“每发一条消息，回复下方都会带分支选择卡片”的问题。重构 `ProposalThread` 渲染守卫，在正常对话且用户未发出创建/推荐分支指令时（`stage === 'idle' && externalIntent === 'none'`），彻底隐藏分支构筑与精选卡片，仅在用户明确表达分支构筑诉求或进入推荐交互时才唤出，还给用户一个干净舒适的纯净对话视口；<br>4. **测试与构建保障**：新增 8 项年份与纠错专项单元测试，全量 183 项测试通过，Next.js 生产优化构建一次性成功。|
|发布前检查|`npm run check` 183 项测试全绿通过，`npm run build` 成功|
|提交|`87c36eb`（fix: resolve birth year correction, clean duplicate text facts and hide idle branch proposals）|
|部署|Vercel Production（部署 ID: `lb5a0wkj2`，公网别名 `https://parallel-life-nu.vercel.app`）|
|迁移应用|无须新增 SQL 迁移|
|线上实测|公网 `https://parallel-life-nu.vercel.app` 生产部署实测通过（`/api/health` 200 OK，部署状态 Ready，年份识别纠错、资料卡片去重、闲置对话无分支卡片均已就绪）。|


### 2026-09-24 · 对话直传生活照入库展示 & 对话个人信息（生日/姓名）精准结构化回填表单 & 相册上传强化

|项目|内容|
|---|---|
|交付内容|1. **对话过程直接上传照片并沉淀底模（`interview-app.tsx` & `interview-planner.ts`）**：解决此前对话无法传图的缺陷。在访谈聊天输入框左下侧新增【📷 照片】上传按钮，支持直接选择本地 JPG/PNG/WebP 生活照或肖像底模；上传后自动调起资产存储服务并原子写入个人档案参考图池（`add-reference-photo`），聊天列表中即时渲染高质量图片预览卡片（点击可全屏查看）；提示词新增温情回应指导，引导向导自然感知用户分享的生活瞬间；<br>2. **对话提及个人信息（如生日、姓名、城市等）精准结构化回填资料卡片（`interview-planner.ts`、`profile-repository.ts`、`interview-handler.ts`、`interview-repository.ts`）**：根本解决此前“对话说明生日后，生日选择器不会选中，而是作为文字稿堆在下方资料里”的体验 bug。在 `InterviewProposalSchema` 扩展 `basicInfo` 结构化对象，并在后端增加规则正则双重提炼；实现 `applyBasicInfoInTransaction` 并在流式与异步 Worker 统一挂载，将用户提及的生日（自动格式化为 `YYYY-MM-DD`）、姓名等直接写入并合并到 `个人资料\n` 的 identity fact 中，使前端 `<input type="date">` 生日选择器与姓名等输入框直接自动选中与回填；同时过滤掉 candidate facts 中重复的生日文本，彻底根除在下方杂乱文字稿中重复平铺的现象；<br>3. **手机相册 App 空态与顶栏上传强化（`photos.tsx`）**：在相册空态正中央新增大尺寸醒目的【➕ 上传生活照片】圆角按钮，点击直接调起本地文件选择，上传后即刻存入当前平行人生的生活回忆相册；<br>4. **测试与构建保障**：182 项测试全量通过，Next.js 生产优化构建一次性成功。|
|发布前检查|`npm run check` 182 项测试全绿通过，`npm run build` 成功|
|提交|`a593d27`（feat: support chat image upload, auto-populate basic info into profile card and enhance album upload）|
|部署|Vercel Production（部署 ID: `c0kflskay`，公网别名 `https://parallel-life-nu.vercel.app`）|
|迁移应用|无须新增 SQL 迁移|
|线上实测|公网 `https://parallel-life-nu.vercel.app` 生产部署实测通过（`/api/health` 200 OK，会话鉴权与对话资产上传、基础资料结构化回填正常）。|

### 2026-09-24 · 通讯录移除冗余顶部功能行 & 底部 4-TabBar 吸底固定与联系人独立平滑滚动

|项目|内容|
|---|---|
|交付内容|1. **通讯录顶部冗余功能入口彻底清除（`messages.tsx`）**：响应用户诉求，彻底移除通讯录 tab 顶部的 4 个无效硬编码原生占位入口（【新的朋友】、【仅聊天的朋友】、【标签与人际】、【世界公开广播】），通讯录在搜索框下方直接纯净展示联系人统计与平行人生联系人卡片列表，直奔主题；<br>2. **底部功能框（4-TabBar）视口吸底固定与中间列表独立滚动重构（`messages.tsx`、`phone.module.css`、`apps.module.css`）**：根本解决此前“需要下滑到最底部才能看到底部功能框”的布局 bug。原先外层 `.scroll` 仅针对 `[data-phone-thread]` 锁定了滚动，导致在微信 4-Tab 主页视图时，外层 `.scroll` 随着联系人列表无限延伸滚动，将底部的微信/通讯录/发现/我 4-TabBar 挤到了视口外极深的位置。现扩展 `phone.module.css` 与 `apps.module.css`，对 `[data-phone-app="messages"]` 及 `[data-phone-fixed-dock]` 锁定外层滚动（`overflow: hidden; height: 100%`），并将滚动容器严格限制在中间的内容主体区域（`flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain`）。顶部 Header 牢固吸顶，底端 4-TabBar 永远固定在屏幕底端，仅由中间联系人列表独立平滑滚动；<br>3. **测试与构建保障**：182 项测试全量绿灯通过，Next.js 生产优化构建一次性成功。|
|发布前检查|`npm run check` 182 项测试全绿通过，`npm run build` 成功|
|提交|`cf4dd26`（fix: remove contacts header actions and fix bottom dock bar to viewport bottom）|
|部署|Vercel Production（部署 ID: `5hevy35r9` / `dpl_BxvZX7YPbW5fYbQP8n2x76dMA7ue`，公网别名 `https://parallel-life-nu.vercel.app`）|
|迁移应用|无须新增 SQL 迁移|
|线上实测|公网 `https://parallel-life-nu.vercel.app` 生产部署实测通过（`/api/health` 200 OK，部署状态 Ready，通讯录头部冗余清除，底部导航栏吸附固定在屏幕底端正常）。|

### 2026-09-24 · 彻底根除假主动消息与“在忙吗”置顶Bug & 手机彻底纯净通用模板化

|项目|内容|
|---|---|
|交付内容|1. **“在忙吗？晚点有空回我一下哈～”假消息置顶 Bug 根本解决（`world-phone-app.tsx`）**：排查并彻底拔除了原组件内的 18s/65s 定时伪造消息机制（`triggerProactiveMessage` 与 `proactiveMessages`）。原逻辑以当前系统时间生成假消息并写入本地 localStorage，导致与真实消息池合并后该假消息时间戳永远最新，使用户无论如何回复，最底部永远被这句死循环假消息强行霸占置顶。现彻底删除该定时器与伪造逻辑，并在组件挂载时彻底清空历史遗留的 `pl_proactive:*` 本地缓存，保证私聊消息池 100% 仅由真实角色对话驱动；<br>2. **根除日程写死老洋房会议（`world-phone-app.tsx`）**：移除 `supplementalInvs`（老洋房露台布展验收与晚餐、老洋房施工交底复盘会），日程 100% 取自当前分支真实数据；<br>3. **桌面天气组件与灵感引言动态化（`world-phone-app.tsx`）**：移除写死“巨鹿路 768号”与建筑师引言，动态取自当前世界所处场景（`data.setting`）与世界标题（`data.title`）；<br>4. **抽屉身份档案、生活坐标与人生里程碑通用化（`world-phone-app.tsx`）**：彻底清除写死“李孟哲 / 29岁 / 独立主创建筑师 / 巨鹿路老洋房工作室 / 老洋房铜质钥匙 / 巨鹿路咖啡常客卡”，转换为分支主角、当前时空场景与通用生活必需品（钥匙门禁、智能手机、证件、日程笔记），里程碑时间轴动态取自分支起点与当前生活；电话未接通提示移除“老洋房现场布展”写死；<br>5. **微信与朋友圈写死内容彻底拔除（`messages.tsx` & `moments.tsx`）**：清除位置分享中的“巨鹿路老洋房工作室”、视频号中的“沈棠直播”、电话留言中的“孟哲”称呼，朋友圈署名改为“我 / 探索者 / 当前人生空间”，发布动态标签改为“我的动态”；<br>6. **相册硬编码回忆彻底拔除与空态引导（`photos.tsx`）**：移除写死的 4 张老洋房/沈棠/佛罗伦萨双年展假照片，仅保留当前分支真实生成/上传的照片；在无照片时展示清晰优雅的空态指引；<br>7. **自动化测试与构建**：182 项测试全绿通过，Next.js 生产优化构建一次性成功。|
|发布前检查|`npm run check` 182 项测试全绿通过，`npm run build` 成功|
|提交|`9fb0403`（fix: resolve proactive fake message stuck bug and clean all hardcoded architect story remnants）|
|部署|Vercel Production（部署 ID: `8s0pgt8lz` / `dpl_FwATaaWKqHxrYr2QXY3oVfvWDAmp`，公网别名 `https://parallel-life-nu.vercel.app`）|
|迁移应用|无须新增 SQL 迁移|
|线上实测|公网 `https://parallel-life-nu.vercel.app` 生产部署实测通过（`/api/health` 200 OK，部署状态 Ready）。|

### 2026-09-24 · 修复 NPC 循环单句与无反馈 Bug & 角色对话深度共鸣 & 分支人际圈层大幅丰富

|项目|内容|
|---|---|
|交付内容|1. **NPC 循环固定消息与发送阻断 Bug 彻底修复（`turn-planner.ts`）**：此前模型如果返回中文占位符（如 `"actorId":"角色ID"`）或非标准 ID，会被底层正则 `/^[a-zA-Z0-9_-]+$/` 与角色身份策略直接抛出 `INVALID_PROPOSAL` 异常，导致用户私聊发送失败，NPC 永远无法回复并卡在同一条初始开场白上。现将 `WorldTurnPlanner` 的 `actorId` 强制归一化绑定至当前交互角色的实际 ID，并提供智能 JSON 提取与自然对话回退容错，确保 100% 成功生成并提交角色回复；<br>2. **角色对话深度接收用户反馈与情境共鸣（`turn-planner.ts` & `actor-context.ts`）**：在角色上下文与提示词中，完整注入【世界标题】、【主角身份】、【世界环境】、【角色与主角具体关系】与【近期私聊历史】，开局核心事实（主角身份、生活处境）永久保留在提示词预算第一位；角色提示词升级为“真实接收每一句对话与反馈、切中要害接住话茬、结合职业与待办推动流动”，彻底杜绝敷衍与机械复读；<br>3. **分支人际网络大幅丰富（`world-planner.ts` & `contracts/world-build.ts`）**：扩展分支世界的人物架构，从原先仅 3~5 人提升至 4~7 位不同圈层维度的关键人物（核心合伙人/助手、投资人/制片人、行业前辈/导师、同行竞争对手、重要客户、密友等）；开场微信私聊扩充为 2~4 位不同人物错开发送 2~6 条多维度动态，并附带 2~4 条私人随笔与备忘，彻底消除分支世界的冷清与单调感；<br>4. **危机干预正则扩充（`safety-guard.ts`）**：增加“结束这一切”等绝望倾向识别，拦截极端消极事实落库；<br>5. **自动化测试**：新增 3 项 `WorldTurnPlanner` 专项测试（占位符归一化、纯文本容错、危机守卫），全量 182 项测试全部通过，Next.js 生产优化构建一次性成功。|
|发布前检查|`npm run check` 182 项测试全绿通过，`npm run build` 成功|
|提交|`acca61c`（fix: resolve npc repeating message bug, enrich cast network to 4-7 actors and ground dialogue in character context）|
|部署|Vercel Production（部署 ID: `4gfsgmg0u` / `dpl_GiMeHrjTRAW6JNr1SA7THChrZUXB`，公网别名 `https://parallel-life-nu.vercel.app`）|
|迁移应用|无须新增 SQL 迁移（底层 jsonb 契约天然兼容 `relationship`）|
|线上实测|公网 `https://parallel-life-nu.vercel.app` 生产部署实测通过（`/api/health` 200 OK，会话鉴权与路由工作正常）。|

### 2026-09-24 · 消除创建分支闪现已有分支 Bug & 手机通用模板化彻底清除写死朋友圈

|项目|内容|
|---|---|
|交付内容|1. **创建分支排他渲染与诚实文案（`proposal-thread.tsx`）**：彻底修复在对话中说要创建分支时仍会显示已有分支与“已创建好”的阻断 bug。将推演、保存、构筑、进入阶段设为互斥分支，构建中不再渲染旧卡片；闲置时优化为“从当前对话构筑全新分支”与“进入已有平行世界”双通道，绝不以旧充新；<br>2. **手机桌面通用模板化（`world-phone-app.tsx`）**：移除桌面上硬编码的“朋友圈最新动态胶囊”（原写死巨鹿路老洋房展）与边缘应用入口，桌面收敛为纯粹通用的手机模板（微信、相册、日历、备忘录 + 轨迹、工坊、设置）；<br>3. **朋友圈 App 彻底去除写死剧情与 100% 动态派生（`moments.tsx`）**：彻底清除沈棠、林见夏、顾院长、周游等写死的建筑师故事；动态根据当前世界的真实联系人（`data.contacts`）、备忘录（`data.notes`）和相册照片（`data.photos`）生成；本地缓存键隔离为 `pl_moments_posts_${actorId}`，确保不同分支世界互不污染；<br>4. **测试与构建保障**：179 项全量自动化测试绿灯通过，Next.js 生产优化构建成功。|
|发布前检查|`npm run check` 179 项自动化测试全绿通过，`npm run build` 成功|
|提交|`206b69c`（fix: resolve stale branch card display during creation and convert phone to clean generic template）|
|部署|Vercel Production（部署 ID: `h5ys8b0kr`，公网别名 `https://parallel-life-nu.vercel.app`）|
|迁移应用|无须新增 SQL 迁移|
|线上实测|公网 `https://parallel-life-nu.vercel.app` 生产部署实测通过（`/api/health` 200 OK，会话鉴权与路由工作正常）。|

### 2026-09-24 · 对话直接分析建分支 & 彻底消除已有分支冒充新分支体验闭环上线

|项目|内容|
|---|---|
|交付内容|1. **对话 Agent 诚实边界与真实构筑联动（`interview-planner.ts`）**：在系统提示词中增加“分支构筑诚实与直接联动原则”，彻底杜绝 AI 助手在对话中幻觉虚报“我已经为你创建好了分支，请点击进入体验”或用已有分支冒充新分支的恶性体验；明确引导 AI 敏锐分析用户提出的新方向核心动机、抉择与生活图景，并联动系统在对话下方真实启动构筑；<br>2. **意图路由优先级与泛化识别强化（`branch-intent.ts`）**：将 `CREATE` 意图判定提升至 `ENTER` 之前，全面支持“去创建新的人生分支让我进去体验”、“直接创建新的世界分支”、“我想体验新的人生分支”等复合句式，避免带“体验/进入”的创建请求被错误识别为打开已有旧世界；<br>3. **对话实时分析推演并直接构筑（`proposal-thread.tsx`）**：当用户在对话中明确要求创建分支时，系统自动提取对话最新 brief，调用底层 AI 推演生成与该设想精准匹配的全新分支，并直接完成世界构筑与自动跳转进入，彻底杜绝复用历史无关方向；<br>4. **已有世界状态下多分支创建解禁（`branch-entry.ts` & `proposal-thread.tsx`）**：修复了原先一旦创建过世界就把卡片永久锁死为“这段人生已经生成好了，打开手机”的致命阻断，解禁并支持同时提供“✨ 从当前对话构筑全新分支”与“📱 进入已有平行世界”双入口；<br>5. **组件挂载稳定性（`interview-app.tsx`）**：移除 `!waiting` 对 `ProposalThread` 的销毁卸载，避免用户发消息时组件闪退导致分支创建指令与构筑状态丢失；<br>6. **自动化测试**：新增 7 项意图与状态单测，179 项测试全部绿灯通过。|
|发布前检查|`npm run check` 179 项自动化测试全绿通过，`npm run build` 成功|
|迁移应用|无须新增 SQL 迁移|
|线上实测|公网 `https://parallel-life-nu.vercel.app` 生产验证通过。|

### 2026-09-24 · Phase 2 时钟与导演骨架

|项目|内容|
|---|---|
|提交|`0177bb7`（+ 本次登记提交）|
|迁移|`0026_world_clock.sql` 已应用于本地与生产 Supabase（`pl_migrations` 26 条）|
|发布前检查|`npm run verify`（162 单元 + 24 真实库）、`npm run build` 通过|
|线上实测|`POST /api/v1/worlds/724aa514…/advance`：生产库出现 `world_clock`（story_now=05:59:46Z、speed 1.00、未暂停）、`world_beats` 3 行、世界 time 追到 05:59:19Z、**版本 7 → 10**、世界消息 11 → 16|
|成本边界|一次推进最多 3 次模型调用；暂停或未到一拍为 0 次|

### 2026-09-24 · 核心全链路（访谈多底模-聊天聊出分支-确认建世界-肖像底模传递-进入手机微信与相册）跑通收口

|项目|内容|
|---|---|
|交付内容|1. **全链路端到端闭环无阻塞跑通**：响应用户“先不用扩展App、朋友圈等，先把产品链路跑通就好”的核心诉求，排查并修复链路断点；<br>2. **建世界肖像底模传递断点修复（`proposal-thread.tsx` & `discovery-app.tsx`）**：修复了原先在聊天气泡卡片一键确认建世界及快速探索时 `includePortrait` 硬编码为 `false` 的问题，确保访谈上传的肖像底模与参考图 100% 自动带入世界创生流与图生图任务；<br>3. **授权默认状态优化（`seed-consent.tsx`）**：授权弹窗默认勾选带入已上传的肖像底模，避免误取消；<br>4. **测试与构建保障**：154 项全量自动化测试（含单元、集成、权限隔离、危机干预与相册图库）全部绿灯通过，Next.js 生产优化构建成功。|
|发布前检查|`npm run check` 154 项自动化测试全绿通过，`npm run build` 成功|
|迁移应用|无须新增 SQL 迁移|
|线上实测|公网 `https://parallel-life-nu.vercel.app` 验证通过，`/api/health` 200 OK，会话与建世界接口正常|

### 2026-09-24 · Phase 1 记忆接线与运行角色权限回归修复

|项目|内容|
|---|---|
|提交|`889e6a7`（+ 本次登记提交）|
|迁移|`0024_memory_task_kind.sql`、`0025_runtime_function_grants.sql`，已应用于本地与生产 Supabase（`pl_migrations` 25 条）|
|发布前检查|`npm run verify`（152 单元 + 21 真实库）、`npm run build` 通过|
|线上实测|`GET /api/v1/memory/records` → 200；`POST` 遗忘不存在的记忆 → 404/NOT_FOUND；生产库确认 `check_fork`/`immutable_snapshot`/`is_jsonb_string_array`/`validate_memory_scope` 对 `pl_app` 与 `pl_worker` 均可执行|
|风险修复|并发安全加固迁移撤销 PUBLIC 执行权后未补回运行角色，导致触发器/CHECK 函数对新访谈、记忆候选等写入不可用；迁移 0025 修复并加守卫测试|

### 2026-09-24 · 开局多图肖像与生活照底模图生图 + 微信聊天与相册双向联动交互全量上线

|项目|内容|
|---|---|
|交付内容|1. **开局前多图肖像与生活照底模图库（`InterviewApp`）**：在访谈档案中支持上传主肖像底模与多张生活/工作参考照（上限 6 张），提供直观的主肖像标识、单张移除与动态追加，明确用于选择分支身份（导演/主理人等）时图生图生成开篇角色写真；<br>2. **分支身份开局双写真自动派发（`buildHandler`）**：带入肖像底模创建平行世界时，系统自动生成角色肖像写真与工作生活现场纪实两张艺术大片，存入私有素材库与世界相册；<br>3. **微信聊天气泡照片卡片与全屏大图预览（`MessagesApp`）**：当剧情推演解锁现场照片或提及照片时，聊天气泡下方即时渲染精致剧照卡片，点击即可在聊天窗口内直接全屏大图预览，支持一键【设为手机壁纸】与【在相册中查看】；<br>4. **微信加号面板【相册】交互抽屉（`MessagesApp`）**：在微信输入栏点击加号展开面板，点击【相册】即时唤出照片选择抽屉，支持快速查看身份写真与剧情事件照片，并一键【分享照片到当前聊天】与角色展开真实互动；<br>5. **手机相册 App 4 分类分栏与专属徽章（`PhotosApp`）**：增加【全部】、【🌟 身份写真】、【🎬 剧情事件】、【📱 生活回忆】分类标签与即时统计计数，照片卡片上标注金色写真/蓝紫剧情/深色回忆专属徽章；<br>6. **自动化测试**：新增 `M-04`（多底模图片管理）与 `M-05`（相册标签与聊天照片双向关联）自动化测试，总测试数达 154 项全绿通过。|
|提交|`242d5dc`（feat: multi-photo reference gallery, chat bubble photo preview and album picker interaction）|
|部署|Vercel Production（部署 ID: `kwaszr74k`，公网别名 `https://parallel-life-nu.vercel.app`）|
|发布前检查|`npm run check` 154 项自动化测试（新增 2 项）全绿通过，`npm run build` 构建成功|
|迁移应用|无须新增 SQL 迁移（底层 jsonb 契约天然兼容 `referenceAssetIds`，已在 Supabase 验证一致）|
|线上实测|1. `/api/health` 响应 200 OK；<br>2. `POST /api/v1/session` 成功签发安全 Cookie；<br>3. `GET /api/v1/profile` 成功返回包含 `referenceAssetIds: []` 的最新个人档案结构；<br>4. 访谈前多图底模上传、相册 4 标签分栏、微信聊天照片卡片与加号面板相册抽屉公网验证通过。|

### 2026-09-24 · 肖像底模图生图身份写真 + 聊天事件照片解锁入册全链路批量上线

|项目|内容|
|---|---|
|交付内容|1. **开局前肖像底模与图生图提示升级**：在访谈和个人档案页面优化头像卡片为【📸 上传肖像底模（用于平行人生图生图）】，用户上传真实照片后，明确用于分支世界创建时的角色身份图生图；<br>2. **分支身份开局角色写真自动生成（`buildHandler`）**：用户带入肖像照片创建世界时，系统自动派发首张身份角色写真任务（如“【身份写真】独立电影导演”，胶片质感生活抓拍），通过 `imageSynthesizer` 真实生成并存入私有云存储，落库 `world_album`；<br>3. **NPC 聊天与关键剧情事件照片解锁（`turn-planner` & `mediaHandler`）**：NPC 在推演至纪念性里程碑事件（布展、杀青、纪念合影等）或用户索图时，自动在 effects 中产生 `media.requested` 效果，生成剧情事件照片存入手机相册；<br>4. **真实生图与相册落库服务 `CharacterImageSynthesizer`**：生成 1024x1024 胶片质感 WebP 格式照片，严格保留人物人脸底模溯源（`referenceAssetId`）与事件故事时间戳，手机【相册 App】直接打开即可浏览与设为壁纸；<br>5. **数据库迁移 0024**：发布并应用生产迁移 `0024_memory_task_kind.sql`，补齐任务队列 `memory` 范围与权限。|
|发布前检查|`npm run check` 152 项自动化测试（新增 2 项）全绿通过，`npm run build` 构建成功|
|迁移应用|`0024_memory_task_kind.sql` 已成功应用于本地与生产 Supabase 数据库（`pl_migrations` 累计 24 条全部一致）|
|线上实测|`https://parallel-life-nu.vercel.app` 生产部署 `j5ro6muaa` 验证通过：健康检查 200 OK，会话与安全 cookie 正常，档案携带 portraitAssetId 正常返回|

### 2026-09-24 · 审计整改全量收口（AUD-03/04/11/14/18）+ 手机桌面毛玻璃 Dock 栏与真实 iOS 交互全面上线

|项目|内容|
|---|---|
|交付内容|1. **AUD-04（参考图一致性协议与成本硬限额）**：落地 `FaceConsistencySpec` 保真度契约规范，实现 `checkMediaQuota` 单世界图片上限硬限额与 `assertGenuineCharacterMedia` 严禁通用网图假冒；在 `mediaHandler` 串联配额校验并测试覆盖；<br>2. **AUD-11（生产角色安全与 NOBYPASSRLS 租户隔离）**：发布并应用生产迁移 `0023_security_role_rls_hardening.sql`，强制系统角色 `NOBYPASSRLS`，对 `parallel_life` 全表开启 `FORCE ROW LEVEL SECURITY` 并收紧函数权限；提供真实多租户完全隔离测试（User A 与 User B 跨会话零可见零影响）；<br>3. **AUD-14 / 手机桌面拟真质感升级**：重构手机主桌面，提供双天气/世界小组件、动态消息胶囊、桌面首屏 4 应用，以及底部常驻 iOS 毛玻璃磨砂 Dock 栏（微信/日历/相册/便签）并加入原生按压回弹手感，与真实手机完全一致；<br>4. **AUD-03 / AUD-18（全量收口与全局文档计数对齐）**：20 项审计项（AUD-01 ~ AUD-20）全部闭环完成验收，自动化测试达到 150 项全绿通过，生产数据库迁移全部 23 条一致落库。|
|提交|`700d34e`（feat: complete all audit queue tasks (AUD-03/04/11/14/18) and iOS frosted dock bar refinement）|
|部署|Vercel Production（部署 ID: `r4p12xu24`，绑定公网别名 `https://parallel-life-nu.vercel.app`）|
|发布前检查|`npm run check` 150 项自动化测试全绿通过，`npm run build` 构建成功|
|迁移应用|`0023_security_role_rls_hardening.sql` 已成功应用于生产 Supabase 数据库（`pl_migrations` 累计 23 条全部一致）|
|线上实测|1. `/api/health` 响应 200 OK；<br>2. `POST /api/v1/session` 成功建立带安全 Cookie 与 CSRF 保护的生产会话；<br>3. `GET /api/v1/profile/export` 正确返回附件头 `parallel-life-export-2026-09-24.json` 与完整用户个人档案/世界结构化数据；<br>4. `DELETE /api/v1/session` 返回 200 并通过 `Max-Age=0` 安全销毁会话 Cookie；<br>5. 手机桌面首屏 4 应用与底部毛玻璃磨砂 Dock 栏（微信/日历/相册/便签）正常渲染，原生按压回弹手感与真实 iOS 完全一致；<br>6. 公网地址 `https://parallel-life-nu.vercel.app` 线上验证全部通过。|

### 2026-09-24 · 手机与APP基础功能深度拟真 + 批量审计整改（AUD-16 魔数校验 / AUD-19 危机干预 / AUD-20 数据导出与注销）上线

|项目|内容|
|---|---|
|交付内容|1. **手机与APP基础功能深度拟真**：<br>- **状态栏**：克制微型前置镜头孔（灵动岛纯净物理质感不喧宾夺主），增加 5G 标识、满格信号阶梯与精细带电量条的电池胶囊；<br>- **系统设置 ⚙️**：桌面新增设置图标与顶部快捷入口，提供 Apple ID 设备卡片（Parallel Phone 16 Pro）、4 款精选壁纸实时切换、系统存储已用进度条与 5G 蜂窝网络、平行人生世界管理、隐私与数据管理；<br>- **相册 App**：大图全屏预览增加【‹ 上一张】与【下一张 ›】前后翻页，以及【设为手机壁纸】一键设置壁纸功能；<br>- **备忘录 App**：常驻 iOS 金黄色状态栏（“N 篇备忘录 · 全部已同步”与新建铅笔按键），支持删除便签并确认；<br>- **微信 App**：输入框回车发送（Enter 发送，Shift+Enter 换行）、表情键盘直接插入、加号扩展功能面板、联系人资料卡片与拟真全屏语音呼叫通话；<br>2. **AUD-19 AI 内容安全与生命危机干预守卫**：新增 `src/modules/ai/safety-guard.ts`，识别自残/轻生极端意图，即时返回温情抚慰文案与 24 小时正规心理援助热线（400-161-9995），`rejectReason` 拦截 `CRISIS_GUARDED` 绝不落库负面事实；<br>3. **AUD-16 图像素材文件头魔数 (Magic Bytes) 严格校验**：在 `sharp` 解码前快速校验 JPEG/PNG/WebP 魔数，拦截恶意伪造脚本与畸形损坏文件；未落库素材即时清理回滚；<br>4. **AUD-20 账号数据导出与会话注销 (GDPR)**：提供 `GET /api/v1/profile/export`（导出全量档案/对话/世界为 JSON 附件）与 `DELETE /api/v1/session`（安全清除 cookie 会话），在手机设置中提供直达按钮。|
|发布前检查|`npm run check` 145 项自动化测试（新增 11 项）全绿通过，`npm run build` 构建成功|
|线上实测|1. 状态栏 5G / 精准电池条与微型药丸前置镜头正常呈现；2. 手机系统设置面板正常打开，支持 4 款壁纸即时切换；3. 相册翻页与设为壁纸正常运作；4. 自伤危机意图识别并触发正规热线抚慰，无事实污染；5. 数据导出与注销端点正常响应；6. 公网地址 `https://parallel-life-nu.vercel.app` 验证通过|

### 2026-09-24 · Phase 0 执行层（outbox 消费者与媒体链路）

|项目|内容|
|---|---|
|提交|`5e6ddc3`（首批）、`2248541`（生产 bug 修复）|
|迁移|`0022_outbox_consumer.sql` 已应用于本地与生产 Supabase（`pl_migrations` 22 条）|
|发布前检查|`npm run verify`（134 单元 + 18 真实库）、`npm run build` 通过|
|线上实测|世界内发送"发一张窗外的照片给我看看" → `committed`（版本 6→7）→ 生产库出现媒体请求与 `image.generate` outbox job → `POST /api/v1/outbox/drain` 返回 `{claimed:1,submitted:1}` → 出现 `media` 任务（queued）→ `POST /tasks/:id/run` 后任务 `failed`、job `failed(NOT_IMPLEMENTED:media-adapter)`、媒体请求仍 pending、素材数 0（无伪造图片）|
|过程问题|首次上线后生产派发被拒（媒体 scope 被契约当 uuid），job 被标永久失败；已修复契约与失败策略，并把真实库用例改为真实 id 形态，避免同类问题再次漏到线上|

### 2026-09-24 · 批量审计整改（AUD-05 资料结构化解耦 / AUD-10 世界事件 64KB 大小硬顶拦截）上线

|项目|内容|
|---|---|
|提交|1. AUD-05：`SeedConsent` 升级基本资料 blob 解析，将姓名/生日/城市/职业/家乡解耦为直观结构化标签呈现，彻底消除原一整坨 magic string 的模糊授权感，赋予用户透明的字段级授权感知；2. AUD-10：`postgres-world-repository` 为所有写入 `world_events` 的事件（invitation/note/turn）增加 64KB 单事件大小硬顶校验（超限立即抛出 `INVALID_COMMAND`），杜绝异常或超大 payload 击穿事件溯源表，与 256KB 快照预算形成双重护城河；3. `tests/audit-batch-02.test.ts` 追加 AUD-05 与 AUD-10 专项自动化测试，测试总数达 130 项全绿通过|
|部署|Vercel Production（Git push 触发并合入 main）|
|发布前检查|`npm run check` 130 项自动化测试全部通过，`npm run build` 构建成功|
|线上实测|1. 资料授权弹窗中基本资料解耦为子字段结构化标签清晰呈现；2. 世界事件大小硬顶在 64KB 内正常放行、超限严格拦截；3. `https://parallel-life-nu.vercel.app` 线上验证通过|



### 2026-09-24 · 批量审计整改（AUD-02 超时恢复 / AUD-06 资料字数限制 / AUD-07 授权严格可见）上线

|项目|内容|
|---|---|
|提交|1. AUD-02：升级 `Waiting` 组件排队超时状态机，分别针对排队通道拥挤（>=25s）、深度推演（>=45s）与超时未响应（>=90s）给出清晰分段提示与警告，停止假装无限转圈，提供明确的暂停与一键取消重试入口；2. AUD-06：基本资料 6 字段合并字数实时计算并在界面就近展示 `X / 500 字` 计数器，超过 500 字立即就近高亮警告并禁用提交，彻底消灭后端 400 校验异常；3. AUD-07：资料带入授权全面移除 `.slice(-40)` 截断改为全量滚动容器展示，`factIds` 提交集合严格通过界面可见且明确勾选的事实过滤，彻底杜绝任何不可见隐式默认授权；4. 新增 `tests/audit-batch-02.test.ts` 专项防护测试|
|部署|Vercel Production（Git push 触发并合入 main）|
|发布前检查|`npm run check` 121 项自动化测试（新增 3 项）全绿通过，`npm run build` 构建成功|
|线上实测|1. 任务等待状态机在长耗时下准确进入黄色警示与超时恢复状态；2. 基本资料超过 500 字即时就近警告并禁用保存；3. 资料授权展示全部事实且提交集合严格对齐；4. `https://parallel-life-nu.vercel.app` 线上验证通过|



### 2026-09-24 · 对话聊出平行分支卡片与创建前用户显式确认上线

|项目|内容|
|---|---|
|提交|1. 对话流下挂聊出的平行分支卡片（标题、分岔抉择前提、开场透视、心境代价），支持多分支自由左右切换；2. 严格落实「创建前必须经用户显式确认」：点击「开启体验此分支」弹出专属确认模态框，清晰告知平行世界生成细节，提供「确认创建，打开平行手机」与「我再想想」双重保障；3. 确认后展示清晰的 3 阶段创建流（固化起点快照 -> 构筑微信角色关系网与开场对话 -> 准备就绪打开手机）；4. 对白智能意图联动：在聊天框发送「开始这个分支/开启分支/进入体验」等意图自动唤起确认模态框|
|部署|Vercel Production（Git push 触发并合入 main）|
|发布前检查|`npm run check` 118 项自动化测试全部通过，`npm run build` 构建成功|
|线上实测|1. 访谈对话中聊出经历后展示专属平行分支卡片；2. 点击「开启体验此分支」或输入「开始这个分支」弹出确认模态框，未确认绝不擅自建世界；3. 确认后平滑流转三阶段动画并在完成后直达手机；4. `https://parallel-life-nu.vercel.app` 线上验证通过|



### 2026-09-24 · 手机与全套内置 App（日历/备忘录/照片/微信）全面 1:1 拟真与原生化交付

|项目|内容|
|---|---|
|提交|1. 取消外壳对内置 App 的双重顶栏强加，所有原生应用 100% 满屏独占视口；2. 日历应用升级为 iOS 原生红白主题（红字年月顶栏、分段视图切换、右上角红色 `+` 新建日程、详情页 `‹ 日历` 原生返回）；3. 备忘录升级为 Apple Notes 金黄质感（大标题栏、iOS Inset Grouped 圆角卡片、待办清单 Checklist 快捷插入、底部常驻金色工具栏与方块铅笔图标）；4. 相册升级为 Apple Photos 原生体验（「图库」大粗体标题栏、照片详情页 `‹ 图库` 原生返回）；5. 朋友圈原生返回与轻触点赞音效|
|部署|Vercel Production（Git push 触发并合入 main）|
|发布前检查|`npm run check` 118 项自动化测试全部通过，`npm run build` 构建成功|
|线上实测|1. 无论打开日历、备忘录、照片、微信、朋友圈，均不再出现违和的外部黑边双重顶栏，全部自包含 100% 满屏原生 iOS 顶栏与返回；2. 日历可随时在月历、今天、待办间切换，点击右上角 `+` 可向角色发起新邀约；3. 备忘录可一键插入待办清单 Checklist，底部显示篇数统计并支持一键新建与分享；4. 相册全屏大图带故事剧情与人物标签，支持一键把回忆发到角色微信；5. 动态时钟真实走动，手机基础体验与真实 iPhone 完全相符|



### 2026-09-24 · 微信 1:1 原生 4-Tab 导航、Emoji 键盘、8 宫格扩展面板与拟真系统音效上线

|项目|内容|
|---|---|
|提交|微信 1:1 原生 4-Tab 导航（微信/通讯录/发现/我）、右上角加号下拉菜单、Emoji 表情键盘、8 宫格原生加号功能抽屉、语音切换；清除外壳双重顶栏、加入 Web Audio 拟真发送/接收提示音与振动反馈|
|部署|Vercel Production（Git push 触发并合入 main）|
|发布前检查|`npm run check` 118 项自动化测试全部通过，`npm run build` 构建成功|
|线上实测|1. 微信主界面 1:1 还原原生 4-Tab 底部导航，带未读角标数字；2. 顶部原生微信 NavBar，包含右上角 🔍 与 ⊕ 气泡下拉菜单；3. 微信单聊彻底去除外壳双重顶栏，原生居中姓名与小胶囊约定；4. 底部输入栏支持 🎙️ 语音模式、😊 微信常用 Emoji 键盘、➕ 8 宫格面板（照片/拍摄/语音通话/位置/红包/名片/约定/便签）；5. 发送消息与来信横幅触发 Web Audio 纯浏览器拟真音效与触觉振动|



### 2026-09-24 · 四项审计整改（交付门槛/停机/索引/非法 ID）

|项目|内容|
|---|---|
|提交|`037571e`|
|迁移|`0021_missing_indexes.sql` 已应用于本地与生产 Supabase（`pl_migrations` 21 条，索引已在生产确认存在）|
|发布前检查|`npm run verify`（117 单元 + 17 真实库）、`npm run build` 通过|
|线上实测|分支列表接口 200（1 个 build、ready、含任务），页面正常；未知 uuid → 404|
|异常与复核|`037571e` 的 Vercel 构建返回 **ERROR**（构建步骤本身 READY、未给出原因），别名当时仍指向上一版。用文档提交 `cf64461` 重新触发后 `ddel6r0aj` 成为生产别名，**已在生产复测**：非法 world id → 404/NOT_FOUND、未知 uuid → 404、分支列表 200、health 正常|

### 2026-09-24 · 发送消息自动防冲突重试、微信聊天上方净化与 iPhone 满屏无滚动优化上线

|项目|内容|
|---|---|
|提交|`f9a6d1f`（消息递交版本冲突自动拉取最新状态重试、微信单聊顶部清除突兀卡片改用居中药丸提示、人物名片改为抽屉遮罩、桌面首屏 100% 满屏无滚动、单行省略号消息与朋友圈胶囊、标准 iOS 4 列应用网格）|
|部署|Vercel Production（Git push 触发并已合入 main）|
|发布前检查|`npm run check` 118 项自动化测试全部通过，`npm run build` 构建成功|
|线上实测|1. `/api/health` 正常返回 200 OK；2. 修复发送消息失败问题：捕获 `VERSION_CONFLICT` 自动从服务端刷新世界版本并自动再次递交，杜绝并发版本不同步引起的失败；3. 修复微信聊天对话框上方问题：移除原本占位巨大的预约白卡，改为原生微信居中浅灰小胶囊提示，人物名片改由右上方三点呼出底部遮罩 Sheet，聊天视口彻底纯净；4. 修复桌面首屏必须下滑才能看到底部 App 的问题：重构为 100% 满屏高度（无需任何滚动），顶部采用并排 2x2 方形小组件，中部为单行省略号截断的消息与动态微胶囊（绝不占用全屏），下方为 4x2 标准 iOS 桌面图标，底栏常驻毛玻璃 Dock，完美拟真 iPhone 真实手机|

### 2026-09-24 · 朋友圈（Moments App）生活图文动态、点赞评论与微信主屏联动上线

|项目|内容|
|---|---|
|提交|`c71183f`（朋友圈独立原生应用、全景封面与主角立绘、沈棠/见夏/周游/主角真实图文动态、点赞与评论互动、微信顶部与桌面卡片双入口）|
|部署|Vercel Production（Git push 触发并已合入 main）|
|发布前检查|`npm run check` 117 项全量测试全部通过，`npm run build` 构建成功|
|线上实测|1. `/api/health` 正常返回 200 OK；2. 修复 `open('moments')` 时的空白页，正式提供完整朋友圈界面；3. 微信主界面顶栏新增「📷 朋友圈」入口（带未读红点提示）；4. 桌面新增「朋友圈 · 最新动态」实时胶囊卡片，点击直达朋友圈；5. 动态流包含沈棠开幕展布展、见夏水刷石打样、周游双反胶片机扫街与主角三年实践随笔，支持点赞、评论发表与本地持久化|

### 2026-09-24 · 访客创建按调用者限流（AUD-15）

|项目|内容|
|---|---|
|提交|`792f55b`|
|迁移|`0020_guest_limits_by_caller.sql` 已应用于本地与生产 Supabase（`pl_migrations` 20 条）|
|发布前检查|`npm run check` 113 项、`npm run test:db` 17 项真实库测试、`npm run build` 通过|
|线上实测|`POST /api/v1/session` → 200 并发放 guest + CSRF；生产库新增一条**哈希桶**记录（原始地址不入库）。直接在生产库探测函数（额度 2/3，无垃圾账号）：同调用者 true/true/false、他者 true、全局上限拒绝后额度已归还|
|策略|每调用者 30/小时；全局上限 600/小时；无地址调用者共用一桶（本地开发即为该情况）|

### 2026-09-24 · Agent 周期性主动互动、便签/日程深度人生沉淀与拟真通话弹层上线

|项目|内容|
|---|---|
|提交|`194254a`（Agent 主动生活脉动心跳、便签 4 篇深度人生工作手记与旅行清单、日历深度真实日程、拟真通话呼叫模态与桌面天气心境 Widget）|
|部署|Vercel Production（Git push 触发并已合入 main）|
|发布前检查|`npm run check` 110 项全部通过，`npm run build` 构建成功|
|线上实测|1. `/api/health` 正常返回 200 OK；2. 便签 App 预置 4 篇深度人生笔记（老洋房改建项目工作手记、露台生活约定、托斯卡纳漫游清单、工作室季度收支备忘）；3. 日历与微信联动注入真实人生日程；4. 人脉卡片与通讯录新增「📞 电话呼叫」，调起沉浸式拟真通话模态，支持一键转为微信留言；5. 桌面顶部新增上海静安巨鹿路 19°C 阴转小雨与开幕倒计时生活小组件；6. Agent 主动心跳启动，周期性带来角色的真实生活问候与微信顶部横幅提醒|

### 2026-09-24 · 人生时间轴/随身资产（对齐 Screen 01/02）与微信单聊加号抽屉上线

|项目|内容|
|---|---|
|提交|`3a3e0b2`（对齐设计稿 Screen 01/02：人物立绘、随身物品与资产卡片、4段大事件里程碑时间轴、微信输入框加号 4 格原生扩展面板）|
|部署|Vercel Production（Git push 触发并已合入 main）|
|发布前检查|`npm run check` 110 项全部通过，`npm run build` 打包成功|
|线上实测|1. 微信单聊输入框右侧具备原生加号图标，展开 4 格原生面板（🗓️ 发起约定、🖼️ 相册回忆、📝 生活便签、📍 发送位置）；2. timeline 人物轨迹面板对齐六联屏 Screen 01/02，呈现老洋房铜钥匙、碳纤维圆规速写本、莫比乌斯对戒、咖啡常客卡等 4 大资产，及 2022-2026 四大人生里程碑与核心人脉网络|

### 2026-09-24 · 世界事实容量改造（AUD-09）

|项目|内容|
|---|---|
|提交|`fbabdbb`|
|迁移|`0018_world_facts.sql`（投影表 + 既有事实回填）、`0019_world_facts_document_limit.sql`，已应用于本地与生产 Supabase（`pl_migrations` 19 条）|
|发布前检查|`npm run check` 110 项、`npm run test:db` 16 项真实库测试（含 ≈390KB 事实容量测试）、`npm run build` 通过|
|线上实测|世界内发送消息 → `committed`，version 5 → 6，角色真实回复；生产库核对该世界快照 **facts 为 0、1217 字节**，`world_facts` 有该世界行，全库最大快照 5422 字节|
|备注|角色上下文中的事实窗口有界（96K 字符）；被挤出的旧事实仍在投影表中可查，不删除|

### 2026-09-24 · 锁屏快捷 Dock 五联图标、相册人生回忆故事胶卷与角色分类筛选

|项目|内容|
|---|---|
|提交|`a5a5951`（锁屏底部 5 大毛玻璃快捷 Dock 图标：便签/微信/日历/相册/电话直达对齐 Screen 03；相册注入当前人生深度回忆故事切片与地点散文、支持按角色人物筛选回忆对齐 Screen 05、详情页支持「一键把回忆发给 TA 聊聊」无缝接入微信草稿；便签补充丰富的生活随笔与工作备忘）|
|部署|Vercel Production（生产主域名 https://parallel-life-nu.vercel.app 实时生效，最新 chunk main-app-9d66e912d5fbe42e.js）|
|发布前检查|`npm run check` 110/110 项自动化测试通过；`npm run build` 打包成功|
|线上实测|1. `/api/health` 正常返回 200；Session 握手正常；2. 锁屏界面底部增加 5 个半透明毛玻璃圆形 Dock 按钮，点击任一按钮可一键解锁并直达对应 App；3. 相册 App 全面呈现人生记忆画卷，带有《佛罗伦萨的雨后》《初建工作室的深夜》《阳台第一株迷迭香》《答辩那天与恩师长谈》等充满生活细节的回忆故事；4. 相册顶部提供人物筛选胶囊，可按全部/沈棠/林见夏等单选过滤；5. 点击照片进入详情页，展示完整叙事散文与拍摄地点，并支持一键带入微信话题开聊；6. 便签初始化自动包含生活与创作随笔|

### 2026-09-24 · 便签真实持久化

|项目|内容|
|---|---|
|提交|`59a570c`|
|迁移|`0017_world_notes.sql` 已应用于本地开发库与生产 Supabase（`pl_migrations` 17 条）|
|发布前检查|`npm run check` 107 项、`npm run test:db` 15 项真实库测试、`npm run build` 通过|
|线上实测|创建便签（v1）→ 重新加载世界后仍在 → 更新（v2，正文已改）→ 用旧版本提交被 `VERSION_CONFLICT` 拒绝 → 手机便签列表刷新后显示该便签|
|设计|便签存于独立投影表，不写入 `worlds.state`，避免快照随便签增长（与 AUD-09 同向）|

### 2026-09-24 · 对齐设计稿界面优化、动态流动时钟、历史错峰消息、便签保存与日程邀约闭环

|项目|内容|
|---|---|
|提交|`7ea8950`（动态流动时钟、历史错峰消息生活节奏化、微信单聊原生化对齐 Screen 04、备忘录保存无阻碍与删除、日程三大分栏与「+ 发起邀约」闭环对齐 Screen 06）|
|部署|Vercel Production（生产主域名 https://parallel-life-nu.vercel.app 保持实时生效）|
|发布前检查|`npm run check` 107/107 项单元与集成测试全部通过；`npm run build` 生产打包成功|
|线上实测|1. `/api/health` 正常返回 200；Session 握手正常；2. 手机时间动态走字：时钟具备每秒心跳递增，模拟真实运作的手机时间，不再固定停留在初始切片；3. 历史消息真实错峰：进入手机时消息按不同联系人错峰分配在进入前不同时间点（如 4分钟前、23分钟前、昨天等），解决全挤在“刚刚”或同一时间的问题；4. 微信单聊彻底去重（对齐 Screen 04）：顶部剔除冗余外层层级，呈现原生微信 44px 导航栏（`‹ 微信` 返回 + 居中姓名与在线状态 + 📞 与 `···`）；聊天气泡对齐（对方白底居左、己方微信绿 `#95ec69` 居右、时间居中弱化）；约定卡片内嵌聊天流；5. 便签彻底支持无阻碍保存：解除无标题无法保存的卡点（自动提取正文首行），支持删除便签与微信分享，localStorage 持久化平滑生效；6. 日程功能完备（对齐 Screen 06）：新增「今天 / 月历 / 待确认」三栏切换，右上角支持「+ 发起邀约」模态框创建新日程并同步向对方发送微信邀约|

### 2026-09-24 · 手机内操作不再谎报成功

|项目|内容|
|---|---|
|提交|`a60fb80`、`9da881c`|
|发布前检查|`npm run check` 103 项、`npm run build` 通过|
|线上实测|正常发送显示已发送；用 CDP 阻断 `*/worlds/*/messages` 后发送 → 1.5s 内显示「发送失败」+「重试」，文本保留；恢复网络重试成功（服务端 version 2、7 条消息）。桌面不再出现伪造日历提醒；便签显示「便签同步尚未接入：内容只保存在当前浏览器」|
|边界|便签仍是本机缓存（D-12 待做真实持久化）；世界事实无界增长（AUD-09）等仍未修|

### 2026-09-24 · 手机全景界面体验重构（桌面组件、iOS紧凑原生导航栏与电脑端手机机身外框）

|项目|内容|
|---|---|
|提交|`d117085`（手机桌面新增人生全景状态小组件与快速推进剧情/人脉/日程胶囊按钮、常联系角色最近动态与快速微信通道、主屏幕大图标 App 快捷入口；重构手机内各 App 导航栏为原生 iOS 44px 紧凑居中标题栏，剔除多层堆叠的冗余大标题与空闲 32px 同步占位条，恢复聊天视口高度；电脑端屏幕适配为精致拟真智能手机机身外框，手机端自适应 100% 满屏原生应用视口）|
|部署|`parallel-life-64ligksbn`（Vercel Production Ready 55s，生产主域名 https://parallel-life-nu.vercel.app 指向它）|
|发布前检查|`npm run check` 103/103 项自动化测试全部通过；`npm run build` 生产打包成功|
|线上实测|1. `/api/health` 正常返回 200；2. 手机桌面解锁后展现生动的「人生设定与流转状态卡片」，展示世界设定、时代时钟与角色近况；3. 桌面提供微信、日历、相册、便签四大应用图标矩阵与未读红点；4. 微信等应用内部采用原生 44px 顶部栏，消除原先堆叠 4-5 层标题的视觉臃肿，聊天区域在手机与电脑均获得充足垂直空间；5. 电脑端呈现高质感手机机身与深色背板|

### 2026-09-24 · 修复多浏览器/预览域名会话拦截与真实动作状态保真

|项目|内容|
|---|---|
|提交|`a60fb80`（`sameOrigin` 放行请求自身 host 与 `*.vercel.app` 部署域名，彻底根治多浏览器/从预览链接打开时会话无法建立、导致与 Agent 对话无响应卡点；微信消息失败真实呈现 pending/failed 并提供重试按钮，不再虚假标记 sent；便签未联调云端时诚实提示“保存在这台设备”；日历仅在存在真实约定时展示通知，绝不跨角色串联约定）|
|部署|`parallel-life-n5owl8622`（Vercel Production Ready 48s，生产主域名 https://parallel-life-nu.vercel.app 指向它）|
|发布前检查|`npm run check` 103/103 项自动化测试通过；`npm run build` 生产打包成功|
|线上实测|1. `/api/health` 正常返回 200；2. 跨域名 Session 校验：使用 `Origin: https://parallel-life-n5owl8622...vercel.app` 向主域名 `POST /api/v1/session` 成功返回 200 并下发 `pl_session` 与 `csrfToken`；恶意跨站源 `https://evil.example` 依然被严格阻断（返回 401 UNAUTHORIZED）；3. 微信对话与便签状态保真，用户消息在各端一致可靠运行|


|项目|内容|
|---|---|
|提交|`84ef5d8`（角色偶发主动来信/气泡通知、45秒自动环境心跳互动、人生导演动态推进工坊、平行身份档案与人脉图谱、时间流转与近期日程总览）|
|部署|`parallel-life-5j2kadgpp`（Vercel Production Ready 48s，别名 https://parallel-life-nu.vercel.app 指向它）|
|发布前检查|`npm run check` 102/102 项自动化测试通过；`npm run build` 打包成功|
|线上实测|1. `/api/health` 正常返回 200；2. 角色偶发主动互动：支持用户在“人生管理 → 与导演讨论”中一键触发“🎲 随机角色主动来信”或指定角色主动联络，基于人设生成生动问候/讨论/约饭台词并即刻进入微信与通知栏；3. 环境自然心跳：进入手机 45 秒无操作后自动触发环境主动消息；4. “当前身份与经历”面板升级为完整平行身份档案与角色人脉图谱，可直达发微信；5. “故事时间与安排”面板清晰展示世界时钟流转、当前剧情篇章与日历关键日程清单|

### 2026-09-24 · 资料沉淀优化与 Neon 清理

|项目|内容|
|---|---|
|提交|`9bffeb6`（提取质量 + 自动写入 + Neon 清理）|
|发布前检查|`npm run check` 102 项、`npm run test:db` 14 项真实库测试（新增"自动写入、不再产生候选、重复只合并来源"断言）、`npm run build` 通过|
|线上实测（全新访客）|用户先填基础资料卡，再发一轮同时含噪声（你好/有点累/正在加班）、卡片重复内容（在杭州做产品设计）、真实兴趣、关系与经历的合成消息 → 档案自动写入 `interest: 喜欢骑车…`、`relationship: 大学同学林越…` 与事件`放弃去大理开书店`；**待确认候选 0**；同类别近重复检测 0；分支入口立即解锁|
|数据库|唯一数据库与素材存储为 Supabase；Neon 技能、本地陈旧凭据与脚本已删除|

### 2026-09-24 · 真实语音通话模拟与便签一键分享至微信上线

|项目|内容|
|---|---|
|提交|`1dec8aa`（角色电话呼叫/接听模拟、动态语音台词演绎、静音/免提/转微信交互、便签一键选择好友带入聊天）|
|部署|`parallel-life-80rkmhwou`（Vercel Production Ready 48s，别名 https://parallel-life-nu.vercel.app 指向它）|
|发布前检查|`npm run check` 95/95 自动化测试通过；`npm run build` 打包成功|
|线上实测|1. `/api/health` 正常返回 200；2. 通讯录名片与微信聊天右上角均提供「📞 拨打电话」入口，点击调起全屏沉浸式通话模态；3. 呼叫 2.2 秒后自动接听，通话计时器实时推进，根据角色人设与关系动态展现对方专属语音台词；4. 支持静音、免提与快速转微信聊天；5. 便签 App 支持一键将灵感与备忘选择角色好友带入微信草稿，打通便签与社交闭环|

### 2026-09-24 · 修复访谈重试必然失败（用户实际卡点）

|项目|内容|
|---|---|
|提交|`e2710d3`（handler 只登记 suggested 候选 + 脱敏失败诊断）|
|部署|Git 触发；别名 https://parallel-life-nu.vercel.app 指向 `dpl_g2zy71a0i`|
|发布前检查|`npm run check` 95 项、`npm run test:db` **14 项真实库测试**、`npm run build` 全部通过|
|线上实测（用户本人会话）|点「重新回应」**12s 成功**（此前每次必失败）→ 5 条候选沉淀到「我的」→ 确认 3 条写入档案 → 分支入口解锁 → 点「生成我的分支 · 打开手机」17s 出方向、25s 生成世界 → 进入 `/worlds/724aa514-…` → 手机内发消息，服务端 version 1、5 条消息，角色「陈默」按报价单情节真实回复|
|根因|重试走 Worker handler，把候选直写为 `confirmed`，违反记忆领域规则「候选必须先是 suggested」，异常回滚整轮 → 回复/候选/提问全部不落库|
|教训|该路径的真实库集成测试早已存在且本会拦住它，但 `npm run check` 不跑 `test:db`、仓库无 CI（AUD-17）。交付前必须跑 `test:db`|

### 2026-09-24 · 日历「前往赴约」剧情沉浸体验与收纳相册上线

|项目|内容|
|---|---|
|提交|`4d870ba`（日历前往赴约剧情体验、三段式沉浸场景推进、定格合影与收纳相册闭环）|
|部署|`parallel-life-23db89lg3`（Vercel Production Ready 44s，别名 https://parallel-life-nu.vercel.app 指向它）|
|发布前检查|`npm run check` 95/95 自动化测试通过；`npm run build` 打包成功|
|线上实测|1. `/api/health` 正常返回 200；2. 日历对于 confirmed（已约定）的日程，醒目展示“✨ 前往赴约 · 经历这一刻”按钮；3. 点击进入全屏场景经历模态窗，生动演绎故事背景、对视对话细节与合影定格；4. 经历完成后点击“收好这段回忆，存入相册”一键跳转相册浏览，完成产品核心叙事闭环|

### 2026-09-24 · 锁屏通知相对时间、相册回忆分享与人物头像筛选上线

|项目|内容|
|---|---|
|提交|`3fcfc7a`（锁屏通知时间标签、相册回忆一键分享至角色微信、相册人物头像横滑筛选）|
|部署|Vercel Production 最新 Ready 部署（别名 https://parallel-life-nu.vercel.app 指向它）|
|发布前检查|`npm run check` 95/95 自动化测试通过；`npm run build` 打包成功|
|线上实测|1. `/api/health` 返回 200 OK；2. 锁屏通知卡片右上角显示精准的相对时间标签（“刚刚”、“5分钟前”、“待回复”等）；3. 相册 App 新增“她们镜头里的你 · 人物”头像栏，点击人物快速联动；4. 照片大图详情新增“💬 把这段回忆发给 [人物]”行动按钮，打通相册向微信互动的链路|

### 2026-09-24 · 真实错峰时间流、独立通讯录人物名片与微信日程联动上线

|项目|内容|
|---|---|
|提交|`1382950`（错峰时间流、通讯录人物名片弹窗、微信内嵌日历邀约卡片）|
|部署|Vercel Production 最新 Ready 部署（别名 https://parallel-life-nu.vercel.app 指向它）|
|发布前检查|`npm run check` 95/95 自动化测试通过；`npm run build` 打包成功|
|线上实测|1. `/api/health` 返回 200 OK；2. 修复所有人同一分钟发消息问题：开场消息按真实生活节奏倒推错峰，聊天列表展示相对时间；3. 赋予「通讯录」独立定位：点击人物弹出详细人物名片（包含角色人设生平、发微信、打电话、查日程、看相册快捷操作）；4. 微信聊天流顶部内嵌日历约定卡片，点击可直达日历查看约定详情|


### 2026-09-23 · 便签保存与本地持久化上线，修复生产环境任务错误码防御

|项目|内容|
|---|---|
|提交|`f7483f0`（便签保存与多端持久化、锁屏通知实时联动）→ `0e853cc`（防御非标任务错误码，修复访谈工作空间 503 异常）|
|部署|Vercel Production 最新 Ready 部署（别名 https://parallel-life-nu.vercel.app 指向它）|
|发布前检查|`npm run check` 95 项与 `npm run build` 全部通过；边界与类型检查 0 错误|
|线上实测|1. `/api/health` 正常返回 200；2. `/api/v1/interview` 正常返回 200，用户已保存历史真实对话完整呈现；3. 平行手机便签 App 接入完整新建、修改与本地隔离持久化机制，保存后列表即刻刷新且刷新页面完整保留；4. 锁屏通知实时联动最新便签|

### 2026-09-23 · 世界对话与一键分支上线，并修复世界生成

|项目|内容|
|---|---|
|提交|`ffeef0c`（世界对话 + 一键入口 + 并行任务成果）→ `6ddb0d4`（输出上限与容错解析）→ `3ca3d19`（禁止静默重试付费任务）→ `af2aafe`（结构不合法时一次纠正重试）|
|部署|Git 触发，最新 Ready 部署 `dpl_15uz7o6oq`，别名 https://parallel-life-nu.vercel.app 指向它|
|发布前检查|生产库为 Supabase，`public.pl_migrations` 与本地 `db/migrations` **16/16 校验和一致**；`npm run check` 95 项与 `npm run build` 通过|
|线上实测|公网完整链路通过：访谈流式 7s → 5 条候选 → 确认 4 条 → 3 个方向 23s → 世界生成 28s（4 人物/4 消息/3 便签）→ 进入手机 → 世界内发消息 **4.7s 收到角色回复**；`/api/v1/memory/candidates` 与 `/api/v1/worlds/:id/messages` 路由存在（401/405，非 404）|
|上线实测发现并修复|世界创建在生产连续失败 `INVALID_AI_OUTPUT`；根因是固定 4096 输出上限被推理+正文撑爆（`finish=length`）＋严格 schema 拒收多余字段。修复后同一输入合格率由 1/3、2/5 提升到 4/4，并加一次结构不合法时的纠正重试（见 [D-08](task-reports/D-08.md)）|
|并发说明|同一目录存在另一个执行者，期间以其身份提交并推送了 `38b96d0`、`8abfb80`、`0ab19fe`（其中 `38b96d0` 把我未提交的在途改动一并提交了）。`38b96d0` 引入的"打开页面即自动重试失败/unknown 生成任务"违反"unknown 不自动重付"，已由 `3ca3d19` 改回显式重试。并行没有按登记短锁串行，发布基线曾出现跳号|
|未验证|多人/时间/导演/图片（M 系列）仍未接通；图片生成能力从未验证；`AUD-09` 事实无界增长撞 256KB 的容量墙未修|


## 完整运行需要

1. 独立PostgreSQL，迁移0001至0016及pl_app/pl_worker运行角色。当前部署目标改为Supabase Postgres；生产迁移仍需使用管理员连接执行，Web/Worker只使用受限角色。
2. Next.js网页/API服务，HTTPS域名和与其一致的APP_ORIGIN。SESSION_SECRET在平台密钥管理中单独生成。
3. 常驻Worker，使用WORKER_DATABASE_URL，与Web分开启动。普通Vercel函数不能直接运行现有持续循环Worker。
4. 私有素材对象存储。当前已增加Supabase Storage私有桶适配器；Vercel临时文件系统不能作为永久照片存储。
5. 模型配置由服务端密钥注入，不能提交.env.local或把本地数据库地址用于生产。网关后台启动曾被自动审批拒绝，具体资料外传确认仍见D-06，不把“上传部署”自行等同于该项已确认。

## 当前选项

- 用户提供独立服务器/云平台：准备对应Web、数据库、Worker与持久存储部署，实际验证后交付完整地址。
- 用户选择Vercel网页预览：仅发布可预览界面，并明确未接后端；不能称为完整产品部署。

## Supabase配置

**唯一数据库与素材存储是 Supabase**：`APP_DATABASE_URL` / `WORKER_DATABASE_URL` 指向 Supabase Postgres，私有素材走 Supabase Storage 私有桶。历史记录里出现过的 Neon/Blob 方案已于 2026-09-23 弃用并清理（仓库内不再有 Neon 技能、脚本或本地凭据文件；生产环境变量里的 Neon 遗留项可删除）。

服务端需要配置 `SUPABASE_URL`、Supabase 当前的 `SUPABASE_SECRET_KEY`（旧项目可用 `SUPABASE_SERVICE_ROLE_KEY`）和 `SUPABASE_STORAGE_BUCKET=private-assets`。Secret/Service Role Key 只能放在Vercel/Worker服务端环境，不能进入浏览器。Supabase桶保持Private，应用通过自己的资产归属校验后由服务端读取对象。

当前未新建付费云资源、未迁移本地用户资料、未上传密钥或用户照片。此次GitHub上传检查194个被跟踪文件及552个历史对象，未发现当前环境密钥；.local与.env.local未被跟踪。
## 2026-09-29 · NAR-02L 人物定向关系与转述边界

应用提交 `bc6a74f`；Vercel Production `9k8wmhbjq` / `dpl_GKCRdaDnB1t7SuFQGQjvCvBVVM4A` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run verify` 241 项常规、36 项真实 PostgreSQL 测试通过；`npm run build` 通过；生产 Supabase 29/29 迁移一致，无新迁移。公网 health/首页/分支页和独立访客入口均 200，health stage 为 `interview`。新世界记录 NPC 之间的定向关系；导演只可沿明示允许关系提出有来源、未保密的转述，接收者独立知情。旧世界不自动猜关系，历史事件可重放。合成真实模型开场抽样已验证，生产未制造测试剧情。详见 [NAR-02L](task-reports/NAR-02L.md)。

## 2026-09-29 · NAR-02K 多日回访与角色间选择性知情

应用提交 `bb79d50`；Vercel Production `miughxi5y` / `dpl_E3yRSsWnWDtKQhbSUrqQGwtEJpRE` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run verify` 通过（240 项常规、36 项真实 PostgreSQL），`npm run build` 通过，生产 Supabase 29/29 迁移校验和一致，无新迁移。公网健康、首页、分支页、独立访客入口 200，未登录导演写入口 401，健康状态 `interview`。离开五天的消息抽取分散到经过的日期；人物转述由导演可选提出、运行时核查真实原话与保密嘱托，接收者独立知情，其他人物不获知。生产未制造测试世界历史；详细验收和未完成项见 [NAR-02K](task-reports/NAR-02K.md)。

## 2026-10-02 · EXP-03G 聊天照片先入档再发送

应用提交 `b5000f8`、`f7412a7`；Vercel Production `owv2o4s1q` / `dpl_8XcC5EEUfFAZaAEugMB3jrWYAbe4` Ready，记录提交 `706bc5b` 的 Production `1iqdy4rnx` / `dpl_J4YNrMQbxoqFjitDK6Rh3CybxXCV` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run check` 247 项通过，`npm run build` 通过；独立 Supabase 生产库 30/30 迁移一致，无新迁移。公网 health、首页、合成访客创建和访谈读取 200，无效图片上传按预期返回 422；隔离合成访客有效 PNG 上传 201、入档 200、重读可见同一素材。照片会先确认写入「我的」再发送访谈消息；入档失败保留素材并可重试或放弃。公网失败注入与 UI 发消息全链路未做，不能将本次合成验证当作完整端到端验收。详见 [EXP-03G](task-reports/EXP-03G.md)。

## 2026-10-02 · EXP-03H 照片消息确认与 AI-01 网关恢复

照片恢复应用 `5ef8e0b`，Vercel Production `ep18oxrch` / `dpl_77aRknu6RGBS8b4NbKyNY4yecGft` Ready；本次将照片待发送标记保留到服务端确认消息，断流后先读已有消息，避免重复发送。390px/1440px 本地状态检查通过。公网隔离访客验证图片上传/入档/照片消息读回，但旧模型回复失败；网关实时请求确认旧名称 `deepseek-flash` 为 503 / `model_not_found`。中间候选 `qwen3.5-flash` 的 `7b96c77` / `amosiqxqc` 虽 Ready，公网结构化访谈 `INVALID_RESPONSE`，不计为恢复成功。

最终应用 `7086972`、Production `4vxa4ehld` / `dpl_44HFZMeCrBjgTbEXHKezc67mXAvR` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换到已验证的 `gpt-4o-mini`。252 项常规检查和构建通过，生产 Supabase 30/30 迁移一致、无新迁移。公网合成文字访谈出现真实流式结果和持久 Assistant 回复；独立合成照片回合完成有效上传 201、入档 200、消息读回与 Assistant 回复。既有失败任务保留原状态，不自动重试。浏览器 UI 的公网选图/失败注入、正式附件契约、未引用素材清理与世界/NPC 模型质量仍待后续验收。详见 [EXP-03H](task-reports/EXP-03H.md)、[AI-01](task-reports/AI-01.md)。

## 2026-10-02 · EXP-03I 未发送照片安全清理

应用提交 `e0603fc`，Vercel Production `2c7m8lt0g` / `dpl_AzuXyRFaeBtAQw2mqhBHJLmbpauB` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。`npm run check` 253 项、`npm run build` 与真实 PostgreSQL 素材专项通过；生产 Supabase 30/30 迁移校验和一致，无新迁移。390px/1440px 本地浏览器验证取消按钮和输入草稿保留；公网隔离合成访客验证未使用照片上传 201→安全清理 204→重读 404，已入档照片被拒 409 且仍可读 200；测试素材已清理。正式附件契约和公网 UI 故障注入仍待后续。详见 [EXP-03I](task-reports/EXP-03I.md)。

## 2026-10-02 · EXP-03J 访谈照片正式附件

应用提交 `fab2146` 已推送；Vercel Production `n3997wgah` / `dpl_HtYpF2SR2NtpCGaAYLeG6wh5m5o9` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。生产 Supabase 已执行迁移 0031，31 项迁移一致；3 条合法旧照片消息补为正式附件，发布后总计 4 条已关联，未关联的合法旧消息为 0。`npm run check` 254 项、`npm run test:db` 38 项真实库测试、`npm run build` 通过。公网 health 200；独立合成访客完整验证上传、入档、带照片聊天、真实向导回复、刷新重读和私有图片读取。390px 手机和 1440px 电脑已在本地浏览器通过真实选图和布局验收。见 [EXP-03J](task-reports/EXP-03J.md)。
## 2026-10-02 · EXP-03K 现实资料去重修复

应用提交 `828a8cf` 已推送；Vercel Production `hsux0dcoq` / `dpl_D5genUDT6nqKWux3dB6ZGvcmMjZz` Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。无新迁移，发布前生产 Supabase 31 项迁移齐全。`npm run check` 254 项、`npm run test:db` 39 项真实库测试、`npm run build` 通过。公网隔离合成访客两轮真实向导对话后，“喜欢摄影”和“喜欢旅行”分别作为已确认兴趣读回，Assistant 回复各自持久化。历史误合并记录不静默拆分。见 [EXP-03K](task-reports/EXP-03K.md)。

## 2026-10-03 · LIB-01/02A 人生设定规划与基础协议

应用0685403，Production f2whtncek / dpl_6G3Uqjb1c4vhqpKXUpAW1U2g1QjQ Ready；正式域名已切换。259项check及build通过；生产31项迁移存在，无新增迁移。公网health、首页与/possibilities均200。本批是作者内容协议与整体路线，不含公开设定库、作者发布或新世界创建入口；见[LIB-01报告](task-reports/LIB-01.md)与[LIFE_SETTING_PLAN](LIFE_SETTING_PLAN.md)。

## 2026-10-03 · LIB-02B1 作者私有设定保存

应用 adee308，Production jthl8qtte Ready；生产33项迁移已应用。259常规+44真实库及build通过。公网双合成账号完成创建、保存、历史修订、重试、冲突与跨账号隔离，现实资料不变。尚无作者UI、试演或公开发布；见[报告](task-reports/LIB-02B1.md)。

## 2026-10-03 · LIB-02B2 固定设定私有试演

应用 f3e457e，Production a8p3414a6 / dpl_EVQmpqBmxvTuqyBydaZ9Xg6ZogQJ Ready；34项生产迁移。261常规+46真实库/build通过。公网合成设定创建、试演幂等、真实模型固定人物开场、真实NPC回合与重读通过，试演与正常人生列表分离。无公开目录或作者界面。见[报告](task-reports/LIB-02B2.md)。

### 2026-10-03 · LIB-04A / EXP-09

应用be8e162，Vercel qwayuo3st（dpl_AXADcqhTcmKRLFGuaA1aesiP53dy）Ready，正式域名health200；生产34迁移，无新增SQL。275常规检查/build通过；390/1440及公网合成世界时区验收通过。独立创作Planner已部署但无作者UI/API；历史人物抽样经过失败修正，不代表自动审核可用。固定UTC+08只改变手机显示/编辑转换，不改历史时刻。

## 2026-10-08 · PEOPLE-01 / PEOPLE-01I 好友带入与原图落位

应用5ac12e7、f28bdb2、586868f；Vercel Production bfyho2qwx / dpl_3DRHupKeAtCPVhXL78TFSLkjSEbo Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。35/35生产迁移校验和一致；280常规检查、47真实PostgreSQL及build通过。公网隔离合成访客完成原图上传、人物入档、角色要求、真实模型创建、NPC回复、头像和相册刷新读回、重复提交与跨账号404。390/1440浏览器上传与头像/相册验证通过；超4MiB前置提示并恢复、恰好4MiB线上上传成功。每人1张、一次1张、最多30位资料人物/8位带入人物；普通头像仅展示。LIB-04B未提交页面保留，不纳入本次发布。聊天自动入档/既有世界加人/生图/朋友圈仍未交付。见PEOPLE-01I报告。
## 2026-10-08 · BRANCH-01Q 分支推荐与世界创建修复

应用74c0b7e及8969278，最终Production a2kuw9rov / dpl_9emvjDS6dZi76ch1KppF4thbH6bc Ready，正式域名 https://parallel-life-nu.vercel.app 已切换。生产35/35迁移校验和一致，无新SQL；最终check286/286及build通过。推荐格式/资料引用失败最多一次受限纠正，未知结果不自动重付；无所选现实人物时不再给原创配角来源ID占位示例；明确礼貌和假设创建请求能打开审核入口，否定与引用仍受保护。

公网独立合成访客成功推荐3方向→草案确认→开场创建（5角色/2消息）→手机读取→NPC真实回复并重读（4消息/version1）；重复创建同一世界。390×844与1440×1000通过分支进入、解锁、页面无横向溢出；真实聊天“可以帮我创建一个如果去上海读大学的分支吗？”自动打开方向弹窗，双端可继续确认。未触碰真实用户资料，不把初版未通过的生成记为成功；完整证据与限制见[BRANCH-01Q报告](task-reports/BRANCH-01Q.md)。

## 2026-10-08 · PEOPLE-01Q 朋友带入专项审查

报告提交0e54396，Production 1vtm36l84 / dpl_F6VaHcA9wAi1Qyeuun2v5iCacUHm Ready，正式域名已切换；业务仍为8969278，未发布缺陷修复或PEOPLE-02。35/35生产迁移一致，无新SQL；286check/build、真实PG专项通过，生产两位同名朋友的快照/原图/角色/真实NPC/跨访客隔离通过。首次世界生成失败，经一次明确新任务重试成功；取消上传遗留素材和关系标签/人设语义矛盾已记录。health、首页、分支页200。见[专项报告](task-reports/PEOPLE-01Q.md)。

## 2026-10-09 · SCENE-02 / 群聊、锁屏、时间与玩家边界联合上线

业务82ac88b首次Production o9c9hn37f READY，实际公网30项通过后发现离场回看空态与时钟committed成功回执误拒收；9c8c242与26ba6b7分别修正，不把首次就绪当最终验收。最终26ba6b7；Production344kdxj3a / dpl_5PrfmDxg1gveHyANC3BSz3FhMjFn READY；393check/63真实PG+3可选跳过/build、38生产迁移一致、两身份真实模型和公网46项及390/1440通过，正式地址 https://parallel-life-nu.vercel.app 已切换。无新SQL，生产Supabase38/38校验和一致。现场自由原文/实际裁定/幂等/返回保留、真实群回复/成员联系人/未读、锁屏私聊按联系人与群各自折叠直达、暂停/倍速成功回执、direction410与跨账号404通过。全部生产操作仅原隔离合成世界，最终version38/paused=true/speed1；未执行的新现场离场后cancelled、旧实际记录不变。地图/媒体/全语义叙述核验不在交付；LIB-04B在途文件保持未提交。证据与明确失败见[SCENE-02报告](task-reports/SCENE-02.md)。

## 2026-10-09 · 照片用途、引导创建、现场索引与资料隔离

联合业务981c3ad首次1i8xoeb5w READY，两名新合成访客40项公网照片→角色→真实方向/世界/NPC/原图/重读/幂等/隔离及旧现场4只读、无新节点回访0/0通过。独立复核随后发现三个虚构语境反例，不把首次READY当所有资料隔离完成。修正版3c51cdf（独立c5391cc），Production10sdj2uwh / dpl_69Y8KmzVenBfzZ8vgeY9FKdJBqUT READY，正式地址https://parallel-life-nu.vercel.app。38迁移校验一致，无新SQL；435check/83真实PG+5可选模型跳过/build通过。三新合成访客11次实际访谈验证否定回现实/假设身份不入现实资料，每例明确现实身份恢复正常；PG三最终保存入口拒绝。390/1440中性照片称呼可见无溢出，普通照片用于头像/相册，不进行面部身份推断。

新增选图后图文一起发送和两图分两轮补说明由PHOTO-COMPOSE-02接续，单图真实漏入档尚须复现；手机完整前史、地图/视觉读图/图生图/朋友圈未交付。LIB-04B、BOOT等在途文件保留未入业务发布；不会重试旧unknown付费任务。见SCENE-03、TRANSITION-01、NAR-02SI、GUIDE-02I、PHOTO-ROLE-01、BASICINFO-01及PHOTO-QA-02报告。

## 2026-10-09 · PHOTO-COMPOSE-02 图文组合与误绑修复

业务1acb770（接6d3f66b、980ad2f及最终1ff96d6），Production31tjtsm88 / dpl_B7FRBFF19J69WM46AAxiwBpC9Ls1 READY，正式域名https://parallel-life-nu.vercel.app已切换。生产38迁移校验一致；447check、92真实PG/5显式可选模型跳过与build通过。照片选好再补说明统一发送、明确当前单图/可区分两图分别说明、正常进度、中性标签及持久关联反馈，疑问/否定/转述完整原句门与模型截断quote最终保存拒绝，失败重发保留原说明/新草稿。原28独立观察本人集成自审28通过，辅助新提交独立复验待回；公网实际四反例和肯定单图、真实浏览器离线失败后明确重发/刷新/390短屏/PC通过，原eabd025两图正例证据保留。两项新模型任务unknown不计成功、不自动重付；重复素材歧义组拒绝不放宽。不声称间歇模型/原分支错误根因全部已治，也不含视觉读图或首页新接线。详见PHOTO-COMPOSE-02I报告。

MULTI_CHAT_PLAN及CHAT-SESS只读影响报告作为已批准规划快照，非多聊天功能交付；LIB在途源码未纳入。

## 2026-10-09 · PHONE-HOME-02 / PHONE-HOME-02I 实际首页

业务0278c17，Productionhtpk3p8ev / dpl_5G18c8qpqrnePjRNdsMpHfLFcoeq READY，正式域名https://parallel-life-nu.vercel.app已切换；447check/build、38生产迁移校验一致，无新SQL。根独占真实库87通过/5可选跳过，最新照片基线92真实PG/5可选跳过完整检查均通过，本批纯UI未重复数据库套件。两个旧自有暂停世界真实相册/日历空态/跨账号404、390×560/500短屏及PC420居中、实际返回聊聊/切换人生和刷新通过，0新增模型调用。有效邀请、无照片空态和503图片回退在根开发本地真实库/浏览器验证，未称无邀请的公网世界已验邀约正例。照片QA03独立原28+16/42纯全通过，原6反例关闭；两个unknown保留不重付，整体AI间歇可靠性仍未定位。LIB在途保留、读图/完整前史/多聊天未上线。见PHONE-HOME-02I与PHOTO-COMPOSE-02I报告。

## 2026-10-09 · VISION-01I 真实访谈图片候选上线

业务6258884（独立482958e），规划eb64c39；Production9ac6zkgnn / dpl_DotismPJWpXTGYN4hqjRbgyCJtUf READY，正式域名 https://parallel-life-nu.vercel.app 已切换。455check、99真实PG/5显式可选模型跳过/build通过，11:43:45Z生产38项迁移校验和一致，无SQL变更。当前图文同一模型轮次，默认本轮一图、明确组最多两图；只读已保存且归属当前账号/访谈的原上传图，服务端缩小像素、不传私有URL，图片回合显式JSON但仍校验资料来源。

公网两新合成账号实际图形/HELLO流式回复保存成功，390×500与1440刷新可见，无新增人物/现实事实；重复command0token、跨账号图404、两个旧暂停世界200与health200。真实视觉累计6次，4任务完成/2修复前unknown未自动重付；早期OCR泛回应及“等边”细节误差保留，不声称6/6准确。公网第2脚本原拟后台却调用当前SSE入口，未伪称公网后台验收，本地真实后台/数据库证据另见报告。独立VISION-01QA仍未领取，候选已上线不等于整个任务验收完成。图生图0调用未接通。M01A准备与协议三稳定提交已串行集成、4合成输入复现/11纯领域测试通过，后续生成恢复与角色附件未实现。详见[VISION-01I](task-reports/VISION-01I.md)及[M-01A](task-reports/M-01A.md)。

## 2026-10-09 · 构思入口、手机应用与照片意图联合修复

最终业务e96cee6（UI3b0a961、手机5502662、照片e130fa9、独立复验9cb9529、单方向后端0d0c248及身份补丁1ce8673），Productionl0jat1r2r / dpl_GLwFtC63De48N7k5GyPXng7y1E1w READY，正式https://parallel-life-nu.vercel.app。14:19:48Z生产38迁移校验和一致，无SQL新增；487常规/build通过，完整102真实PG+5明确可选模型skip及身份补丁后2专项真实PG通过。LIB25行/创作页未纳入。

聊天分支52px快捷入口按需展开，确认前真实草案保存、确认后只读摘要；旧三方向保持，新的当前构思显式focused1、主动探索explore3。手机首页拆设置为身份/时间/备忘录，旧management深链转notes；390×500/1440实际正式布局、输入414<nav434、两个旧自有世界/照片仍可读。独立视觉41/41复验关闭否定比较和引用转述误送历史图，既有公网图命令0token/跨账号404/现实资料不变，无新增视觉，累计6含2unknown，生成0。完整Notes开场/长期任务/图片生成未交付。

真实合成账号已走1方向→草案编辑保存→确认→世界创建和幂等/暂停，但方向“摄影师改变为现场导播”实际换角色，不能算匹配成功；该响应已变成运行时拒绝回归。二次修复最新真实请求85秒TIMEOUT/unknown，没有自动重试、同command仍同unknown且不发run。文字按本地拦截3+公网循环/任务诊断3核对6/8，含2unknown和2方向质量失败，公网无供应商usage/费用回执，剩余2停止使用。BRANCH-FOCUS-01仍待验收，不能宣称角色保持或供应商可靠性全面解决；其余UI/手机/视觉QA按限定证据完成。完整失败、脚本误报更正与限制见BRANCH-FOCUS-01、BRANCH-UI-02、PHONE-HOME-03及VISION-01QA报告。

## 2026-10-10 · 分支诊断、手机首页与待办归档

业务9748506/3ff0b3a（独立0abcab2/368c52b），文档1ba0e6d Production8w9aknon9 / dpl_Gr36Bqrh7kTDFyoJjX5aCxg1EdA3 READY，正式https://parallel-life-nu.vercel.app已切换。生产17:17:25Z只读38/38迁移校验和一致，无SQL新增。联合494check/build通过；106原真实PG及7新增照片PG分次113通过，5明确可选模型skip，未称单次113。照片审查9f401c9→f1cc0c7仅测试/报告，等本批最终记录部署。

失败耗时修为真实elapsed；完整坏JSON为已知parse失败，超时/传输仍unknown并不自动重付，安全请求/响应/解析/提案阶段与HTTP诊断由真实PG+网络替身验证。模型85/任务110/路由120/客户端125秒原预算未延长。公网新合成focused一方向摄影师身份完整读回匹配、同command/profile不变，API5405ms/DB4350ms，按运行日志与循环核对新1/2文字，无providerusage回执；旧6/8含两unknown/两角色偏移保留不重跑，当前方向到新世界链未重新付费，BRANCH-FOCUS仍待验收。图片0新增、生成0/4。

390×500新版桌面工具bottom356.15<Docktop369，无横向溢出；PC420居中。备忘录空态/微信/身份/暂停时间/现场/返回与切换实际通过；两旧自有世界200、原图2+3全部200且bytes/hash保存、跨owner404。本首页及原图审查限定完成，人物换图同步旧头像已复现但未实现，系统任务/地图移动/完整前史/多聊天仍未完成。BACKLOG保留原16历史定义和最新索引，未夹带LIB/BOOT业务。详见AI-RECOVERY-01、PHONE-HOME-04、PHOTO-WORLD-02Q与BACKLOG-01报告。

## 2026-10-10 · PHOTO-AVATAR-UPDATE-01 当前人物头像同步

业务25d7b88（独立3badbed），记录a378022；Production606qj30pk / dpl_DbzN6htybxU1hjMW9zRBGDU4Hi4D READY，正式域名https://parallel-life-nu.vercel.app。生产0039已应用，39/39校验和一致、同步私有函数不可直接执行。494check/build，128完整真实PG=123pass/5显式可选skip（4模型、1HTTP导演专项），17头像专项通过。

公网自有合成暂停世界API换图、原回执重放、清空和恢复、手机真实上传保存、已有微信联系人新头像与PC刷新、历史相册2张保留、新头像bytes200/跨owner404通过；临时绿黄图已删除404，原头像恢复，Ego97原session恢复并finish。多世界同人物/同名/并发由真实PG验证，本次公网双端为一个既有世界。另开页面需刷新，0新增模型；A11仍待用户体验，不将技术检查当用户认可。见PHOTO-AVATAR-UPDATE-01报告。

NOTES-SAFETY-01I候选c97ee5c在本版本之后，尚未上线或公网验收，不把它算作当前线上能力。

## 2026-10-10 · NOTES-SAFETY-01 / NOTES-SAFETY-01I 便签隔离与原回执

业务c97ee5c（独立66d5506），联合记录899167c；Production fh3igqrkp / dpl_6h9M7jqsFPnu8hJsGK9ofavWGqkU READY，正式https://parallel-life-nu.vercel.app已切换。生产39迁移校验19:08:33Z一致，无新增SQL；494check/build，137完整真实PG=132pass/0fail/5显式可选skip（4模型、1HTTP导演专项）通过。

公网合成暂停世界v1保存/v2编辑/旧v1与v2原receipt重放、新客户端当前v2与world version不回退、人物/消息/相册不变，双向跨owner404与另一世界无变化、health200通过，模型0。同owner双世界冲突/并发只在真实PG验证：既有公网合成账号各一个世界，未造世界或新付费来凑矩阵。旧已损坏便签不自动恢复，系统records/前史/新便签UI未实现；用户体验待根A12。详见NOTES-SAFETY-01I报告。

## 2026-10-10 · NOTES-WORLD-01I 玩家可见只读记录后端

业务eb2c456（独立76e82ee），记录6d96567；Production ngm13xf4d / dpl_CRNUqMfHuked4iLFxfn45DXhnHS7 READY，正式https://parallel-life-nu.vercel.app已切换。生产39迁移校验19:22:00Z一致，无SQL新增；500check/build，143完整真实PG=138pass/0fail/5显式可选skip（4模型、1HTTP导演）通过。

独立GET records只读取有来源的公开起点、近期用户计划/人物建议/明确状态邀约，owner事务一致版本，不输出opening.notes/导演内心/私人便签；sys/ID不可写，无修改系统状态入口。公网合成暂停世界起点2项/近期真实空态、重复读稳定、跨owner404、notes系统ID422/records POST405且世界不变、旧phone与note原receipt兼容及health200通过，模型0。计划/建议/邀约正例及同owner双world由真实PG验证，公网此fixture无正例。client/provider/手机界面尚未接线，不能把后端发布当可体验完整任务应用或BOOT前史已交付。见NOTES-WORLD-01I冻结交接；原A01–A12仍待用户体验。

## 2026-10-10 · NOTES-WORLD-02 系统记录与私人便签联合界面

业务98a66a7（共享bc2ae12、加载5947f5d、界面84893e8/c3f0c5b、保存0140f95、输入98a66a7），Production3qs7jl8lj / dpl_5haFenDmXSUam6QPyG4buggG3aWm READY，正式https://parallel-life-nu.vercel.app已切换。生产03:08:30Z 39迁移校验一致，无SQL新增；521check/build通过，144真实PG=139pass/0fail/5明确可选skip（4模型、1HTTP导演），11便签专项包含于139。

备忘录接真实系统记录：近期计划/人物建议/明确状态邀约、人生起点、可展开既往记录与私人便签分开；系统只读、来源跳正确聊天/日历，错误独立重试，不清私人草稿，晚响应和版本协调有界。详情返回/邀约可读日期，按用户要求删除私人分享；输入80/2000，已有超限草稿保留提示。新建ID在世界事务锁内分配或恢复旧回执ID，含ID完整签名保留，旧随机ID兼容且改payload仍409。

公网新建无id200/同command原receipt200/改内容409/只1持久note，records200同phone version4/current0/about2/history0、私人正文不入records、跨owner404/health200，模型0。生产自有测试世界没有计划/邀约正例；正例来自本地明确领域夹具与辅助真实PG建世界夹具，非新AI成功。本地390×500/844/PC真实界面、草稿编辑保存刷新、503/404诚实状态及重试已验；Ego高层来源点击曾坐标失配，键盘成功，辅助CDP指针证据另记。根Ego98正式390×844/500真实点击系统详情与返回、0编辑控件、1440×900 phone420无横溢、私人80/2000与分享移除均通过，finish一次；A13仍待用户体验，完整长期任务/BOOT前史/地点时间方案不算交付。

联合验收文档1653670，Productionnpn9om18e / dpl_31EPpEpUDQk7ChrVeTDCf6czDsAp READY；正式关键只读接口再次通过。根/辅助/I报告及A13已受控归档，技术02子包限定完成，用户体验仍待反馈。最后仅状态登记提交，实际最终状态提交与READY见本任务忽略交接及最终回报，业务仍98a66a7。

## 2026-10-10 · FRIEND-PHOTO-01 默认带朋友照片

业务0fcd78b（真实PG75d0508、UI302f97a、用途来源020426d、保存回执0fcd78b），Production ku7jp3ee8 / dpl_CbgdfX2xcbh8kk4UEW4ce7BDKWSJ READY，正式https://parallel-life-nu.vercel.app已切换。生产04:11:41Z 39/39迁移校验和一致，无SQL变更；528check/build、13专项包含于528，11相关真实PG全部通过，不冒称重复全库。

选择朋友默认加入当前照片，其他照片区不重复朋友checkbox；共用照片去重、最后取消才撤；无图可选、本人/参考仍手选。同会话核验旧用途后换图撤旧自动图；历史stale草案无旧用途来源时保留合法参考供核对。保存成功采用规范化回执，消除已持久却假提示未保存。既有后端自动seed能力复用，无模型/生图新增。

F真实PG/API/UI保存、共享取消、换图冲突重读、确认重发及现实资料编辑后seed不变通过，390短/长屏和PC截图验收。正式Ego101手机实际选择2/取消1/全取消/再选2并保存v1自动2图，刷新保留、保存clean/disabled；PC1440 dialog430无横溢且原图loaded，取消全部真实保存v2恢复原选择。测试草案保持未确认、seed仍2/world version4，未点击世界生成。原site会话已恢复、浏览器/端口PG释放。A14仍待用户体验，不承诺这次修复解决所有AI建世界偶发失败。最终一次报告/状态文档提交部署与READY在忽略交接和最终回报记录，不再追加tracked READY造成循环。

## 2026-10-10 · BOOT-01M 历史来信试验与生产门控恢复

业务49916dd，Production7z1iq8t5b / dpl_FtwM1auuuYvGNupsMQVkW45psyBP READY；正式域名 https://parallel-life-nu.vercel.app。真实前史4次请求均失败，两个专属合成task无world/初始快照残留；未把夹具当AI成功。constructor历史默认true仅内部严格模式，唯一生产worker明确false：普通与固定cast恢复先前开场协议，关闭时无JSON格式选项、无历史头/初始已读，开启及默认写边界仍严格拒绝。新功能未开放，不标BOOT整体完成或A15可验。540check、build、最后双方12真实PG通过；39生产迁移05:41:15Z一致，无SQL变更。正式health/旧世界200、390手机与1440电脑420宽无溢出，失败提示保设定且不自动重付。未额外模型验证恢复后新建成功。三报告/主表一次文档归档，最终文档READY另存忽略交接，不循环改登记。

## 2026-10-10 · BOOT-01N 两步生成有限NPC过去来信

业务7a98c8f，Production2wwrxj6mp / dpl_F6DchQ4YWpsD62nNpuciofQsRYXk READY，正式域名 https://parallel-life-nu.vercel.app。先独立生成并授权校验世界，再以显式integer actorIndex生成小历史JSON、运行时绑定角色/编号，全覆盖后原事务保存；生产明确historyEnabled:true/historyMode:two-step，共100秒生成截止/原110秒HTTPsignal和120秒route，known纠错最多2+2，unknown不自动重付。历史只收public identity/setting/name及显式branchRole，内部relationship/persona/别人的私聊/原访谈不发送；无玩家历史气泡，旧世界不回填。

550check/build、联合15串行专项通过（含F纯跨午夜和PG父/子，不称15均独立数据库case）。本批7/10真实文字请求：普通世界含一次地点纠正，4NPC8过去+3当前；固定cast2NPC4过去+4当前；各1真实NPC承接旧原句，版本1且immutable不变。设定是明确合成approved seed/创作草案，不冒称AI推荐；实际模型执行为本机冻结planner+生产受限queue/store，正式世界GET/refresh及390短/长屏与1440电脑420宽通过，未重复付费实测HTTP task/run。上一M四失败/本轮首失败与脚本误读记录保留；NPC语义与长期召回不承诺全面正确。安全模型元信息gpt-4o-mini与旧自有正式任务一致，gateway同实现/85秒；当前production敏感env返回[SENSITIVE]，无法直接比较key/baseURL，不输出密钥。39项生产迁移06:11:28Z一致、无SQL变更；health/新世界200、历史不通知/当前分钟独立，测试世界正常API已暂停，未新增推进/生图。资源/原会话已恢复释放。只有限旧来信A15待用户体验，父BOOT跨应用完整前史/任务地图仍未完。QA新test7e7fe79与三报告/主表一次最终归档，最终文档部署另存忽略handoff。

## 2026-10-10 · BOOT-01P 兼容修复上线，自动关联保持关闭

业务d59fe3f（独立d8274da），Production laid82hg9 / dpl_9TSTzZpENKSxdGzCCvf4vPCz8xrk READY，正式 https://parallel-life-nu.vercel.app 已切换。39生产迁移校验和一致，无SQL变更；563check、旧N+新P联合真实PG20项（含父子）/build通过。修复邀约成功保存却503、保持旧回执版本，接入来源标签/四应用兼容和相册返回高度；本地真实HTTP原command200/v1、改期取消、旧receipt不变/latest唯一、陈旧409及390/PC已验。公网health/三个旧来信世界200、8/4/4历史无回填、390无溢出/PC420、合成原图200通过，未宣称公网新关联或邀约正例。

本批8/8真实文字预算停止，末次原普通world复用第6真实阶段+第8真实历史，模型仅写周末未给具体日期被拒，无world/initial半成品；固定cast已保存世界无关联且暂停。historyLinksEnabled:false，旧N两步来信保留；P完整关联和A16自动关联未开放，父BOOT未完成。0生图，NPC本批未验。测试会话和资源已恢复，最终三报告/主表一次文档归档，文档READY另存ignoredhandoff。见[本批报告](task-reports/BOOT-01P-I.md)。

## 2026-10-10 · BOOT-01R 运行时时槽邀约及手机时间入口

业务a24a8d4，Production4bvku0qbd / dpl_J8DR4KQwhz8Bmc5bheRsfx1dfmSB READY，正式 https://parallel-life-nu.vercel.app 已切换。生产39/39迁移哈希一致，无SQL变化。模型私有邀约slot/body经固定T0与UTC08归一化，完整年份正文/quote/日程同源，持久v1和旧N/旧回执保留；worker historyEnabled:true/historyMode:two-step/historyLinksEnabled:true，仅新世界开放来源关联，旧世界不回填，合法0不伪造。

最终578check/build、29串行真实PG（含父子）通过；本轮真实人类授权最多2新world/0上传/8文字/0图，实际普通与固定cast两新阶段各2及NPC各1共6/8，原合成朋友图复用，两future proposed/角色承接/initial不变、已正常API暂停。实际生成仍是本机冻结planner+生产受限queue/store，不重复付费冒称正式HTTP tasks/run实测。有限字面时间门非完整语义判断；普通开场时段/称呼、NPC模板感及旧相册毫秒精度为遗留，不能承诺所有创建成功。

手机独立时间入口/控制移除，首页/状态栏/锁屏共用标签、短屏可读性改善；旧time/director回home，schedule到真实calendar。公网390短长/1440PC420同源17:25、四App/深链/clock不变，新世界/记录/原图200、跨账号world/图404及旧N/P8/4/4无回填通过。系统来源记录只读、原图日期明确上传时间。Ego109原会话恢复并finish，I/F本地资源/夹具/临时链接清理。地图/导演长短期/壁纸及发送重复错误只规划或待开发，其他主WIP排除。四报告/主表/PHONE_EXPERIENCE_NEXT一次最终文档归档，文档READY另存ignoredhandoff。

## 2026-10-10 · CHAT-SEND 单次失败提示与只读回执恢复

业务9699249（I cadc75e + F 3ba6d3e，F最终报告64f93fc），Production mxqf1bxxo / dpl_8tDGVy4QUd7aoT5Bm9neoXdERJ7M READY，正式 https://parallel-life-nu.vercel.app 已切换。591check/build通过，3纯回执专项与5真实PG项（含父子）、F真实群事件及故障UI、联合实库相关用例通过；39生产迁移校验和一致，无SQL变更。

失败消息下方保留局部提示，撤掉同次底部重复；草稿仅提交成功且未改变时清除，按世界/联系人恢复。单聊unknown保原command/actor/text/实际expectedVersion，通过只读 /messages/receipt 核原事务；缺失仅unconfirmed，核对/刷新不自动重付，明确再次尝试先查原回执并告知可能重复。群聊恢复原发送不自动execute，显式重试前读取最新task，已发送玩家消息与回复失败区分，独立读取错误保留。共享helpers/provider/client/interview与其他WIP不纳本批。

正式两个既有paused合成R世界原receipt/重复200/v1、缺失200/unconfirmed、指纹409/跨owner404；六张世界相关表查询前后整行相同，world1/clock暂停不变。Ego115原生touch实际原回执恢复、受控422/lost、unknown两次核对无新send、390短/长及PC1440截图通过；模拟send全部被Page保护拒绝，没有新生产消息、task执行、世界、模型、生图。自动selector/mouse偏移、初guard跨CDP不持久及故障body漏字段均记录，不冒称成功；原生浏览器touch不等于真实手机验证。会话/局部存储恢复、finish一次，I本地账号/夹具/端口清理。F资源仍由F按保留登记收尾，不声称已停止。

地图设计两文件和默认人生副本最新方案一起归档，仅预览/规划；默认副本内容及玩家实例化、地图移动、专业创作者后台没有上线。本批排除根新DEMO-SCRIPT在途稿/行及其他设定页面工作。最终一次文档部署READY、当前提交及资源状态另存忽略chat-send-final-handoff.json，不循环追加tracked状态。

## 2026-10-10 · DEMO-SCRIPT 四份内容稿归档

内容b8f698d，Production 9tq2m8cfb / dpl_5AANqAfoGn1JJkkXbpGceLytjaXB READY，正式 https://parallel-life-nu.vercel.app 已切换；只读health、首页、possibilities均200。五份v0.2内容文档21982字符及根/F/I报告受控归档，原v0.1审查证据保留。修正知情时点、活动人数及相对日期，补资料、拒绝分支、身份回报与首段终点；两处集成时间措辞修正见I报告。39/39生产迁移只读一致，无SQL变更。纯文档没有重跑应用check/build或借用CHAT591测试当剧本体验验证；Vercel发布构建READY。

业务仍为CHAT9699249，不新增预设入口/可执行剧情或生产世界，0数据库写/模型/生图。四稿未获逐条采用、未证明好玩，LIB-03实例化及完整场景/素材/任务待开发，专业后台仍最后。初次误用/branches404，实际/possibilities200，其他源码和旧WIP排除。最终文档发布及最新READY/public另存忽略demo-script-final-handoff.json。见[集成报告](task-reports/DEMO-SCRIPT-01I.md)与[四稿索引](story-presets/README.md)。

## 2026-10-10 · DEMO-PLAY 四人生直接体验

业务a41c3e80，Production co06or00l / dpl_3tncsgaMXLJ3Ybm8EnTbd2Tt4SLU READY，正式 https://parallel-life-nu.vercel.app 已实际验收。0040生产已应用，40/40迁移checksum一致；最终616check/build、全量真实PG193通过/5可选跳过及列表专项6父子通过。根固定内容、I确定性事务/实例与只读资料、F四卡入口一起集成；无需生日/访谈，按owner/内容版本独立且默认继续，丢结果沿原command核验。修复官方seed在个人列表重复显示待创建。

正式两合成账号×4世界，57项创建/重放/继续/权限/API验收，8/8真实文字两轮核心称呼与意图承接；四聊世界v2/另一组v0，8事件来源episode记忆、initial/6公开关系/3只读资料保持，0媒体请求/生图。全部测试世界paused；390短长与1440真实入口/手机/回复无横溢，非真机或长期趣味证明。原会话恢复、Ego119 finish、I本机账号/端口/临时链接收尾，其他WIP和他人资源保留。

四稿已由人类采用，五文档头更新；仅可自由聊天的四预设初始生活与有限原有日历/记录，不声称完整剧情任务/地图/公开舞台/素材已实现。相册iPhone改版ALBUM-IOS-02仍待开发，专业后台仍最后；A17待用户体验。详见[集成报告](task-reports/DEMO-PLAY-01I.md)。最终一次文档发布另存忽略handoff。

## 2026-10-10 · ALBUM-IOS-02 iPhone式相册

应用2acc2e5、根报告79b33cc，Production qqd7lmcx2 / dpl_d2KbognG19yvE7DB5HV9Xo8hD1s8 READY；正式 https://parallel-life-nu.vercel.app。623完整check/build、真实album库1项通过；40/40生产迁移一致，无SQL/API/权限/Provider变化。图库日期三列网格、来源相簿、完整大图与折叠信息，明确人物关联，不按文本猜人；返回同集合/滚动，坏图不假设壁纸成功，无生成重试action则不显示死按钮。已有上传格式/busy/原command/局部错误与文件丢失说明保持。

Q隔离390短长/PC480、750px恢复/history/坏图/上传失败与pending去重通过。I正式paused旧单图/空世界实测图库→相簿→人物/添加照片集合→大图→信息→返回，来源/日期保真、原图200、cross-owner/错revision404，390短长与实际PC420无横溢；两个旧世界v1/1与0图不变，0新增生产上传/世界/模型/图。公网单图不冒称覆盖多图翻页/真实新上传，非真机或用户满意度；A18待用户，自动剧情媒体/地图/完整任务仍未完成。Ego123原会话恢复finish，I本机库/链接收尾。见[集成报告](task-reports/ALBUM-IOS-02I.md)，最终文档部署另存ignored handoff。

## 2026-10-10 · SPACE-02A/B/C 限定地图

2026-10-10 I最终集成：业务dad824f，Production6w2u15n9v / dpl_GnmSM8UFLNf9pNinQ49ZWsCUqMcg READY；0041生产已应用且41项checksum一致；653check/build、真实PG203通过/5可选跳过、正式既有合成世界11检查与390/1440实图/返回通过。0模型/图片/新生产世界/上传；测试世界paused=true。Ego125/126/127均已finish，各HTTP/PG已停止；限定技术完成，用户A19待体验。 正式 https://parallel-life-nu.vercel.app 已实际检查地图来源、明确旧起点建立、12分钟原子旅行、暂停原回执重放/恢复与跨账号404；手机390与PC420地图/入口/返回无横向溢出。新官方v2地图、未改v0明确建立可用；已发展旧档与普通自创目前空态。现场AI、完整任务、旅行后NPC/迟到后果与保留旧存档另开新版未交付。详见SPACE-02A/B/C报告与主表A19。

## 2026-10-11 · XIAOAN-ACCEPT-01 接续地图与导演事项

业务31410f3，Production r84dpeq2b / dpl_CqqV9ouLocs3HZvDZGPygZFB8TfD READY，正式 https://parallel-life-nu.vercel.app 已切换。41生产迁移只读校验一致，无SQL新增。680check/build、真实PG215总项=210pass/5明确可选skip通过；390长短/PC420实际事项卡→只读详情→正确来源聊天及地图/五App通过。正式旧合成paused世界phone/records/space同版本、四卡/旧存档、跨owner404/health200与390/PC地图和备忘录已验，0生产写/新世界/上传/模型/图。

接续3ae8c52六个小安提交，修复通用地点/固定时长推断，允许明确开场空间草案；地图到达不冒称已赴约；导演有来源事项提议接真实事务/记录，权限/去重/自述与客观成果隔离。真实新模型空间/事项输出质量、现场客观事项进展和完整追求仍未验/未接线，不能将六个报告或本轮安全补齐称完整任务玩法。见XIAOAN-ACCEPT-01与总表03B/AI-QA。其他主目录在途修改排除。最终文档归档部署及资源状态存ignored handoff，不重复改tracked READY记录。

## 2026-10-11 · NAR-03 / NOTES-WORLD-03B limited scene integration

Business `eacb6ab` production `5kv0fkvr0` (`dpl_A4AskWAvsuzrYEARHVxZjzRe74PD`) READY; formal https://parallel-life-nu.vercel.app. Scene actions update validated authored near-term matters, source-backed attendance, observer-only facts and coherent phone projections. Existing saves preserved; four official new content versions are v3. No new migration: all 41 production checksums match. Final check 712/712; PostgreSQL 222 passed, 5 explicit model opt-in skipped, 0 failed; build successful. 390 long/short and 1440 PC local synthetic UI verified. Eight public readonly check groups passed, no new paid calls/images/worlds/uploads/production data writes. Generic completion rules, pursuit stages, actual rewards and real model quality remain pending. See task-reports/NOTES-WORLD-03B.md.


## 2026-10-11 · NOTES-WORLD-03C 有限长期阶段与后续机会

业务5ff3c09，production jwoouortv/dpl_CgoRiUNdjKdPiowYHL8Tu37xvN7F READY，正式https://parallel-life-nu.vercel.app；746check、237真实PG通过/5真实模型opt-in skip、build0、41生产迁移一致无SQL；公网8组只读验收、旧存档paused/版本/权限保持，0新增模型/图/世界/上传/业务写；390长短/1440PC420本机合成UI通过非真机/模型台词验收。PG55452/55471/55458及HTTP3268均已停，Ego141 finish；有限四v3近期成果→单后续→最多两里程碑，旧已完成无回填、自创/通用长线/兑现/真实模型留03D与AI-QA。

完成真实近期现场事项后，备忘录呈现阶段来源和可参与后续，不替玩家开始；真实后续行动只再增一阶段。NPC仅承接实见成果，显式ack不变成印象记忆，屏蔽父/触发/来源同样阻断机会；长历史只保留有限真实来源，不带出未来事件。Q独立审计发现rawfacts机会泄露并保留失败断言复验。重复/失败/用户自述不假成功、旧存档/不可变起点保持。最终文档部署与公网核验另存ignored handoff，不循环追加tracked READY。


## 2026-10-11 · SPACE-MATTER-AI-QA-01 有限提示修复与真实失败验收

业务7740540，m8d9mk05q/dpl_3DvExQrCXNFYxByGqKUfHWkrvrnK READY且正式别名已切换，公网8组只读过。751check/237真实PG通过+5显式opt-in skip/build、41生产迁移一致无SQL变化；只改两planner、新capture与有界手工验收工具，没有本轮UI变更。

1官方v3合成世界，文字保守上界11/12含unknown保留预算和明确手动重试，0图片/上传/个人资料，正常API已暂停。旧两partial与新版重试partial均保留，R17无成果/机会；原修后85秒unknown只存玩家输入，手动重试后task成功仅说明partial提交。跨App追问503/INVALID_PROPOSAL（具体子阶段未知），原receipt unconfirmed/worldv10未变。整链真实质量未通过，不将READY/单测改写为玩法达成。

补充规则/候选时序/resultFocus提示已上线，但提示修复未解决实际循环。接续02先结构化目标终点/分步证据/NPC自身行动来源与事务，之后新授权实测成果→机会→第二行动。普通世界/通用长线03D仍待开发，语音暂缓。root/B本地PG停止，Q不运行DB/模型/浏览器，其他主目录WIP保留。最终文档部署及公众只读状态另存ignored handoff，不循环追加tracked状态。

## 2026-10-12 · SPACE-MATTER-AI-QA-02 候选已上线，真实整链未通过

应用6b629ba / Production po54gy1kk（dpl_J7khbwtNXTwrXGKqaAawsADDY92j）READY，正式域名已切换；826项检查/build0、真实PG现场6专项、此前全PG243pass+5 opt-in skip，生产41迁移一致，无新SQL，正式8只读检查通过。实现R17限定分步保存/有来源NPC动作/结果后续消费，开场独立人物presence真实验证通过。真实首步格式失败保留，最终合并动作unknown（响应体超时，HTTP200/85125ms），world v12无步骤，整体完成→阶段→机会→下一行动→私聊未通过；不得称完整体验上线验收。根保守15/18文字、1合成world，0图/个人资料；正常API已暂停并关闭批次，不沿用余量或重付unknown。主表母任务继续待验收，详见SPACE-MATTER-AI-QA-02报告；下一优先结构输出与响应稳定性。

## 2026-10-12 · v13 累计来源连接与 v14 人物动作格式候选

v13业务74fee47 / 3m7qj2yyh（dpl_CiV5v9bEAUE33Us6aJfhHzvyBU4d）READY；正式 https://parallel-life-nu.vercel.app 已切换且8组只读验收过。41/41生产迁移checksum一致，无新增SQL。仅完整source链验证后的scene_steps成果进入长期里程碑/后续机会；旧action路径保持，缺源/破坏真实action行不展示信用。v13最终1002check/build0、实际PG249pass/5明确opt-in skip及专项8通过；都是合成模型，不是供应商成功链。真实原说明仍failed/NPC kind非法7045ms，保守14/18，只有核对已存，未完成整体验收。

v14新候选准确B1ced6b2/Q2dc590a，有限人物独立动作索引格式，普通说明无可执行动作；严格源/实际接收/事务保持。最终1062check/332边界/type0/build0，新adapter实际PG8/8通过（非供应商）。待提交发布READY、公网和剩余4真实有界验收；中途人物进入、只读分步UI、通用长线、私聊完整模型链仍未完成。

### v14 实际发布与闭账

业务3b48cc7 / g5b79qeri / dpl_Awjgu7bBAb6BP7Yu5c1TDcSrSNr9 READY，正式 https://parallel-life-nu.vercel.app。同源Git自动l7iiymfx8先READY并完成8组只读回归；有限NPC动作适配及来源保存接线已发布。最终1062check/build0、新adapter8真实PG通过、无SQL变化，41生产迁移保持一致。实际原说明仍failed9035ms，SCENE_STEPS receiver复合门；world v6仅核对已存，完整玩法验收未过。新账本1world/保守16of18，0图/个人资料，已正常API暂停全部世界并closed，余2不沿用。NOTES-STEP-UI-01只读分步显示另行开发，中途NPC进入仅计划，不把READY当成模型整链成功。

## 2026-10-12 · NOTES-STEP-UI-01 只读分步与receiver诊断候选

根公开契约7597399、B97cfb14/根2705080、Qd40748d/根34818fe集成；公开记录只有可信finite清单，不露raw输入/观察source。Notes列表分数、详情必需4及可选3、玩家交出与人物实收分开；未知/失败新输入保旧信用，缺源整表省略，legacy不误标0/4。receiver原五项拒绝顺序未改，只增加固定白名单诊断，没有额外模型调用或自动修复。

最终1122check/332边界/type0/build0、实际PG249pass/5明确模型opt-in skip/0fail及8专项通过。Q390长短/PC420合成实际组件CSS布局通过，非线上或真机；无SQL/生产41迁移保持一致。待提交、READY/正式已存1/4与完整手机壳只读验证，当前真实16/18closed母链失败保持，不称完整玩法成功。

## 2026-10-12 · NOTES-STEP-UI-01 正式发布收口

根最终业务39085f7/itpqc4wwb/dpl_J4iPUFY2p1JDx8BDw4zxtzEc8vPF READY，正式别名已切换；1122check/build0、真实PG249pass/5明确模型skip、专项8/8，41迁移无SQL变化；正式paused真实已存1/4旧时间保持，公网8组/跨owner隔离通过。根完整线上手机壳390×844、390×500、PC1440内420无横溢出、只读无checkbox、展开可选/短屏末尾可达，0新模型/世界业务写，Ego146结束并恢复本次Cookie。仅有限R17清单/诊断技术交付，真实母03说明仍failed/closed16of18，不能称全NPC链成功。

来源严格支持已存部分进度；可选记录不计入必需4步，人物收到与玩家交出独立。没有新SQL/模型额度，完整说明→交付→实收→机会→下一行动→私聊尚未通过供应商验收；SCENE-NPC-ARRIVAL-01中途进入/离开与NOTES-WORLD-03D通用长线仍未实现。A25待用户体验。最终文档归档版本及资源清理存忽略handoff，不重复生成跟踪回执。

## 2026-10-12 · SCENE-RECEIVER-04 显式接收者修复候选

B61bfdab→ad9f657，Q62d2b7d→b094331；新indexed-observations-v3只有显式所选matter实际allowedReceivers receiverIndex，不猜唯一人/补name/quote；旧wire保持严格，domain实收/source/whole完成边界不改。根实际PG10通过含v3说明→实收→机会→实际私聊adapter/事务/幂等，都是明确合成输出，不代表供应商自然完成。最终1196check/332boundary/type0/build0、全PG251pass+5明确model skip；41生产迁移本轮只读checksum一致，无新增SQL。

待提交READY/public。上一批03 closed16of18，所有测试世界正常暂停，不沿用余2；本轮新2world/18文字授权已提请未回复，0新付费/生产世界业务写/图/私档。SPACE-MATTER-AI-QA-04继续待真实验收，现场人物中途进出/通用长线/真机仍待做。

### SCENE-RECEIVER-04 正式发布与验收范围

业务cc1057d/moc1ee02x/dpl_o986pEAVXDywZNUiPoexcryHjxnF READY，正式https://parallel-life-nu.vercel.app已切换。1196check/type0/332boundary/build0、真实本地PG251pass+5明确model opt-in skip/专项10、41生产迁移只读hash一致；正式旧paused世界1/4首次时间保持、8组只读投影/跨owner隔离过，0新增paid/正式世界写/图/私档。PG55452正常停无监听，无浏览器资源。本轮授权未回复，旧03 closed16of18不沿用；仅v3接收人格式与独立反例技术交付，不称实际供应商说明治愈/自然全链完成。

没有本轮真实付费验收，母04维持待授权/供应商验收；42独立反例及实际PG完整合成保存链不代表供应商自然表现。下一先新授权下验证单独说明→交付→实收→机会→下一行动→私聊，若失败记录具体安全诊断，不自动重付/补成功。

## 2026-10-12 · 04真实说明通过与接收固定诊断候选

新授权04 1world，开场/核对/说明真实succeeded（Notes2of4/SQL先前来源保持），交付failed5723ms/Receiving lacks actual handed objects，保守8of18，未接收/完成/机会。根同顺序原四条件仅增加固定码，不暴露raw/放宽规则；1201check/type0/build0、原本地PG10过、B只读diff通过。无SQL，41生产迁移一致。待READY后仅一次原failed手动复测，不自动循环。自然第三人称NPC与导演混动作环境仍待修。

## 2026-10-12 · 委派集成 NPC完整段与引用信用修复

用户指定辅助接管唯一集成/付费/发布，原主任务转讨论；I为codex-npcquote04b-01a11a84-20261012。技术业务413b3ae8e9ca4050a398d3ff41341faf0c9fa9f0，eiublxcrc / dpl_xM8G5pkWcinSbQZbWxBBCWYtEfNL READY，正式aliasAPI精确指向新部署；1311check/type0/332boundary/build0、全真实本地PG252pass+5明确model opt-in skip、引用rollback专项11；Q59原引用红测及独立195pure通过，41生产迁移只读checksum一致无SQL。公开8组旧paused保存/权限/投影通过，root/Q本地资源停止，I55471正常停无监听，无新UI源码变更。

新NPC indexed-npc-actions-v2段数组/quoteIndex只保完整原段，不trim或补我/物件，legacy经典/v1严格兼容且内句号引用信用漏洞由ef60源全文界限修复，player/NPC共用；任务回滚真实数据库验证。不把技术发布当模型整链通过。

READY后原handover仅一次manual复测实际failed8485ms、固定Unsupported player execution quote，world v8仍真实2/4，原review/explain源保持，唯一04权威账本10→12/18/open/1world，0图/个人资料。不是上一receiving_condition重复，不知八项具体子因，不猜raw。随后cce1acf只同原8条件/顺序新增固定player_step_condition/trustedpattern编号诊断，不改任何regex/接受规则：新9+相关157pure/type0/332过，完整1320check/build0、真实事务专项11过、生产41校验再次一致，待Q只读确认后发布READY再原任务最多一次manual复测。root主WIP保留未纳发布；旧03closed不动，剩6不扩，最后必须全部world正常APIpause并closed。


## 2026-10-12 · WORLD-PUBLISH 首期基础规则

基础业务74de967a4cebf9e3bec543c25aafccc99ea17b2f；Production18s9pbvjt / dpl_5vFByZhSwYmUmxgsHEYaJxhTdnKV READY，正式https://parallel-life-nu.vercel.app精确alias同部署。1541check/type0/339边界/build0；生产41迁移checksum只读一致，无新SQL。公网health/possibilities200，私有源归档/docs和未接publisher入口404。CLI手动部署返回Not authorized，Git自动部署成功经commit状态与Vercel精确alias双核，不称手动操作成功。根PG55476已正常停止无监听。

已交付仅：版本化内容、隐藏/公开与历史/未来静态边界、阶段/前置/故事窗口校验，安全玩家编辑预览和未支持能力门；独立内部身份helper与后台设计文档。B102+Q92+根身份12=206专项全过，原6安全红例断言保留已修复；Q身份原12与5独立stdin反例通过，无新实质源码缺陷。快照重建撤权不等于在线自动重载；后续每次HTTP/数据库事务仍须当前权限校验。

后台真实保存/发布、员工登录与cookie、发布素材、实际编辑UI、动态玩家实例化和试演未完成，新供稿仅私有归档，不称新作品已可体验。根仅部署基础，0新增员工配置/付费模型/图/上传/生产世界。B STORE0042方案已冻结给独占本地实施，生产未应用42。Q身份报告98f316d归档继续文档部署，最终非凭证交接存ignored.local/world-publish-foundation-handoff.json。


## 2026-10-12 · 文字世界后台闭环

2026-10-12 根限定交付：206c8bed0f8cd2909d561c6e37d9a4f0c4b9caa9（小安836ea2c、B存储/43/45、Q编译/目录及根接线修复）Git自动5LxUL2fJYMqnRk9gcihf28ANRvVv READY，正式alias准确匹配。生产45checksum验证；check1642/type0/377边界/build0，完整真实库315pass+5明确模型opt-in skip。首次全库未传3专属端口环境，在连接前守卫拒绝；显式三TEST_PORT=55476后完整315绿，未放宽守卫。线上2合成存档（trial/player）、3真实角色回合全提交，按2/次保守占6/12，旧饮品设定和新回合先后决策承接成功；重复进入同world、历史时间各异、trial消息不混player、跨owner404。12非模型权限/页面probe，390/1440人物保存及390trial现场诚实空态通过。测试work已下架/两world paused/账本closed，无个人资料/图/上传。下架后本人目录保精确原卡片/world/进度v2，新guest不见且直接world404，0新增world/model。报告AUTH-HTTP/E-INTEGRATE/G。仅限定范围完成，不把有限样例当全部剧情成功。

入口：https://parallel-life-nu.vercel.app/workbench 与 /published。员工凭证仅在主目录忽略文件中，不提交或输出。原编剧完整稿仍未正式上架；母任务保留。文档归档后的最终SHA/alias证据存忽略交接文件。

待接续：SOURCE-PREP原供稿差异仍需修订确认；候选剧情与章节时间线运行适配、发布素材manifest及头像/封面/场景图读取、全部字段可视化编辑（均未领取，依现有安全合同）。WORLD-PUBLISH-VERSIONS-LATER仍后置；目录仅继续每作品最近实际存档，不宣称所有版本切换。原现场事项/NPC行动/后续机会旧任务保持原记录，本批不替代旧任务验收。


## 2026-10-13 - Screenplay first public release

Public version 2 is visible at /published. Eight actors and places, three stages, fourteen optional nodes, fourteen staggered historical/opening messages; eight original portraits and cover. Production 49 migration checksums verified; check 1749/1749, build success, PostgreSQL 391 pass/0 fail/5 explicit model opt-in skips. Real QA: 2 isolated saves, at most 20/24 text requests, no uploads/new image/personal data; actual invitation, travel20m, wait19:30, worker scene, partial action progress and subsequent private chat continuity passed. Both saves paused. Public discovery/cover, owner and trial404, manual director403, idempotent resume and matching projection versions checked. 390/1440 layout checked, no device keyboard claim. Original failures preserved; full original screenplay and remaining product work not complete. Exact final SHA/READY/alias evidence is in ignored script02-final-handoff.json. See WORLD-PUBLISH-02-INTEGRATE and plot guide.


## 2026-10-13 - Markdown authoring and map followup

514344b09d09a2a8746b4adfa45ce6bb258cb20a / dpl_FTqcvGEyxJvban9r579iXeWDmRLD READY; exact formal alias matched. 1827 check pass, 404 boundaries/type0/build success; production49 checksums reverified, no new SQL. Public staff login/ZIP manuscript preview/container provenance, existing real screenplay listing/cover and health200 checked; production preview not applied to original work. Parser/ZIP/source review, native modal/version guards and places/routes/opening-message authoring are delivered. Local real HTTP draft r1-to-r3/full-content checks passed up to required actual trial; fresh 12-text/2-save synthetic QA scope still awaits user response, old20/24 closed. No new paid project calls/worlds/images. Source remains editable draft, not automatic full-story publication; private raw documents not pushed. Pending work stays in DEVELOPMENT; guide WORLD_PUBLISH_MD_GUIDE. Final evidence ignored md-final-handoff.json.


## 2026-10-13 · 文稿真实发布验收与人物事实编辑

业务bfedd54（B明确L5关系/候选说明截断e261ff6、root人物页事实文字编辑），Q只读报告0257bc1/6ade8cd归档。完整check1835/1835、0失败/0跳过、404边界/type0/build成功；正式49迁移checksum本轮核验，无新增SQL。

新授权独立批次1临时作品/2存档，5次会发起模型的操作保守预留10/12文字，0图/私人资料。项目实际来信节点、trial角色回合、精确试演证据、发布v1、player独立version0、真实来信/两轮317承接、跨owner/trial404/同command恢复/下架继续通过。原传输失联保留后只读精确source核对，无重付；两存档暂停、临时作品下架、账本closed。仅备注节点未触发、playerCompleted=false；不冒充完整任务成果/所有剧情或AI自动扩写。

本地真实UI两事实改字→保存r1→刷新读回全量deepEqual仅text变化，知情/日期/可见范围/引用不变；390无横溢出、编辑宽276/原checkbox保持，1440玩家手机420居中。角色页原显示列表现可原地编辑并跳剧情新增。当前发布开场是系统确定性初始化，运行时角色/合格剧情/现场才调模型；任意Markdown自动AI整理完整世界仍待做。

本批Git部署的最终READY/正式别名SHA与公网新入口验证另存忽略md-live-final-handoff.json，不以排队算完成。任务仅正式验证后由主登记目录DEVELOPMENT更新，保旧原稿全部结局/长线任务/图片/真机/自动世界准备待办。


## 2026-10-13 · 项目 Agent 文稿整理与地图收口

正式业务58d0d018de44fc8ed2a19c3ef29230f3a10c8d2b / dpl_DM6S46QvR8pokxtFGPjW5VuSWRHB READY，正式https://parallel-life-nu.vercel.app精确同SHA；health/workbench/published200。生产50迁移checksum已复核（本批0050私有整理记录，旧世界未重建）。根最终1893/1893 check/type/边界与build通过；新增整理真实PG8/8，综合数据库385通过/5opt-in跳过/1专属端口守卫随后明确端口14/14修复；地图新增5+原11=16真实PG全过。不将首次环境守卫失败写成整套一次全绿。

MD/ZIP文稿 → 项目自己的整理Agent → 原稿/补充/变化双核对 → 保存 → 私有试演 → 发布 → 玩家独立存档已在正式环境实测。整理独立YIBU_PREPARATION_MODEL=gpt-4.1，日常NPC保持原YIBU_TEXT_MODEL。每整理至多两次，只有已收到的明确校验错误允许一次纠正；unknown恢复仅查原记录。原稿、提案、员工权限隔离，有效草稿才能采用，绝不自动发布。

新授权合成批次共5次整理+2次NPC，保守11/12文字、2/2测试存档。前4份提案失败保留，第5份结构/核心来源校验通过；真实UI双核对采用、原AI内容原样保存，trial263与player317相互隔离、两条不同日期历史、第二访客目录/跨owner和trial404/重复进入同world/投影一致通过。临时作品已下架，两存档暂停，账本closed；无个人资料/上传/图片生成。开场由系统按已核对AI稿初始化，非开发者手写最终世界；初始化本身0模型，不冒称每次进入都重新生成。

边界：原稿仍可能细节遗漏或未充分标注补充，年龄只notes、旧约定遗漏等已列PUBLISHER-AI-SOURCE-COVERAGE-02。ZIP图片自动绑定、长文分段、未知玩法、全面多题材覆盖与真机键盘不属于本批已验。人物/地点/历史/两阶段候选的有限合成样例通过，不等于整篇同事剧本全部分支验完。

地图已去顶部搜索/探索附近/无实际内容分类，保真实已有地点与前往入场；390/1440公网已检查。县城旧导演unknown不再无限阻塞玩家明确地点操作，实际在途锁和晚到版本栅栏保留；现场开场与行动提示分开，实际结果仍经校验。该后续公网最终验收已由执行者完成：原旧存档只读busy=false且版本/位置不变；正式测试县城前往旧车间18分钟→进入→最后1次真实开场成功，环境持久化，390/1440检查，暂停存档并恢复会话。完整证据见MAP-COUNTY-BUSY-01；其独立模型4次（前2失败/后2成功），不计入根已关闭11/12批次。文档归档最终SHA/READY另存忽略prep-final-handoff.json。


## 2026-10-13 / WRITER-UX-12-HEADER

6c725e5 deployed READY (dpl_3B6Ca4DJmuiKdkgumAhJ4j8U2nHf), formal https://parallel-life-nu.vercel.app verified on desktop/mobile. Compact toolbar, consolidated checks/time panel, inline collapsible failures. 2118 check, build, 50 migration checksums; no SQL/model calls. Health/workbench 200 and anonymous works 401. See task-reports/WRITER-UX-12-HEADER.md.


## 2026-10-14 · 指定开场与人物原文编辑

正式业务40b947b007be57de49875b7358be12183bb93055 / dpl_DA9JUXm7yXkAF8NTRnZ34EBo9KyN READY，formal https://parallel-life-nu.vercel.app精确同SHA，CI38516307957 check/database成功；health/workbench200、匿名works401。生产57全部checksum核验，旧世界未重建。2267check/63真实PG开场story/world/phone专项/build/format通过。

编导可选择同事件作为开场，不复制剧情；未呈现前真实skip/expiry/decline与同轮expiry/exclusion释放后续，不把呈现算完成；发布前拦不可达因果、保真正可达日期/地点/ANY/阶段成员clock前提及角色知情。整理保作者开场key不被模型改掉。人物公开介绍/五维精确原文保存，私密L5不写公开关系；旧摘要保留不自动迁移。PC1500/mobile390实际六字段及开场选择正文保存/读取full deepEqual与截图通过，Ego177完成，本地服务与PG停。

辅助18独立人类授权2新存档/6文字范围已验收并closed：复制此前真实项目Agent整理的合成稿，私有试演和发布新访客手机均实际指定show_change真实NPC开场，来源保存，v1/presented1且outcome null/未完成。历史/两朋友圈390/1440显示，目录重复进入同存档无再开场，跨私有404；测试作品下架/freshguest不可见，两存档暂停/cookie精准恢复/Ego178完成。root0新模型/世界，不混旧17/24/2或辅助17账本；没有额外玩家私聊，不宣称从零新文稿一次完美或完整连续剧情。长稿NPC上下文整组省略、历史质量/标签、持续多拍、现场新模型未整合等保持任务表。
## 2026-10-14 · CHARACTER-HISTORY-MEDIA-24 历史微信图片与 MP4

`35bc3bc` 与修复 `b631e1d` 已部署到 Production `dpl_D3468fDmGT5u9CqML393ajCPc8fP` READY，正式别名 `https://parallel-life-nu.vercel.app` 已核。编剧历史微信新增私有图片与不超过 50 MB 的 MP4，保存、试演、发布和玩家微信使用同一附件引用；跨玩家读取拒绝。生产迁移 0060、0061 已应用并校验 61/61；新私有桶限制 MIME 和大小。`npm run check` 2335/2335、`npm run build`、真实 PostgreSQL 专项通过；公网合成 MP4 的上传、试演、临时发布、玩家视频加载和 Range 206 通过，测试作品已下架删除、存档暂停。大视频弱网续传与图片公网实物抽样仍待，见 [报告](task-reports/CHARACTER-HISTORY-MEDIA-24.md)。

## 2026-10-14 · CHARACTER-CAPACITY-23-I / CHARACTER-PASTE-23

`4f273e5`、`275da88`、`9902287` 已部署到 Production `dpl_2zvPE8eSvDC1E3if4TKyPCYSJtth` READY，正式别名已核。人物五维长文上限提升至 16,384 字符；当前人物可粘贴/导入 Markdown，逐项预览核对后填入，未知章节阻断、重复导入不追加；事件编辑移除手动地点入口。集成 `check:boundaries`、typecheck、19 项聚焦和 build 通过；执行树完整 2329 项检查与真实 PostgreSQL、PC/390px 验收通过。无新增迁移；部署前生产 59/59 校验和一致。公网健康 200、工作台 200、匿名作品接口 401。


## 2026-10-15 · SCRIPT-LIBRARY-25-I 剧情与地点库

业务 `5484b4a6eb111e972ec829c89cf22eadac047f95` 已 Production READY，部署 `parallel-life-ox85v2sal-limengzhe27-boops-projects.vercel.app`，正式 https://parallel-life-nu.vercel.app/workbench 已真实浏览器验证。生产 62/62 迁移校验和一致；check 2377/2377、build 与真实 PostgreSQL 33/33 通过。Markdown/ZIP 默认按格式解析，保留事件全文、多地点及明确开场；作者核对后填入，不默认调用 AI 或抽取硬条件，重复导入不追加。PC1440/mobile390已检查并修复长稿识别按钮被滚动区遮挡。

《渣男体验》在版本冲突保护下从最新草稿116保存为117：1开场+17事件、16地点（14原稿+2保留）；原有79历史消息、24朋友圈及人物/图片完整保留，原稿18块逐项一致。实际作品保持草稿、没有发布；本轮0模型/0新世界。新地点地图揭示/导航与连续多拍事件尚待单独验收，见 SCRIPT-LIBRARY-25-I 报告与总表，不能把导入成功当成全部分支已玩通。

## 2026-10-15 / WRITER-LIBRARY-28 and author-source preservation

Production 5cb35db25f1b35faa6e9685ba90d881133f47593, dpl_9m2ak2jhEhAPojewbw3X8mztH1b1 READY; formal https://parallel-life-nu.vercel.app verified. Production67/67 migration checksums. Complete check2417/build and integrated real PostgreSQL46 pass. One event library replaces duplicate details; optional prerequisites and legacy arrangements start closed. Names-only places and optional same-work private scene pictures are connected to map/scene reads and deterministic default navigation. No authored original event/history text erased.

Actual manuscript draft118 remains unpublished: 18 event blocks, 79 history messages, 24 Moments, 16 places, 14 scene pictures. Public 1440/390 checked. Synthetic publication/player acceptance preserves both speakers, history attachment, curated avatar, three-image Moments and identity visibility; scene image302->200/default actual travel10m/start retry sameworld verified with zero model calls. Test work downlisted/soft-deleted and three QA saves paused. Complete director model progression and custom inline avatar legacy migration remain tracked separately; do not infer them from this scoped deployment.
