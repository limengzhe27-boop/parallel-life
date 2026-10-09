# GROUP-01 · NPC 群会话与回合

原独立交付状态：待验收。2026-10-09最终由GROUP-01I完成6890d17/e3b7xf81l生产验收，后端已上线，界面/媒体另验收；见[GROUP-01I](GROUP-01I.md)。以下保留原独立实现和交接证据。负责人 `codex-f-01a0c7c8-group01-20261008`。2026-10-08 主表短锁领取成功，依赖 PLAY-01 已生产验收。独立树 `.local/worktrees/group-runtime`，分支 `codex/group-runtime`，基线 `50fcaca`；专属 PostgreSQL 55443、预览 3237；迁移 0038 由集成人预留。日期按 Asia/Shanghai，收尾为 2026-10-09。

主登记目录的 DEVELOPMENT.md 是唯一状态源。本树不改其他 Agent 文件，不改共享 services、worker composition、World 事件联合/replay 或公共输入契约。NAR-02R 的 52213cf 已交现集成人验收，原范围和资源已释放，不再改 NAR。

## 本次精确文件（16 个）

- `db/migrations/0038_groups.sql`
- `src/modules/world/domain/group-runtime.ts`
- `src/modules/world/application/group-ports.ts`
- `src/modules/world/application/group-turn.ts`
- `src/modules/world/infrastructure/group-repository.ts`
- `src/modules/world/infrastructure/group-planner.ts`
- `src/modules/world/infrastructure/group-task-handler.ts`
- `src/server/group-services.ts`
- `src/app/api/v1/worlds/[id]/groups/route.ts`
- `src/app/api/v1/worlds/[id]/groups/[groupId]/route.ts`
- `src/app/api/v1/worlds/[id]/groups/[groupId]/messages/route.ts`
- `src/app/api/v1/worlds/[id]/groups/[groupId]/members/route.ts`
- `tests/group-runtime.test.ts`
- `tests/group-planner.test.ts`
- `tests/integration/groups.test.ts`
- `docs/task-reports/GROUP-01.md`

此外仅按短锁更新主表本人行。`.local/group01-*` 是忽略的本地测试工具、合成数据和证据，不进入交付提交；服务端密钥未记录在报告或提交。

## 已实现能力

四个真实 PostgreSQL 投影表：群、成员历史间隔、消息、已读位置。成员只能是同一世界已有角色/玩家；加入包含当前版本，退出不含该版本，重入保留中间信息不可见。使用 PLAY 的同一历史过滤，已退出 NPC 不接收新上下文。已读单调前进，必须指向当前玩家可见的真实群消息；返回未读数量和每条消息的故事时间/系统提交时间，刷新后恢复。成员间隔达到契约容量时拒绝继续增长，避免保存后无法重新读取。

创建、成员变更和用户消息写入现有 World 事件/版本与 command receipt。用户消息与现有 scope=world Task Queue 入队同事务；模型结果通过已有租约围栏、版本/暂停复核，原子保存群消息、提议日程、World 状态、回执和任务结果。并发只执行一次，重复请求保留原接受版本/任务 ID；unknown 不自动重新调用，迟到结果不会越过成员变化/版本冲突。生产 Repository 全部 PostgreSQL，无内存仓储接线。

模型通常只调相关一名 NPC，上限可配置两名；明确 @ 优先，重复姓名不冒充角色 ID，不强制全员答复。模型只得到本人物资料、公共 canonical 事实、活跃成员称呼和该人物可见群历史（最近 80 条预算），不查询私聊/现实访谈/私人记忆，不传其他人物人设或私有事实。输出严格限文字与可选邀约；消息/邀约 ID 由运行时分配，模型不能改档案/世界身份或把邀约设为 confirmed。过期邀约拒绝提交。

API 使用现有登录会话、CSRF、严格请求解析与权限隔离：列表/创建、读取/已读、加入/退出/重入、发消息，以及 `PUT .../messages {taskId}` 显式执行。该 PUT 复用既有 PostgresTaskQueue/runOne，不创建第二套任务引擎、不在响应后继续运行；绑定 owner/world/group/channel，终态重复调用不再调用模型。

SQL 强制 RLS，来源触发器校验群 ID、实际世界事件/版本、真实作者、成员间隔、不可变消息和运行时消息 ID；伪造同一来源的新消息被拒绝。worker 需活跃 group/world 租约；没有给 worker 已读表权限。两个触发器是固定 search_path 的 invoker，不是 SECURITY DEFINER；执行授权不增加底层表权限。

## 验证证据与失败记录

