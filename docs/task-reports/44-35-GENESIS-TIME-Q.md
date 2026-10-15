# 44-35-GENESIS-TIME-Q：作者开场时间与运行时时间格式一致性

状态：待验收。负责人 `codex-ma-arch44-35-genesis-time-q-20261015`；root 唯一集成人和部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-35-genesis-time-q`，基线 `bda907d3`。开工前已按主表短锁登记；root 确认实际源码为 infrastructure 路径。

## 真实复现

自有 PostgreSQL 18.4 / 55565，真实 PublicationRepository 创建合成稿、检查 ready、本地合成发布，真实 PublicationWorldRepository 创建 trial/published 世界，随后调用真实 PostgresWorldRepository.saveNote。

修正前 `2026-10-12T09:00:00Z` 被 genesis 原样写入 world.time。saveNote 用该值构造 storyTime，notes reducer 的严格 isoInstant 校验拒绝，抛 INVALID_COMMAND。带 `.123Z` 的开场能保存，但历史消息仍为未规范的无毫秒字符串。

首次修 compiler 四处后，完整仓储创建链路揭示关联问题：publication-world-repository.validatePrepared 按作者原始字符串比对 world.time、messageHistory.startAt、messages.at，拒绝等价的规范时间，报 INVALID_STATE。root 已确认并按短锁追加登记，仅修改三处为 runtime 严格等于规范后的作者时间。

## 最小方案及边界

- 生成运行时 world.time、messageHistory.startAt、messages.at、appointments.at 时使用 Date.toISOString，保留相同时刻的 JS 毫秒值。
- 作者原始内容、历史来源 metadata、contentHash 保留不改，不写旧稿或旧存档，不放宽核心 isoInstant 校验。
- 入口当前 z.iso.datetime 不接受带 offset 的原稿；保持拒绝负例，不扩公共契约。
- JS 运行时精度为毫秒，超过三位小数仅按现有 JS 精度生成运行时，作者完整原字符串仍保留。此修复不声称运行时保留微秒精度，按 root 要求不新增创作拦截。
- 非法日期保持原有 schema 拒绝，不用 Date 自动滚动来接纳不存在日期。

## 当前验证与接续

已有单元测试更新为同刻 canonical 比较，并增加合法无毫秒、毫秒、高精度原稿保留以及非法日期/offset 拒绝负例：44/44 通过。typecheck 通过。

完整 PG 回归继续发现数据库同因阻断：当前 publication_commit_internal 仍把 runtime time 与作者 startAt 原始字符串比较。无毫秒Z试演在此报 INVALID_STATE（底层22023）。root 提供独立迁移78 `1311cfc4`，本树仅 cherry-pick 接收成 `7660b9d8` 后执行真实迁移，没有自行修改 SQL。

最终验证：

- 真实 PG 新专项 4/4 节点通过（父测试及三种作者时间）；现有及新增 genesis 单元 44/44，通过合计 **48/48，0 skip**。
- 无毫秒Z、`.123Z`、`.9999999Z` 均走真实 check ready、本地合成 publish、startTrial、startPublished、saveNote、重新读取持久便签；历史包含双方消息及 `.9999999Z` 玩家消息，邀约含 `.123456Z`。证明 SQL/JS 同按毫秒精度处理，未发生 PostgreSQL 小数舍入跨秒。
- draft 内容全文与 contentHash 前后严格相同；运行时保持 Date.parse 的同一毫秒，原稿更高精度字符串仍保留，不声称运行时有微秒精度。
- 每种时间下均使用独立新玩家调用实际 published 创建入口，恶意 compiler 分别把 world.time、messageHistory.startAt、历史消息时间改一秒，9次均拒绝 INVALID_STATE。使用新玩家避免同稿 trial 幂等返回已有世界而跳过 compiler，负例没有绕开实际准入。
- 非法日期、不存在日期和当前不支持的 offset 仍在单元入口拒绝。核心 isoInstant 未改。
- typecheck、边界检查（546 文件）、四个源码/测试的 Prettier、git diff 检查通过。

改动文件：`src/modules/settings/infrastructure/publication-genesis.ts` 四处；`src/modules/settings/infrastructure/publication-world-repository.ts` 三处；`tests/publication-genesis.test.ts`；新增 `tests/integration/publication-genesis-time.test.ts`；本报告。root 的迁移78仅为父提交依赖，不重复夹带在本人最终提交。

root 接续：合并本人独立提交并保留 root 迁移78；最终集成 check/build、确认生产迁移应用、推送并等待 READY，在公网验证新建试演与便签写入。已有旧存档不在本任务迁移范围，不能声称旧存档时间已自动修复。所有原稿、旧作品、草稿均未重写。

0 真实模型、0 生产操作、0 浏览器、0 fullsuite/build。测试中的 publication review 是明确标注的合成夹具，只用于本地数据库创建测试发布版本，不是正式验收或模型证据。未修改或发布原“渣男体验”草稿。最终 check/build、合并、部署 READY 与公网验收由 root 集成批次负责，本地结果不等于已上线。

资源收尾：自有 PostgreSQL 正常停止，55565 已核无监听，未停止其他 Agent 服务。
