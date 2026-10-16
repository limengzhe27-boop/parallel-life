# 44-19-ENV-NPC-Q：确定性现场至人物回复的实际服务回归

状态：待验收。负责人 `codex-ma-arch44-19-env-npc-q-20261015`，root 唯一共享契约、代码集成和部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-19-env-npc-q`。基线 root `ddc59465592ba37c4ab67a5eaf5a011871ca4697`（其上已有 cd72/d002 实际路由与观察快照接线）。开工前已按短锁登记。

仅新增 `tests/integration/agent-scene-npc-service.test.ts` 和本报告/主目录镜像/本人登记。业务源码、公共契约、SQL、旧测试没有修改。端口启动前核空，使用自有忽略目录的真实 PostgreSQL 18.4 / 55565。CI 使用 `AGENT_SCENE_NPC_TEST_PORT`；默认只允许本人分配的 55565。

## 结论与实际覆盖

root 对 `requireInputAuthority` 的修复在实际链路中通过：新原生确定性环境已可支持后续 NPC claim，不再因只识别旧 worldResults.scene.presence 而误拒合法人物。未发现本基线的 SQL 执行错误。

真实数据库正向链路：

1. 真实 owner/world/人物初始化，建立有成功事件来源的、更早独立同地人物位置；切换 epoch2。
2. 实际 SceneRepository.enterPlace 保存进入、回执、持久任务；真实队列 claim 后调用 sceneEnvironmentTaskHandler。环境只写 time_place；人物 presence 来自原独立位置，另一联系人不被带入。此时 **0 NPC attempt / 0 模型调用**。
3. 实际 SceneRepository.input（当前类没有 act 方法）保存玩家原话、scene action、accepted input receipt 与下一持久任务。
4. 真实队列 claim/lease → scoped 应用数据库 → nativeNpcTaskHandler → 同一 runNpcAgent/kernel → 明确注入的模拟 NPC 模型，**恰好调用一次**，模型期间没有 SQL 连接占用。
5. 原生 scene.reaction_recorded、人物状态/问题指针、真实 scene dialogue entry 与父任务 succeeded/resultVersion 在同一提交链路保存。对照实际 AgentAttempt 的 committed/eventId，问题指向实际 scene 消息 UUID；不向 world_messages 制造假私聊。
6. 使用真实 SceneClient 解码实际 SceneRepository DTO，核对对白、身份、事件版本与来源；重复玩家命令回放原任务，不再调用模型。另一 owner 读取被拒。

手机验证是客户端 schema/来源检查，传输层为测试注入的 Response，**不是 HTTP、浏览器、手机截图或公网验收**。没有把 NPC 回答冒充玩家物理行动成功：本例 scene action 没有伪造 resolution。

## 负向与原子恢复

以下均在自有测试库对明确合成夹具施加改动，不是生产写入，也不声称已实现真实 actor.travel/leave 能力：

- 环境 producer 改为 fake。
- 人物 proof 改为原进入事件，来源不早于 entry。
- 环境父任务 result_version 与环境事件版本不符。
- 当前人物权威位置改为 unknown，不能继续借更早同地证明授权。
- presence 区间记录人物已离开，不能继续响应现场输入。

前四项均明确 INPUT_SCOPE_FORBIDDEN，人物离开在实际 responder 前拒绝；所有负例 **0 模型调用、0 NPC attempt、0 新对白/子命令、世界版本不变**，父任务失败，无假成功。

另在实际父任务最后成功 UPDATE 处用本地临时触发器注入 lease 过期，验证 LEASE_LOST 时 event/command、world、scene 对白、人物 revision 和父 task 一起回滚；之前已保存的模型响应保留为 response_received。删除故障后同一真实 lease 恢复，复用原保护响应，累计模拟模型调用仍为 1，最终恰好一条对白、人物 revision=1、任务 succeeded。临时函数/触发器在 finally 删除。

## 验证与交接

- 专项：`node --experimental-strip-types --conditions=react-server --test tests/integration/agent-scene-npc-service.test.ts`，**8/8 通过、0 skip**（父测试+7场景，真实 PostgreSQL + 模拟模型）。
- `npm run typecheck` 通过。
- 模块边界检查 543 文件通过；新增测试格式与差异检查通过。
- 本轮 0 真实模型、0 生产库/发布、0 浏览器、0 fullcheck/build；没有修改数据库迁移或权限。

历史在场证明夹具沿用 44-14 方式：通过真实旧 epoch1 scene writer 保存明确标记的合成历史提案，再由实际 awareness 提取位置；没有调用旧 ScenePlanner，也不允许新 runtime fallback 到该旧路径。该夹具不是“新世界已支持自动生成所有 NPC 初始位置”的证据。

root 接续：集成本测试，CI 配置 AGENT_SCENE_NPC_TEST_PORT，统一实际 dispatcher/HTTP runner、全量检查、构建、生产迁移、READY 与公网验收。此处证明的是直接实际服务链路，没有借测试通过声称 d002 的公网入口、导演完整自主行动、通用玩家执行/移动或环境模型均已验收。原“渣男体验”草稿未动、未发布。

资源收尾：自有 PostgreSQL 正常停止，55565 已核无监听，未停止其他 Agent 的服务。
