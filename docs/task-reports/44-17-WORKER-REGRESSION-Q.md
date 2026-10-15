# 44-17-WORKER-REGRESSION-Q：旧 worker 回归与引擎权限边界

状态：待验收。负责人 `codex-ma-arch44-17-worker-regression-q-20261015`，root 为唯一集成人与上线负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-17-worker-regression-q`，冻结基线 root `36c6d96372ec63bfae25d7fb85e07de93dd2b698`。主表先登记，实际入口最小测试提案获 root 明确批准后实施。

仅新增：

- `tests/integration/agent-worker-projection-boundary.test.ts`
- 本报告及主目录镜像/本人登记。

所有业务源码、SQL、公共配置与已有测试只读。PG `55565` 启动前已核无监听，使用自有忽略目录，没有访问 root 的 55564 或生产库。

## 回归原因与本次结论

root 的 `.local/ma44-phase2-ci-failed.log` 记录旧群聊、现场与相关剧情执行发生 `42501`；其中实际 group worker/scene worker 原成功路径失败。root 定位到共用 `projectAgentWorldChange` 先查询 0072 owner-only 表，旧 `pl_worker` 没有权限，导致本来合法的 epoch1 提交整体回滚。

root `36c6d963` 仅在 helper 入口识别纯 worker（worker=true 且 app=false）并返回；没有给 worker 新表权限。旧 epoch1 不执行 Agent 投影；epoch2 旧 worker 的最终 world 写仍必须被 0072 数据库围栏拒绝，新 epoch2 的真实 app facade 则正常投影。

本次真实 PostgreSQL 证实该限定修复成立，不为整库 CI 或产品上线背书。

## 新测试能力与真实入口证据

新增测试使用实际 `PostgresTaskQueue` 的 worker 连接 claim/read/commit、真实 owner 创建/发送/进入接口和原 `groupTaskHandler` / `sceneTaskHandler`。仅 planner 输出明确标记的合成提案，**不调用真实模型，也不使用内存仓储**。

1. epoch1 群聊和现场实际 worker 提交成功，消息/时间地点和父任务 succeeded/resultVersion 持久一致，无 owner-only Agent 投影。
2. epoch2 仍故意直接调用旧 handler，验证确切 `23514/ENGINE_EPOCH_CONFLICT`，不是以别的失败冒充守卫生效。world 版本、结果 event/command、群回复或开场 entry 无部分写入，observer cursor 不前进；父 task failed，不伪造 NPC attempt 或自动重跑。
3. 在实际已 claim 的 worker lease 下读取角色身份，确认 worker=true/app=false。9 个 Agent/director/位置表的 `has_table_privilege(..., SELECT)` 为 false，逐一真实 SELECT 都被 `42501` 拒绝。修复未扩大这些权限。

CI 端口配置：新增测试读取 `AGENT_WORKER_PROJECTION_TEST_PORT`，未设置时仅允许本人分配的 `55565`；root 已确认 CI 使用该变量。未改公共 test 配置。

## 运行结果

|检查|结果|
|---|---|
|新增 `agent-worker-projection-boundary.test.ts`|真实 PG **6/6 通过、0 skip**（父测试+5场景）|
|已有 `groups.test.ts` 与 `scenes.test.ts` 串行|真实 PG **5 通过、0 失败、1 明确 skip**；skip 为 opt-in 真实模型评估，未调用模型|
|已有 `npc-native-service.test.ts`|真实 PG + 模拟模型 **5/5 通过、0 skip**；实际 epoch2 app 入口正常提交并保留私聊决定与群回复定位，说明没有误跳过 app 投影|
|`npm run typecheck`|通过|
|模块边界检查|541 文件通过|
|新增测试格式与差异检查|通过|

合计 17 个测试节点：16 通过、0 失败、1 opt-in 模型 skip。未跑全量 check/build；未把节点数当成真实模型/完整场景产品验收。

验证库为真实 PostgreSQL 18.4，项目 migrate 已执行至该基线包含的 0075。没有新增迁移，没有修改数据库授权，没有操作生产数据库。

## 未完成边界与集成人接续

root 统一接本测试并部署 36c6d963 热修，等待 READY 后验收公网旧群聊和现场关键流程，再标完成。本任务未自行上线，未修改或发布“渣男体验”原草稿。

本轮新 epoch2 app 证明限于已有 native 群聊链路。**没有把 44-14 的环境开场通过当成“环境 → 后续 NPC”端到端通过**：root 已发现 `requireInputAuthority` 的现场来源 SQL 仍只识别旧 `worldResults.scene.presence`，新确定性 `environment.presenceProofs` 需要精确授权接线，否则后续人物 claim 会被 INPUT_SCOPE_FORBIDDEN。root 负责共享 store 修复，须同时验证实际 deterministic event、原独立位置来源和当前实际 presence，不能只看 producer 标签。

44-14 当前还没有由本测试证明正式 dispatcher 激活、真实环境之后 NPC 可接话、导航冲突恢复或公网可用。后续在 root 冻结共享授权修复后，可另登记实际环境开场 → 玩家输入 → 同 NPC runNpc 的真实 PG 回归，不在本轮扩写源码。

本轮 0 真实模型、0 浏览器、0 生产、0 完整构建；全部新增是实际入口的数据库回归测试与报告，不是新的领域运行实现。

资源收尾：自有 PostgreSQL 已正常停止，55565 已核无监听，未停止其他 Agent 服务。
