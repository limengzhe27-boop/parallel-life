# 44-42-AUTHORED-DIRECTOR-P｜真实导演作者目录接线与来源校验

状态：限定实现与联合验证冻结，待 root 集成验收；未上线。2026-10-15。

## 范围与接口确认

执行者 codex-ma44-authored-director-p；线程 01a11a84-9572-7ab0-92fb-967f963dfc20。独立工作树 publication-story-02/人生剧本，codex/authored-director44，基线 root **d3fa007c**（含已集成 attention）。root 先确认以下接口/错误名/默认64KB方向，再继续实际接线，仍唯一集成人与公共契约负责人。

精确九文件：

- domain/director-runtime.ts：只加 authoredMaterials 可选字段及其 type import；
- domain/authored-agent-material.ts：纯显式白名单模型视图与 global handle；
- infrastructure/director-snapshot-repository.ts、director-runtime-repository.ts、director-agent-model.ts；
- 新 tests/authored-director.test.ts、新 tests/integration/authored-director.test.ts、受影响的 tests/director-agent-model.test.ts；
- 本报告、主目录同报告镜像及本人主表行。

未改 ActorState、NPC model、kernel、application runner、Server advance、UI、SQL75/77–81、其他执行者报告/源文件。没有添加 stub 或独立旁路：实际 snapshot read、模型 adapter、持久化 claim/mark/commit 均已接现有44-32 reader。

## 已实现的实际链路

`DirectorSnapshot.authoredMaterials?: AuthoredAgentMaterialCatalog`。真实 `PostgresDirectorSnapshotRepository.read` 在原 RR/READ ONLY 的同一 SqlClient 调用 `readAuthoredAgentMaterialCatalog`，按真实 owner/world/epoch/version 读取并绑定完整 director_only 目录。有 source 才带该字段；无 source 继续旧形状，不生成假作者节点或人物候选。读目录不初始化旧 story ledger，也不改 NPC/世界。

reader 沿原 **64000 UTF8字节**默认完整目录预算；index_only 明确抛 `DIRECTOR_AUTHORED_MATERIAL_BUDGET`，不会把索引/节选放进 authoredMaterials，不能转成 quiet 成功。模型整体上下文仍沿既有64000长度门槛，超限 `DIRECTOR_CONTEXT_LIMIT`；应用原有 validateInput 在 claim/request_sent 前执行，不先购买再检查。

纯 `projectAuthoredDirectorModelView(catalog)` 沿现 nodeShape/project 逐层列出支持字段，只复制 world/source/ref、opening key、原 title/editorialIntent/script/sceneText、原前提/条件/进度/时间线及 actor/place 映射与诊断；所有文本原样保留，不 trim/截断。root、origin/ref、node.intent、progress、condition、stage、参与者和地点额外 private 属性均不透传。返回 detached 视图，拒错误 scope、缺失全文 materials、重复 nodeKey、ref/source 不一致等。它是安全模型投影，不替代已绑定目录的实际 SQL 来源重读。

模型版本 `director-runtime-v2-authored`。模型 payload 显式调用上述视图，给每个节点加 `sourceId=authored:<nodeHash>`；提示词明确作者原稿是待演绎意图、前提待核对，参考台词/预期结局不是已发生事实、NPC决定、玩家同意或达成成果；participantRefs不授予知情权。

parse 与 SQL repository.validateDecision 均执行：

- global audit/opportunity 的 authored handle 必须来自真实目录；不能从普通 observation/candidate/episode 中伪造 authored 命名空间。
- `opportunity.authoredEventKey` 必须引用真实唯一 material.ref.nodeKey，且**该 opportunity 自己的** basisSourceIds 包含该节点的 authored handle；其他节点的 basis、只有 audit 引用或猜测 handle 均无效。
- 不再要求 fake actor authored_event candidate 才能指向全局作者事件。零人物候选时，可以提出有来源的导演机会；普通候选的 selected/deferred 分区规则不变。
- 机会仅已有世界 cast/place 与现有 activity，仍最多两个，不能新增人物/地点或执行字段。
- typed nudge 仍仅该已选候选的 actor/source 子集；任何 `authored:` handle 一律拒绝，即使 trusted caller 把它伪放进 candidate.sourceIds。作者全文/全局机会文本不下发 NPC。

## 最终事务校验与持久证据

repository `current` 在已有 SQL UoW 重读实际目录，完整深比 catalogue（包含 world frame、source hash、原稿、映射/诊断），不只信 caller hash。有 bound source 但新 claim 刻意省略 authoredMaterials，同样拒绝。claim、request_sent 前 mark、最终 commit 均经过该检查。源/目录变化抛 `DIRECTOR_AUTHORED_SOURCE_CONFLICT`；后续已有 attempt 遇索引超限也归此已知冲突，新 claim 预算失败仍给明确 BUDGET。raw/response_hash 保留在原 attempt，不创建新付费请求。

