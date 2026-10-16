# 44-14-SCENE-ENV-Q：确定性原生现场开场

状态：待验收，限定后端模块已实现，尚待 root 实际 dispatcher/回放接线与部署。负责人 `codex-ma-arch44-14-scene-env-q-20261015`，root 唯一公共契约/迁移/集成/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-14-scene-env-q`，基线 root `83a71e87`，接 root `8764d8f9`（本树 `008e958f`）和 root `f7bde0f2`（本树 `5fb68225`）。独占新 `src/modules/world/infrastructure/agent-scene-environment.ts`、新 `tests/integration/agent-scene-environment.test.ts`、本报告和主镜像/本人登记；既有源码/公共接口/SQL只读。专用 PG `55565` 启动前确认无监听，使用自有忽略目录，未访问其他 Agent 数据库。0 模型/生产/全量 check/build。

## 只读核对

- 0075/store 只保护导演调用、决策和 proposed episodes，不生成环境、物理位置或 presence。不可借导演 decision/episode 当到场证据，也不需要调用导演模型来完成确定性开场。
- 现有真实 enter/enterPlace 已保存 scene.entered、原命令成功回执、scene_receipts、仅玩家 presence、当前场景及 scene/actionId=null 任务。epoch2 不种旧事项。
- 新 NPC handler 对 actionId=null 明确拒绝 SCENE_ENVIRONMENT_MUST_BE_ESTABLISHED。现有 ScenePlanner/commitSceneProposal 混合环境、到场、对白和执行，本任务不复用。
- 现有输入就绪以 time_place entry 为证据。允许只保存实际时间地点即可放开输入，不需要伪造 NPC 或叙述。
- withLeasedAgentDatabase 核真实 pl_app/owner/任务 token/livelease/input/world/epoch，但不设置 0072 最终 world 写入的事务标记。
- authorizeWorldCommandInTransaction 仅允许真实玩家操作，环境任务不能冒充 scene_enter；NPC begin commit 又要求真实人物 attempt，也不能假造。
- 0072 fence 当前只核 app.agent_world_id 与 app.agent_engine_epoch；提议由本新模块内部的窄受信授权在真实环境来源与租约核验之后设置这两个值，不设置 app.agent_commit_attempt_id。是否批准由 root 决定，本人不擅改 SQL/公共 helper。

## 已发 root 的接口提案

`sceneEnvironmentTaskHandler(db): (lease, signal) => Promise<boolean>`：只处理 epoch>=2 的精确 world-scene/actionId=null，其他合法渠道返回 false。命中后的错误显式失败，root 接到 dispatcher，不回旧 Planner。

单次 scoped SQL 核：实际 task/owner/token/input/version → 原 scene.entered + 成功 command + scene_receipt.task.id/sceneId/version → 当前 scene active/currentScene/player presence/place → player 权威 at 与来源 → NPC 独立已提交 at 同地证据（无则零 NPC）。然后受信环境授权、稳定合法 UUID 子命令/事件，写 scene.opened、time_place、可验 presence proof、scene/entries/receipt、world CAS、awareness/必要 outbox 和父 task succeeded 同事务。任何校验失败整体回滚。

默认仅 time_place，不把作者 description 中可能含的人物状态概览当现场事实。拟事件 data 为 `{sceneId, environment:{schemaVersion:1, producer:'deterministic', enteredEventId, entries, presenceProofs}}`；不带 NPC attempt、台词、预约到场完成或事项进展。

旧 worldHistory 对无 worldResults 的 scene.opened 仅推进 version/time；完整场景投影重建需要明确新 helper/接线，不能称旧 replay 已会恢复场景条目。拟在本新模块提供明确投影重建接口，root 冻结后统一挂载；不得覆盖场景更晚状态。

## root 冻结与已完成实现

root 已明确批准上述接口、time_place 首版、私有受信系统授权，要求不设 NPC marker，租约最后失效全部回滚。登记后才写实现。现导出：

- `sceneEnvironmentTaskHandler(db)`：精确 epoch2 scene/actionId=null；epoch1 返回 false；其他合法任务留给其他执行器，混合输入拒绝。
- `sceneEnvironmentCommandId(taskId, worldId, sceneId)`：稳定 UUIDv8 子命令；event、entry 也为稳定合法 UUID，避免 44-9 的真实编号拒绝问题。
- `replaySceneEnvironment(world, beforeScene, rawEvent, committedSources)`：严格校验存储事件并重建同一个 scene/entry；不执行 SQL/任务/模型，不接受更晚场景状态重盖，不接受本轮 presence 循环证明到场。

实际写入核原 task command UUID 与 text 存储类型、request_hash、原成功 entry 事件身份/type/version/storyAt/地点或预约绑定、原 scene_receipt 的实际 task.id 与 scope、当前 active 场景和玩家 at 证明。仅读取实际入场和位置证明对应的成功来源，避免每次开场扫描不断增长的全部世界历史。

同一个应用角色事务写成功 child command/event、scene_sessions/scene_items/scene_receipts、世界 CAS 与 compact state、已有 awareness 和 reducer 返回的必要 outbox、真实 parent task succeeded。无媒体/通知需求时 outbox 为零，不捏造任务或演员。root 的 f7 hook 保持原权威位置来源与原时刻，开场只触发 new_condition/cursor，不重盖位置为“刚到”。

本首版只有来源真实的 time_place，没有自动环境润色、对白或移动能力，不将作者 description 中“可能会来”作为现场事实，不自动记预约 attended 或完成剧情事项。

## 验证结果

- `node --experimental-strip-types --test tests/integration/agent-scene-environment.test.ts`：**13/13 通过、0 skip**，含父测试和 12 个真实 PostgreSQL 场景。
- 与已有 `npc-native-service.test.ts`、`world-awareness.test.ts` 聚焦联合运行 **27/27 通过、0 skip**：18 个数据库测试节点（含两个父测试）及 9 个纯领域测试。最后将来源查询收窄至实际证明后，本专项 13/13 再次通过。
- `npm run typecheck` 通过；边界检查 541 文件通过；新增源与测试的格式检查、差异检查通过。
- 真实 PG 使用 PostgreSQL 18.4，自有 55565，迁移由项目 migrate 执行至包含 0075。生产迁移没有触碰，0072/73/74/75 文件未修改。

真实数据库证明包括：

1. 实际 enterPlace → 持久 claim/lease → pl_app 环境 handler → 保存开场 → 实际 SceneRepository 读取 → 可继续保存下一条玩家输入。实际 runOne 不在事务外再补成功状态。
2. 空 NPC 正常开场，联系人与 description 承诺不生成 presence；独立更早同地 NPC 可入场，原位置来源/时刻保持，另一联系人仍无位置。
3. 新开场事件的纯投影重放与数据库 scene/entries 一致；普通 world replay 的时间一致；篡改地点、本轮循环位置证明、更晚版本覆写均拒绝。
4. 伪造 token/input/world/owner、raw worker、过期租约、混合渠道、原 entry receipt 或事件身份不符、缺玩家实际位置拒绝，未产生部分命令或场景。
5. 暂停、导航造成后续世界版本、玩家实际离开均不能写过时开场；epoch1 工作保留原执行器。
6. 在实际最终 scene_receipts 插入阶段通过本地临时触发器注入租约过期和 epoch 改变，验证 event/world/scene/command/task/observer cursor 整体回滚；移除故障后同一未付费任务可正常恢复。触发器与函数均在 finally 删除，不是内存 Repository 或假事务测试。
7. in_transit/unknown 采用明确标记的数据库空间投影夹具，证明旧同地场景不会把人物拉回；**不把这项夹具称为通用 travel 能力已经运行**。历史 NPC 在场夹具来自真实旧 scene writer 的合成历史提案，未调用旧 Planner/模型，新模块不走该旧路径。

## 未完成项与下一位接续

root 需在实际 world task dispatcher/HTTP runner 的 epoch2 NPC 分支之前挂本 handler，并接通需要重建场景投影的实际回放调用者。现有 generic world replay 不返回场景投影，纯 helper 可重建不等于所有读者已挂载。对 epoch2 场景命中后的失败不得退回旧 Planner。

严格任务版本按冻结方案拒绝后续版本；现有 scene.navigate(view) 也会写 scene.view_changed。因此，进入后抢先切回手机可能令这项未付费开场发生 VERSION_CONFLICT。root 启用 epoch2 前须明确无付费重新准备/新任务恢复入口，或批准仅跨越已核实导航事件的有限规则，避免 active 未就绪场景长期卡住。本模块不擅自放宽到任意后续状态，已回传 root。

通用玩家动作执行、actor travel/arrival、预约撤回、NPC 初始权威位置、导演歧义协调与可选环境模型保护存储均不在本次实现，不将 runOne 成功误称玩家行动完成。已有实际在场人物后续对白仍由 runNpcAgent；缺位置时不能为演员补猜起点。

本轮 0 真实模型/浏览器/生产/完整 check/build；界面和公网未验收。root 统一运行完整检查、构建、双端关键流程、生产迁移核对及 READY 后公网验收，之后才可完成。未修改或发布“渣男体验”原草稿。

资源收尾：自有 PostgreSQL 正常停止，55565 已核无监听，未停止其他 Agent 服务。
