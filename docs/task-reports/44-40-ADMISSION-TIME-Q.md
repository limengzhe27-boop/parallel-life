# 44-40-ADMISSION-TIME-Q：滚动部署期间数据库准入时间兼容验证

状态：待验收。负责人 `codex-ma-arch44-40-admission-time-q-20261015`，root 唯一源码/SQL/集成/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-40-admission-time-q`。基线 root `0d0db263`；接收root独占79迁移`3b9f2694`为本树父提交`1638397f`，未修改迁移。已按主表短锁登记，并先将直接SQL方案发送root。仅修改现有 `tests/integration/publication-genesis-time.test.ts` 和新增本报告/主镜像/本人状态行，不动其它源码/公共契约/SQL/CI。

## 目的与实际路径

78把准入里的作者时间按UTC毫秒规范后严格比较，新compiler输出也是规范时间。但“先应用生产迁移、再部署新代码”的窗口，旧compiler仍输出无毫秒Z或更多小数，可能被新的严格字符串守卫拒绝。

root79在既有SECDEF publication_commit_internal内部对prepared.world四处运行时时间规范化，再执行原准入/来源守卫。不写作者draft/version。本任务验证该真实边界，不能让新版应用层validatePrepared提前拒绝旧格式，然后把失败错算成数据库验证。

测试保留原44-35三种开场时间：无毫秒Z、`.123Z`、`.9999999Z`；双方历史有普通Z和玩家`.9999999Z`消息，邀约有`.123456Z`。

每种情况：

1. 实际PublicationRepository.create/check ready/local synthetic publish；保留现新版startTrial与startPublished流程。
2. 新建同内容合成trial作品，防止同稿已存在trial导致直接重放而不调用commit；另建真实新玩家用于legacy published准入。
3. 在实际pl_publisher（设置真实publisher.principal_id）或pl_app owner事务，调用真实publication_admit_trial/published获取新ticket、来源content/origin、世界/owner/seed身份。
4. 实际publicationWorldCompiler生成完整prepared，**仅将旧compiler原样赋值的四处时间恢复为该真实作者稿的字符串**：world.time、messageHistory.startAt、历史messages.at、appointments.at。不是旧生产进程实跑，但该payload精确重现旧compiler时间赋值；没有伪造ticket、身份、来源、事件或SQL返回值。
5. 直接调用实际publication_commit_trial/published SECDEF，不经过新版repository.validatePrepared。确认客户端入参仍保留raw字符串，规范化只在数据库内部发生。
6. 实际PostgresWorldRepository读取、saveNote、刷新确认持久化。对数据库worlds.state的当前time/messageHistory和world_initial_snapshots.state的历史消息/邀约逐项比对，均为UTC毫秒格式且时刻与JS Date.parse一致。`.9999999Z`存`.999Z`，没有先被PG舍入跨秒。

初始历史消息/邀约保存在不可变world_initial_snapshots，后续worlds.state会被正常便签写入压缩；不能错误要求压缩后的messages数组仍存全历史，或要求尚未产生动态事件的world_messages投影已有初始行。测试读取实际初始快照与Repository合并读取核验，没有构造额外投影冒充成功。

## 来源、防篡改与权限

- 作者draft全文与contentHash前后严格相同；legacy trial作品的整个draft前后一致；本地正式publication_versions.content/content_hash前后严格一致。
- 每种情况额外直接真实SQL准入，把world.time改动1秒再commit，必须返回SQL22023；实际worlds、approved_seeds、publication_world_bindings和publication_world_admissions均无该请求残留，证明事务回滚。
- 原44-35在新版应用入口对world.time/messageHistory.startAt/message.at改1秒的9个恶意compiler负例保留通过。数据库规范化格式没有放过来源时刻变化。
- helper `parallel_life.publication_runtime_instant(text)` 对pl_app、pl_worker、pl_publisher、pl_publisher_login的has_function_privilege均为false；用这四个实际SET LOCAL ROLE调用均收到42501。PUBLIC ACL没有EXECUTE。角色仅使用既有角色，无新增role/GRANT。

## 验证与限制

- 自有PostgreSQL18.4 / 55565，实际应用到root78+79。
- 专项命令 `node --experimental-strip-types --test tests/integration/publication-genesis-time.test.ts`：**5/5节点通过，0skip**（父测试、权限子测试、三时间子测试）。三个时间子测试各覆盖新版trial/published、旧格式直接SQL trial/published共4个世界，因此本轮正向实际创建12个合成世界。
- `npm run typecheck`、模块边界检查（550文件）、修改测试Prettier、git diff检查通过。
- 0真实模型、0生产、0浏览器/公网、0fullsuite/build。review仍为明确本地合成fixture，不把该review称正式模型或线上验收；不修改/发布原“渣男体验”草稿。

root接续：只接本人测试/报告独立提交，79已属root父依赖，不重复合并。统一最终check/build，确认生产78/79校验和与权限，再部署READY并验证公网新建试演和便签。此测试证明本地真实DB滚动兼容，**不表示生产迁移已应用或线上已发布**，也不回写旧存档。

资源收尾：自有PostgreSQL正常停止，55565核无监听，没有停止其它Agent服务。