完整目录自然参与已有 input hash、coordination frame hash 和已知 raw 深比较；不增加第二套 frame hash。SharedEpisode 仍 `status=proposed`、`origin.kind=director/sourceId=decision.id`，空 sourceEventIds/resultIds。作者引用可经 immutable decision.opportunity.authoredEventKey+basis → attempt.snapshot.authoredMaterials.ref/source 追溯，不把作者稿冒充实际结果，不改75/新SQL。

## 验证证据

- 新纯 **9/9**，联合 material/model/runner/recovery 纯测试 **99/99，0skip**。包括原文空格/换行、可选条件/进度/完整时间线、逐层私密字段排除、frame/scope/index/重复节点、零fake候选的全局事件、wrong node/own basis/cast/place、即使伪candidate来源也不能给NPC作者handle、伪normal observation author句柄拒绝，以及超预算在0模型发送前失败。
- 新真实 PG **11/11（10子项+父），0skip**：真实 trial 与 published immutable source → actual RR DirectorSnapshot → WorldDirectorAgentModel 显式 mock → parse → SQL75真实 claim/mark/saveResponse/commit → private proposed episode。比较实际 actor state 前后相等；world version、event、message、fact、NPC attempt、input receipt和旧 story ledger 均无新增。已提交决策重放不再次调用mock。
- 真实新 bound claim 的 omission/truncation/sourceHash/原稿篡改拒绝且0attempt；绕过parser直调store的 wrong author key/另一node basis/假handle/outside cast/place全部拒且无半写，合法原结果仍可一次提交。直接store的伪candidate author nudge拒绝。
- 合法作者内容在默认完整目录预算溢出时，实际reader为index_only，actualSnapshot明确BUDGET，0director attempts；不以缩短稿或quiet冒充成功。
- 编辑当前草稿后原存档绑定目录/旧frame不变，原raw仍可提交。晚到映射变化测试使用**明确的本地 admin 故障夹具**，在正确 epoch/world GUC 下改变world可用地点而不加版本；未关闭任何trigger。实际源reader重算的catalog.placeRefs变化使commit报已知 SOURCE_CONFLICT，原付费raw/hash与原attempt仍在、0decision/episode，恢复fixture后显式mark stale仍可读raw。该测试不声称不可变出版修订被正常编辑改写，也不冒充 application 已自动分类新错误。
- 新测试+authored material+director runtime/snapshot/recovery 联合真实PG **71/71，0skip**；已有 RR隔离、owner/worker、观察游标、attention晚到冲突、锁/租约/raw恢复、clock/time边界均保持通过。
- typecheck通过；模块边界 **551文件**通过；八个TS Prettier及 git diff --check通过。

忽略证据 `.local/ma44-authored-director-{pure,joint-pure,pg,joint-pg,type,boundary}.log`。首轮联合旧snapshot测试被其默认55503端口门槛拒绝，显式 DIRECTOR_SNAPSHOT_TEST_PORT=55566 后71项全过；没有改端口保护。晚到映射夹具首轮被既有epoch fence正确拒绝，后在测试事务设置正确已有GUC，不放宽产品guard。测试cleanup改为实际unpublish API，并清理首轮留下的1个本地合成listed作品；不是生产作品。

PG55566全部完成后已干净停止；本批所有合成存档 after 暂停，测试发布作品实际下架。本轮 **0真实模型、0生产变更、0浏览器、0完整check/build**；没有消费用户真实调用额度。只做限定回归，不将mock人格或叙事质量称作真实验收通过。

## Root 接续与明确限制

root 已明确保留本次完整目录/来源CAS范围，**不在本批新增作者时间资格或 temporalFrame 实现**。现 temporalFrame 仍只识别原 actor/blocker时间条件，未把作者 not_before/窗口/earliestAt转成触发资格。目录保留这些前提不代表已经满足，更不代表作品节点已发生。后续 root 统一同一候选资格、时段协议、opening/autonomous实际 handoff、per-actor授权材料、NPC演绎及共享结果证据；参与者引用本身不能授权披露全文。

root 冻结后须在其独占 `application/run-director-agent.ts.isKnownConflict` 加 **DIRECTOR_AUTHORED_SOURCE_CONFLICT**，使真实runner自动将晚到已知冲突标 stale_discarded并保raw；本人未越界改 application。现源码 tests 对store的错误码/raw保留与显式mark已验证，不能称根接线已完成。44-43 questions由root负责，B41 resolver继续独占，本批不夹入其字段/serializer改动。

本批不单独部署。root集成审查后执行全check/build/全数据库及真实入口必要门槛、迁移/部署READY/公网验证；当前报告状态只待验收。作者目录接入本身不等于“作者事件已由NPC真实演绎完成”，用户世界保持未发布。
