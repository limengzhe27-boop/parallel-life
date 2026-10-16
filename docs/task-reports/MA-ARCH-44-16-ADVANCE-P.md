# MA-ARCH-44-16-ADVANCE-P：实际推进服务数据库回归

状态：待集成验收，P 测试文件冻结。主集成人仍负责源码、全量检查、部署及真实模型产品验收。日期：2026-10-15。

## 范围与基线

- 执行者 codex-ma44-advance-p；线程 01a11a84-9572-7ab0-92fb-967f963dfc20。
- 独立工作树 publication-story-02/人生剧本，分支 codex/agent-advance44。
- 本批仅新增 tests/integration/npc-agent-advance-service.test.ts 与本报告；主登记目录仅本人行和报告镜像。源码、迁移、配置未修改。
- 初始26013774；接根冻结beeb8906（blocked候选提前过滤）、cd72d339（真实导演快照，随依赖接入）及d0025a0d882f8c0b5236ed3fea07acf5c5c90143（实际advance路由及raw恢复）；最终测试基线d0025a0d。
- 真实本地 PostgreSQL 55566、75项迁移；独立合成owner/world，不读取生产或编剧草稿。模型全部注入显式mock TextModel。

## 复现与根修复

1. 源码审查发现：有pending material reason时，导演可能先接收含blocked候选的列表并保存决策/评估游标，随后才在执行入口拒绝。已报根；根beeb8906在协调前排除blocked候选，本批严格负例确认无决策、evaluated游标不前进。
2. 故障注入实际发现：模型raw已durable、kernel提交失败后，response_received可能被活跃attempt blocker挡住，永远到不了恢复入口。已报根；根d0025a0d在候选调度前恢复已有private raw，本批确认恢复不再构造或调用模型。

上述修复由根编写，本批没有复制或修改业务源码。

## 新增实际PG测试（12子项 + 父节点，13/13）

- epoch1在模型/reader/new state前返回null；另一owner不可读。
- epoch2无候选安静返回：0模型构造、0消息、0事件、0attempt。
- 暂停世界即使有ready计划也不接收唤醒，不构造模型。
- ready角色走真实新kernel，允许quiet原子保存状态；没有伪造消息。
- 同一语义计划在B无关消息及world version变化后不重复购买A调用。
- A unknown只阻塞A，B仍执行；不自动重试unknown。
- 已知失败candidate按资源阻塞，同一A的另一候选仍可运行。
- 真实玩家拒绝经private service进入决策状态；advance再次给A保留拒绝、persona和本人去向，不生成实际到达位置。
- 真实B plan_changed触发导演；quiet完整defer且没有新增world event/NPC调用。不手插pending reason。
- 使用真实PostgresDirectorSnapshotRepository实例，实际advance→导演模型解析/协调→SQL决策与evaluated游标→NPC kernel完整串接。
- blocked候选不进入导演可选列表；恶意选旧ID明确INVALID_DIRECTOR_PROPOSAL，decision0、observed1/evaluated0。
- agent_action_results插入处注入SQL失败：world event、command、result、actor revision均回滚；protected raw保留response_received；再次advance恢复1个结果/事件/消息/actor revision/awareness，模型调用及factory仍为1。

所有advance mock model调用阶段检查pl_app无idle-in-transaction，且实际world行FOR UPDATE NOWAIT可取得，确认模型期间未持有该世界写锁/长事务。A实际输入检查不含B_PRIVATE_SENTINEL及DIRECTOR_GLOBAL_AUDIT_SENTINEL。

## 验证证据

- 新增PG：13/13通过，0失败/0跳过。
- 联合真实PG：npc-agent-advance-service + npc-agent-kernel + director-runtime，44/44通过，0失败/0跳过；NPC_KERNEL_TEST_PORT=55566，串行运行避免注入故障影响其它套件。
- npm run typecheck：通过。
- npm run check:boundaries：543文件通过。
- 新文件Prettier检查及git diff --check：通过。
- 忽略的本地日志 .local/ma44-advance-pg.log、.local/ma44-advance-joint-pg.log。
- 本批按根限定范围仅focused/type/boundaries；未独立执行全check/build、部署或生产验收。根完成集成全量门槛后才可标已完成。

## 限制与接续

这是实际数据库/服务/解析/事务执行测试，模型输出仍为mock。拒绝/本人计划测试证明状态与输入保留，不证明真实模型一定温和、少重复或有明确人格。未验证真实AI多轮质量、真实worker/HTTP/公网全流程，未启用生产epoch2，也未发布任何世界。没有花费用户授权的16次真实模型额度或创建生产测试存档。

主集成人接收本测试后串行全量check/build与迁移确认、受控部署/READY/公网测试，再使用根掌握的真实模型预算完成产品验收；结束按用户要求下架测试作品并暂停存档。本批本地合成世界clock已在test.after暂停，PG55566结束释放；不改真实玩家数据。
