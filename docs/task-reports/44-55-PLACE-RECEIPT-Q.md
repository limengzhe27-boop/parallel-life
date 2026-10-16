# 44-55-PLACE-RECEIPT-Q：地点发现同事务最终版本与因果回执

状态：待验收。负责人 `codex-ma-arch44-55-place-receipt-q-20261015`，root唯一集成/生产负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-55-place-receipt-q`，基线为root冻结 `e7ee694e`。先按确认A-E方案在主表短锁登记，未取root WIP。仅改：

- `src/modules/world/infrastructure/postgres-world-repository.ts`。
- 现有 `tests/integration/publication-story.test.ts` 的隐藏地点相关验收与类型导入；后经root明确扩大登记，修正同文件wrongactor叶项的拒绝时机断言。
- 本报告/主目录镜像/本人状态行。

settings/domain/public/SQL迁移/CI/其它源码与测试未修改。测试中的临时故障trigger仅在自有本地库创建并finally删除，没有修改产品迁移或授权。

## 复现与最小修复

真实PG先跑原publication-story文件：31节点，27pass/4fail，正是两个隐藏地点叶项VERSION_CONFLICT、原错误人物叶项INVALID_STATE及父套件失败。

原链路在保存NPC消息vN后，同SQL的reconcile增加place_revealed vN+1。WorldRepository仍以局部state vN构造后续ActorContext，进度ledger拿旧版本对照数据库新版本而拒绝，合法消息与地图发现整笔回滚。

现在仅在`legacyProgress !== false`原分支：

1. 保留原NPC事件/命令身份、原expected_version和临时succeeded回执，供既有reconcile核对真实原消息来源。
2. reconcile后在同一SqlClient读取真实当前world并hydrate，用最终版本构造ActorContext，传进度评估；initial source仍是原NPC event vN，未伪装成发现事件。
3. 评估后再次读取最终state/version，将原command.result_state固定为compact后的最终快照，带world/id/owner/status=succeeded/result_event_id=原event约束，实际rowCount必须恰好1，否则整事务拒绝。仍执行现有容量限制。
4. 返回`{state: finalState, event: 原NPC事件}`。例如state=vN+1而event=vN：这是一次因果提交结束时的世界快照与它的原始角色事件，不修改不可变event版本或发现事件因果引用。重放沿既有saved()/hydrate使用固定快照版本，之后新输入不能把旧回执抬到更晚世界。

`legacyProgress:false`原生NPC分支未改变，其返回与受保护提交规则仍按原路径处理。没有吞VERSION_CONFLICT、放松来源/epoch/RLS或修改settings接口。

## 真实PG验证

自有PostgreSQL18.4 / 55565，沿用项目真实迁移。`PUBLICATION_STORY_TEST_PORT=55565 node --experimental-strip-types --test tests/integration/publication-story.test.ts`：修正后 **31节点29pass/2fail/0skip**。

两个隐藏地点叶项均通过，包含新增实际证据：

- 在**首次实际producer commit前**加reveal事件故障，精确收到P0001/LOCAL_REVEAL_FAILURE；世界全文、commands/events/messages/appointments/Outbox、node/receipt/progress/evidence计数全部回到原状，原command不存在。不是先成功写入后另开事务INSERT失败。
- 第二个临时trigger只把原command最终vN+1的UPDATE返回NULL，实际命中rowCount=0守卫，精确VERSION_CONFLICT并整笔回滚。证明不会留下旧回执与新世界混合状态。
- 删除故障后以**同command、同原sourceEvent**恢复，NPCevent身份/期望版本不变，state为最终vN+1；原command.expected_version和result_event_id不变，result_state.version为最终版本。
- actual commit所在事务执行`SET CONSTRAINTS parallel_life.command_same_event IMMEDIATE`，真实延迟FK通过。另查询真实pg_catalog确认该约束确为DEFERRABLE INITIALLY DEFERRED的world/id/original-event FK，commands无其它非内部trigger；不是仅按静态SQL假定。
- 首次返回、同command再次执行、显式receipt读取三者深度相等，事件/回执数不增加。不同的后续玩家输入写入后仍返回旧final快照；后续玩家实际旅行到医院后再读旧回执，也不会虚构此前已经到达医院。
- 原地图验收继续保留：作者未知地点仅经真实NPC消息来源发现；多地点分别发现且独立稳定route ID；地图可读取；发现时player.currentPlace仍原地点；另一owner世界不被同步揭示。

**第一轮保留失败**：原“actual reply from wrong actor/command cannot fulfill a claimed node”叶项在实际错误commit时被reconcile提前INVALID_STATE拒绝，测试却在下一步finish才包assert.rejects。第一轮未改该断言，安全守卫未移除，剩余2fail为该叶项及父套件，曾如实报告为未绿。

root接收源码修复后明确授权扩大该叶项测试范围，已在主表短锁登记后追加**仅测试/报告**修改，业务源码保持 `de0ee5a3` 冻结不动：actual wrongActor commit精确assert INVALID_STATE；原world全文及commands/events/messages/appointments/facts/Outbox/node/receipts/progress/evidence整行快照均未改变。随后合法原claim成功，source event绑定正确人物和原command，finish可读取，重复同command返回原结果且上述真实表无重复。其它独立wrongcommand断言不动，未允许错误人物先落库、未吞异常或删安全项。

此追加后同文件最终真实PG **31/31通过，0skip**，日志 `/tmp/44-55-final.log`；这是正确前置拒绝的验收时机修正，不是业务兼容旧错误行为。不因此声称全库通过。

为验证原生路径没有受影响，聚焦运行现有实际入口：`node --conditions=react-server --experimental-strip-types --test --test-concurrency=1 tests/integration/agent-travel-kernel.test.ts tests/integration/agent-question-entry.test.ts`，**13/13通过，0skip**。覆盖原生问题承接与隐私、一次NPC调用、出发/连续抵达、afterCommit原子回滚及protected raw恢复、unknown不重复调用。

typecheck、两个修改文件Prettier、边界检查（556文件）、git diff检查通过；最后测试扩围再次typecheck/format/diff通过，未重复整套native或全库。日志 `/tmp/44-55-before.log`、`/tmp/44-55-after.log`、`/tmp/44-55-native.log`、`/tmp/44-55-final.log`。0真实模型、0生产、0浏览器/公网、0fullcheck/build；所有模型输出是明确合成fixture，真实证据来自实际PostgreSQL和实际Repository/kernel/HTTP链路，不是内存仓储。

root接续：先接源码独立提交 `de0ee5a3`，再接测试/报告扩围的后继提交，统一最终check/build/部署READY/公网验收；本修复没有新迁移。当前不能称已上线，原“渣男体验”草稿未修改/发布。其余旧epoch1失败仍需按54处理，新架构边界不做旧行为兼容。

资源收尾：自有PostgreSQL正常停止，55565核无监听；没有停止其它Agent服务，临时测试trigger/function均已删除。
