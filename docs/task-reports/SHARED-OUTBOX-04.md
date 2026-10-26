# SHARED-OUTBOX-04 · 正式后台共享 Outbox 发现与分发

负责人 shared-outbox-04-20261027（/root/arrival_continuity）。独立 `.local/worktrees/shared-outbox-04` / `codex/shared-outbox-04`，基线a0a9cfe3。root唯一集成、迁移和本地端口控制。0真实模型、0原档/生产数据写、0端口、0上线；不新增业务表、字段、队列或剧情执行能力。

## 已确认缺口

`src/workers/main.ts` 原先只调用原`runOne(queue,handlers)`。当已提交世界事件留下Outbox但HTTP没有继续分发时，正式常驻worker不会自行发现并转成任务。`.local`专用launcher使用本地admin只读找新scope，不能被冒称为正式跨owner发现接口。

## 实现

- 新migration0119仅提供`discover_due_outbox_scopes(limit,after_owner)`：只返回owner_id/world_id/event_id三项操作标识，不返回payload、提示词、用户文本。固定pg_catalog search_path，显式检查session_user为已有pl_scheduler成员，仅grant该角色EXECUTE；PUBLIC/pl_app/pl_worker无该发现权限，没有扩大后台写表权。
- 发现queued或running且lease已过期的scope；unknown/submitted/succeeded/failed/live lease不被发现。必须匹配原world event及其成功command/result_event_id，未正式成功的来源不参与。
- SQL每owner先轮到最旧scope，再轮到该owner其他scope；进程只保存afterOwner扫描游标，限1–32 scopes，不保存第二份业务状态。大owner不能独占所有批次，重启只重读metadata，实际claim/执行仍幂等。
- 新`PostgresOutboxScopeDiscovery`只接受pl_scheduler连接，复用原PostgresDatabase池/SSL设置。新`server/outbox-worker.ts`共享入口每5秒轻检查一次、最多4 scopes、每scope最多2 jobs，通过原`PostgresOutbox.ports(owner,{world,event})`和`dispatchOutbox`完成派发，原owner/RLS、claim/lease、maxAttempt=5、taskCommandId/hash、未知结果保护保持。
- 某scope临时不可用不会阻止同批其他scope；完整检查后仍以安全错误码上报，不伪报全部成功。已领取lease与已建任务仍走原恢复路径。
- 正式main worker原runLoop每轮先做有界drain，再原runOne。不增加付费并行，不给当前server另写引擎。drain临时失败不冻结已经入队任务；shutdown原20秒grace后关闭queue、scheduler发现池和app DB。

## 正式启动配置

现有`npm run worker`运行同一`src/workers/main.ts`。除已有WORKER_DATABASE_URL（pl_worker）、APP_DATABASE_URL（pl_app）及模型/素材配置，**现在明确要求已有SCHEDULER_DATABASE_URL（pl_scheduler）**，且0119必须应用到该正式数据库。缺失或角色不符明确启动失败，不能默默变回只跑queue。三个角色仍各司其职，应用不使用管理员。

本地与服务器可共用这个入口/相同业务代码，区别只是配置。但当前用户本地clone包含旧410 tasks/251 Outbox，需要继续使用root已有filtered launcher；本任务不绕过其排除manifest、不启动globaldrain、不处理任何原档历史任务。root可后续把该受限metadata发现接入保留manifest的本地launcher，不能直接无过滤启正式main对clone扫全库。

## 必要验证

独立PG55674/parallel_life_test应用原迁移+0119，真实PG8/8通过：

1. scheduler只取三ID且读取前后Outbox逐列不变；app/worker拒绝调用，scheduler无payload表读权限，PUBLIC无EXECUTE，非法限批拒绝。
2. 多owner限批轮转，单owner多scope不独占。
3. unknown/终态/live lease/未成功来源不被发现，expired lease可接续。
4. 合成actor media及scene media来源，经原owner派发入队各1次，再原runOne+受控handler各执行1次；重复drain不新增任务。此处仅验证队列，不冒称真实图片生成。
5. 模拟入队后、Outbox标submitted前宕机：租约过期后并发消费者仍复用原任务；原任务unknown保持unknown，绝不重新排队/模型调用。
6. 一个owner的受控DB错误不阻另一owner入队；源job保留queued，不伪报完成。
7. 无executor一次failed，不再发现；冲突重试保持原maxAttempt=5后failed，不循环。

独立单位2/2通过（禁止app/worker/admin凭据、无连接前拒绝非法批量）；typecheck0，boundaries通过。按root要求不重复全量check/build，集成人统一门禁。测试为合成来源与受控handler，0商业模型；未验收真实原档媒体、UI、进程重启或公网部署。

## 未扩展范围

- 正式main仍串行执行一个task，长图片期间同一进程的新一轮drain会延后；本批不擅自增加付费并行。可用相同受限入口的独立进程部署策略由root统一配置。
- 主动事件调度仍为root正在整合的共享scheduler；本任务只消费已经提交的Outbox，不创造NPC联系理由。
- 0119尚未应用实际clone/生产；由root按校验和统一迁移。
