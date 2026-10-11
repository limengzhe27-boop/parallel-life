# NAR-03 · 现场行动与有来源世界结果

负责人 codex-nar03-i-01a11a84-20261011；唯一集成人主对话。状态：待验收，未交付/未部署。下方早期接续记录仅为历史，最终事实见末节。

## 接续实际状态（2026-10-11）

现存树 .local/worktrees/nar-03，codex/nar-03，基线3ae8c52；16已修改文件及1新真实PG测试完整保留。尚无本轮检查/数据库/付费调用；0付费模型/0生产世界/上传。先保存checkpoint，串行合并最新d2f8eb8与安全修复31410f3；不推main、不部署、不覆盖辅助文件。

## 已发现问题与冻结方向

- loadScene GET存在写入scene matter的WIP回填，改为显式场景创建/事件投影，不读写混合。
- 任意成功行动把所有relatedMatterIds（为空则全部场景事项）自动completed，且直接world_verified；应只校验明确达成条件、同世界同地点绑定、实际用户action、结构化观察、当前状态及来源，不以台词/用户自称完成充证据。
- 日历attended由任意成功触发，缺少事件来源/重放；到场只证明到场，不能完成其他目标。
- NPC后续需校验知情者与实际结果事件并只承接一次；不新增确定性假NPC回复。

## 当前范围与依赖

专属domain/scene-matter-policy、scene repository、agenda/return policies与actor context/turn-planner、四份官方事项来源，必要纯测试/真实PG测试。ports.ts已有WIP仅保存；若新增达成条件/模型提案字段需要公共契约，先通过本报告明确schema候选让主集成人冻结，不并写公共契约/config/迁移/UI。真实场景/WorldMatter/回执/队列已有基线依赖；尚未运行本轮资源。

## 接续点

保存WIP并合并最新安全基线→纯领域条件/来源规则→仓储原子事件重放与知情反馈→真实PG成功/多事项/失败/伪完成/跨地点/跨账号/重复/回滚→独占check/build→待验收提交与证据给主集成人，后者发布READY后才完成。

## 基线接续与公共依赖待冻结

全部旧WIP已安全保存90dc9cb；合入d2f8eb8为6e1d048，唯一ports冲突选择最新精简/授权matter上下文，未沿用旧全量泄露。又发现WIP actor-context在安全裁剪后重新覆盖完整matters，已移除该覆盖。

本批可不扩API：现有matterUpdates是模型建议，运行时增加可信达成条件规则与同地点/行动/观察/来源校验。需要集成人确认两项公共依赖：
1. 旧WIP新增官方事项仍沿contentVersion2，会改变已发行同版内容；建议官方新内容升v3（保留旧档，版本启动测试随新目录更新），或者本批先不发布官方事项，保留本轮合成world matters证据。当前尚未修改版本。
2. WorldHistory当前scene事件仅推进time/version；事项和attended投影不能只写SQL。拟新增scene.action_resolved.data.worldResults（validated transitions + attendance + observer facts）并让world-history调用纯reducer；仅新增内部历史负载，不改HTTP/schema/config/迁移。world-history.ts与scene-planner.ts必要增量请求归本NAR-03独占；若root在改同文件请先释放。反馈可复用已有有来源canonical actors fact，只有实际在场知情者获得结果，任何后续assistant消息只消费一次；不从relatedActorIds猜知情。

下一步先实现纯条件与负例，不擅自改公共contract字段。主表NAR-03行改了误导性的自动全完成验收，具体定义仍由主集成人决定。本轮数据库拟55471，启前核无监听并登记，不使用默认55432/既有生产或其他代理库。

## I read-side dependency freeze (2026-10-11)

