# ARCHITECTURE-SIMPLIFY-37-S：调度与自主复盘读取精简

基线：9f495c63。负责人：scheduler-simplify37。独立工作树：`/Users/limengzhe/.codex/worktrees/scheduler-simplify37/人生剧本`，分支 `codex/scheduler-simplify37`。root 统一集成、原档验收与本地运行更新。

## 已实施

1. **退出终身历史扫描/4096硬上限。** `readOwnAgendaReviewEvidenceInTransaction` 同一条只读 SQL 选取：最近已提交人物状态后缀、最新完整私聊锚点、最后一次实际呈现、当前锚点相关调用、全部未解决人物调用及其原锚点。原 command/event/receipt/消息投影认证保留；已完成历史锚点不递归重新审批其之前所有调度决定。
2. **quiet 后缀按政策饱和长度读取。** authority 根据现有 realGap/maxRealGap/multiplier 计算足以达到最大退避的后缀，加前驱用于相邻状态比较；不为每个 NPC 新增游标/议程字段。`quietStreak` 在长历史下是已认证后缀长度，饱和后不再需要精确累计终身次数；不是删去未完成工作。
3. **transportHistory 定向读取当前 grantId。** 不再获取所有含 npc_agenda_review 的输入后再在 JS 全量筛选，不再有4096寿命上限。当前 family 全部运输尝试、付费保护与零发送接续仍核验。只取 `has_response` 布尔值，不读取整份付费 response/snapshot 来判断是否存在。
4. **collect 无写锁。** `frame` 只在 accept/claim/send/commit 保留 `FOR UPDATE`；collect 可在真实 READ ONLY 事务运行。两次读取之间版本改变时丢弃混合候选，下次按当前状态收集，不创建提案或调用模型。
5. **worker/cron共用默认冷却。** 应用层默认60秒冷却/60秒租约，worker从同一常量读取，不再分别是60与1800秒。批量规模仍由宿主资源配置决定，模型预算与人物资格未放宽。
6. **资格前移到 SQL 领取。** 迁移 `0123_proactive_eligible_claim.sql` 在原 `claim_proactive_worlds` 函数中先过滤 `continuity_mode='continuous'`，保留paused、epoch、trial、删除、租约与公平性。删除server领取后逐世界查clock/再跳过的重复流程；presence-only不会消耗租约、不会虚计advanced。前台进入/交谈入口不受此后台资格限制。
7. **必要查询索引。** 同迁移增加一个已提交人物attempt复合索引，支持按人物修订取最近后缀/anchor；没有新增表、列或持久业务状态。移除local wrapper的冗余continuousOnly选项。

## 验证

独立 PostgreSQL 18.4：127.0.0.1:55683，独立dev/test库；没有连接或写入用户克隆档、生产库。全部模型为受控适配器。

- `tests/integration/own-agenda-window05.test.ts`：8/8（含父项）。已有 quiet/await_response 接续、unknown/invalid不重买、partial不变为完整锚点均通过。
- 新用例加入4200条已取消旧运输记录；返回证据history小于10条、当前anchor/family完全不变、无新增模型调用；collect在 `SET TRANSACTION READ ONLY` 下产生合法候选。
- `tests/integration/local-proactive-worker.test.ts`：1/1。原SQL公平领取、两进程争用唯一租约、暂停保护、presence-only领取0/advanced0，进程生命周期通过。
- `tests/local-proactive-worker.test.ts` + `proactive-scheduler.test.ts`：5/5。共享默认参数及有界不重叠循环通过。
- `proactive-scheduler199`：1/1；100个合格世界分两批领取，无遗漏、重复或越权，60秒冷却边界通过（受控执行，不是模型吞吐）。
- `typecheck`：通过；`check:boundaries`：765 files通过；涉及文件Prettier、diff check通过。
- 未重复全量check/build；由root集成后执行。未运行真实模型、未部署、未重启3218/3219。

## 限制与接续

- 本批证明调度与证据读取，不证明原渣男体验人物已产生主动剧情。
- 查询返回材料有界化，不等于所有 SQL 扫描成本严格 O(1)：最后呈现/当前family定位仍查询原表，索引收益需要实际长世界执行计划与耗时对照；未声称回复提速百分比。
- 当前 family 的未解决/零发送历史不能随意截断，因此这一类相关记录全部保留；不以窗口隐藏unknown。
- 旧 `own-agenda-review-evidence` 夹具在 `commitOriginalQuiet` 的初始化来源准入先报VERSION_CONFLICT（在进入本批证据读取前）；只更新其单SELECT断言允许WITH，不放宽业务校验。旧 `own-agenda-runtime` 固定端口55587，未改。当前原入口window05提供本批运行证明。
- 本批没有把所有阶段认证都删除：可变权限、预算、租约、人物修订在执行阶段仍需核验。不可变材料进一步缓存/统一解析由root结合协议提交链处理。
- 迁移0123先应用再运行新server。函数签名不变，services.ts无需修改；回滚时恢复0109函数定义和旧参数政策，用户事件与历史不受影响。