- 最终 `npm run check` 341 项全部通过，模块边界 220 文件，typecheck 通过；包含 7 项群纯规则/模型隔离测试。
- `npm run test:db` 最终 54 项：52 通过、2 可选模型测试默认跳过，0 失败。新增 3 项真实库测试覆盖群入队/租约/事务、并发/幂等、跨 owner/world、伪造来源、私聊不污染、加入/退出/重入、已读刷新/单调性、暂停、unknown 不重付、在途成员变化，以及双人物回复和日程显式确认。
- 最终 `npm run build` 通过，群四个路径已编入实际服务；改动 TypeScript 文件格式检查通过。
- opt-in `GROUP_MODEL_EVAL=1` 的群测试实际调用 gpt-4o-mini，两种合成人生各一回合成功，任务 persisted succeeded/resultVersion=4；输入断言无 PRIVATE_*，有真实回复/事件来源读回，重复执行没有第二次模型调用。该项与普通 stub planner 测试分开，不把 stub 当真实模型。
- 模型证据 `.local/group01-model-eval.json`：纪录片 `100f2a4e-fa7f-4ed0-9186-decec759e6c8`，来源 `8577b6a7-5efc-4a4f-8672-5fcd2f6a715b`；面包店 `b10492a6-e98a-4386-ac9a-ef5895b007bc`，来源 `81a74931-2fcf-4f36-9db6-e0dac35f7e33`。回复分别“没问题，我会专注在摄影上，准备好你想要的机位。等你决定好顺序，我们再一起调整。”及“好的，没问题！你想做哪两种配方？我这就准备试试。”原始 JSON 留存于本地合成证据，两个未来邀约都仅为 proposed。
- 本树 PostgreSQL 18.4、55443 的 dev/test 都执行了 36 个既有迁移 + 0038，共 37 条。本树基线没有 0037；这不是生产迁移顺序证明。0038 未发布草稿曾在本人空群投影表上重建复验；先核验端口与群表为空，只删除本任务表/函数/迁移记录，保留其他迁移/数据。没有改已部署迁移或触碰其他 Agent 的数据库。
- 早期 check 受沙箱 EPERM 阻塞，获网络执行权限后通过。真实库全量发现 trigger EXECUTE 授权不足，修复后重新迁移/全量通过。早期一次 opt-in 模型结果被 INVALID_COMMAND 拒绝；当时未捕获原始 JSON，不能断言唯一根因。随后增加明确未来时间诊断与原始结果捕获，两身份验证通过；不自动重付失败任务。模型仍有帮助型口吻，仅证明隔离/落库/主题回复，不证明长期剧情质量。
- 本地生产构建 HTTP 首轮：群创建/重复创建、CSRF、队列/真实模型、历史/来源/时间、重复发/执行、已读、退群/重入、跨群/用户任务拒绝均成功；最后错误拿直接 initialize 的合成世界调用依赖 build 来源的手机接口，得到 404。此为测试 fixture 不满足手机入口来源，不修改公共手机 API；失败证据留 `.local/group01-http-first.json`。改为真实 World Repository 私聊回归和另一群历史隔离后重跑，21 项 HTTP 请求全部符合预期（含 401/404/422 拒绝反例），task succeeded、gpt-4o-mini/group-v1 有数据库记录。回复“我觉得开场用手持镜头更能抓住观众的注意力，不过静态镜头也有它的魅力。你想先试哪个？”，来源 d17092e7-d650-4844-bef0-13dca7f79e99/version4，证据 .local/group01-http.json/.log。合成账号均清理。

纯领域 reducer/调度规则和 stub Planner 用于反例测试，不冒充真实服务；持久化、RLS、队列、API 与两身份模型上述各有真实证据。未做 UI 改动，没有截图或手机/PC 产品体验验收。

## 集成人接续点（公共文件不由本 Agent 修改）

1. 串行合并本独立提交到统一业务基线；先验收迁移 0037，再应用本次 0038，核验 checksum 和授权一致。
2. `GroupEvent/isGroupEvent/applyGroupWorldEvent` 在 `group-runtime.ts`。共享 World 事件联合、历史 replay/branch dispatcher 必须接上四种 group 事件；群消息保持独立投影，不追加到私聊。只读当前快照可用不等于历史重放/分支已经兼容。
3. `groupTaskHandler(queue, planner, model, options)` 作为既有 world scope dispatcher 的 channel=group 分支，和 scene/private 等标识明确区分，禁止多个 handler 抢同一 scope。`WorldGroupPlanner` 默认一人，可配置最多两人。专属 HTTP PUT 已可执行，但全局 `/tasks/:id/run` 和通用 worker 仍需此接线；未接线前不要让旧 world handler 消费群任务。
4. GROUP-02 对接：POST 群返回 groupId/version/eventId；消息 POST 返回 task/groupId/原接受 version，PUT 执行/读任务；GET 群返回 messages/messageTimes/unread/lastReadVersion，PATCH `{throughVersion}` 更新已读；成员 POST `{commandId,expectedVersion,participant,action}`。列表返回已保存群/成员，群摘要/未读需读取详情，尚无 UI 列表通知组装；成员展示可复用 World 角色名/头像。
5. PLAY 的 GroupMessageRequest 当前只有 text，没有资产请求字段。本批 media=[]，不实现群图片分享，不假称照片已发送。需要集成人协调 ready 资产+分享来源的公共请求契约，再登记实现；本 Agent 不越界扩输入。
6. 前端群 UI/锁屏通知、导演提出群的产品流程、历史分支群投影重建、完整群媒体尚未验收。本批不称 GROUP-02 或多人真人联机完成，不自动领取其他任务。
7. 现有唯一集成人负责生产库/提交推送/Vercel READY/公网群关键流程和手机-PC 验收。本任务只交待验收，尚未上线，不另行抢占部署或勾完成；本工作树基线不是当前线上版本。

## 交付与资源

本报告随独立提交，最终 SHA 以主表本人行和 git log 为准。当前主表 NAR-02RI 已验收记录的统一业务版本为 1dc7c45 / 4gz1pogvu Ready；本 Agent 未重新确认当前生产别名，不能以工作树基线或本地 API 当成当前线上版本。GROUP-01 未部署，生产验收交现集成人。

收尾已核验本任务预览 3237 的 PID/cwd 与 PG55443 的 postmaster.pid/数据目录，测试服务将在交接时停止，释放端口。工作树、迁移及本地合成证据保留，未删除其他 Agent 进程或锁。