Current internal event shape, exclusively NAR-owned, no public contract change:
`scene.opened` or `scene.action_resolved`, existing event.id/worldId/version/storyAt, `data.worldResults={scene:SceneSession, action?:SceneAction, updates:[{matterId,expectedMatterVersion,status}], attendance?:{appointmentId}, observerFacts:Fact[]}`. Scene.action includes actual saved input, relatedMatterIds, exact resolution `{sourceEventId:event.id,sourceVersion:event.version,outcome,observation}`. Scene presence intervals expose actual actor observers. Opening has no action. `attendance` only stores actual confirmed due invitation ID proven by scene.placeId==world.space.currentPlaceId, authored place binding, confirmed status and an actually present invited actor. Root read-side should validate event scene/presence/time against original appointment, not infer presence from participant IDs. Existing appointment.sourceEventId/sourceMessageId remain unchanged; responseAt=event.storyAt, responseVersion=event.version, status=attended. No scene is ended by attendance. Exact rule registry (preset/version3/matterKey), no title inference and no new WorldMatter field; four authored cards will be v3 with old saves unchanged. WorldMatter.evidence follows existing scene_action shape. Per-scene IDs derive `sceneMatterId(sceneId,worldMatterId)` so reopening never overwrites earlier matter projections. Root may use event data updates matterId vs action.relatedMatterIds scene-specific ID distinction. Initial 5 pure policy checks passed, real PG not yet run this new code. Current source is WIP, will freeze after real replay/rollback/RLS checks.

## 最终冻结与自审（2026-10-11）

- 安全基线 d2f8eb8，旧 WIP 保存在 90dc9cb，合入安全基线 6e1d048。交付提交只包含最终净增量；不让旧自动全完成版本单独成为交付。
- 四份官方内容升 v3，旧世界初始快照不回填、不重置。初始目标为 actor_statement，只有经过运行时证据校验的实际结果才能 world_verified。县城 v3 增加真实 R17 交接邀约（17:41，老周，repair_shop），保留既有家庭/修车铺邀约。未修改官方包的正常路径已验。
- 明确目标、实际保存行动、成功裁决与观察、可信 preset/version/matterKey 条件、原始定义、地点、到期确认邀约及必要见证一起校验。长期 pursuit 没有单行动完成规则；打招呼、空目标、部分成功、人物口头宣称不完成目标。
- scene.opened/action_resolved 的 worldResults 与事件、世界状态、回执、投影同事务保存；到场独立于目标完成。历史重放校验来源、跨场景/过期版本和事实伪造。JSONB 字段顺序改变采用语义内容比较，额外字段仍拒绝。
- 只由实际在场者获得 matter_result 来源事实；精简 actor context 保留授权筛选，事件/事实被屏蔽时不借目标状态泄露结果。NPC agenda/导演可承接已见证结果；未生成任何假 NPC 回复，已有后续 assistant 消息后不重复选该结果。
- loadScene/read/history 只读，无 GET 回填。每场景事项使用独立投影 ID，worldResults.update 使用真实世界目标 ID。WorldRepository 的 attendance 读取按当前回执精确版本重放，避免旧确认覆盖新到场；只在存在新 attendance 事件时执行，长历史成本由后续优化评估。
- 自审：npm run check 686/686（边界、类型通过）；npm run build exit 0；真实 PostgreSQL 专项及纯条件 12/12；git diff --check 通过。日志位于本树 .local/nar03-check-final.log、nar03-build.log、nar03-pg-final.log。首次完整检查的 dev 库缺迁移已补齐后重新运行；旧断言 world_verified 已改为与诚实初始目标一致。
- 真库覆盖未改包正常邀约/行动结果、只更新指定目标、重复任务/回执、失败回滚、空目标打招呼、部分成功/引用台词/pursuit 伪完成、跨场景/过期/额外事实历史拒绝、事件与事实屏蔽、无见证者与跨账号不可见。使用明确合成 planner，0 模型/0 生产世界/0 上传，不能据此宣称真实模型叙事质量已通过。
- 手机读投影公共文件归集成人；全库集成、PC/手机 UI、生产迁移检查、提交推送、READY 与公网验收由集成人完成。此轮没有迁移/UI/公共 API 契约变更；未上线不得标已完成。
- 本轮独占 PG 55471，无 HTTP/浏览器。源冻结后关闭资源；资源关闭与交付 SHA 在主表/接续消息记录。
