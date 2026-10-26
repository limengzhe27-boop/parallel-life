# SCENE-ORIGIN-02：NPC 未定初始空间状态

负责人：npc-initial-origin-20261026。独立工作树 `.local/worktrees/npc-initial-origin`，分支 `codex/npc-initial-origin`，基线 `1e989d83`。仅本地受控模型/独立 PostgreSQL 55673，不访问原存档、生产数据或真实模型；交 root 唯一集成人。

## 真实断点

旧发布稿没有 initialPlaceKey 时，人物有 v0 unknown 位置。现有快照只有真实 at 起点才提供 travel.begin 路线；kernel 也要求实际起点来源。于是正常邀约可以保存，但人物无法合法出发。不能从姓名、台词“到了”、玩家位置或新版发布稿猜出旧人物位置。

## 实现

沿用现有能力、单次 NPC 决策、执行内核与事件投影，新增 `position.establish` 即时行动；参数仅 placeId，不要求模型新建目标/计划，不增加业务列、SQL、后台入口或模型轮询。

快照只向符合条件的本人提供 `initialPlacement`：`fictional-unset-state-v1` 政策来源及当前世界已有、边界允许的地点 id/name。NPC 可以独立选择其中地点，也可以不行动。政策描述的是“虚构初始状态尚未设定”，不是作者声称的历史位置，更不是别人观察到的位置。既有已知位置、缺失位置行、已经执行过旅程均不提供该能力。

原 kernel 在世界锁内重读本人的位置行并锁定、查旅程历史，要求该行仍为 v0 unknown、无来源事件、无地点；与当前世界及快照允许地点取交集，认证服务端绑定的本人政策来源。当前版本追加原运行事件、action result 和 initialPositions 执行元数据。原 awareness 投影保存新的本人 at 状态，发生时间是本次执行时刻；不覆写 v0，不产生 arrival、赴约完成、旅程、现场会话或他人 position knowledge。下次快照不再提供该能力，现有 travel.begin 可接续。

新协议新增立即行动分支，代码绑定行动身份和政策来源；不是模型填写 actorId/来源字符串。泛化原 standalone-media 判定为 standalone-agent-action，位置确立和原即时媒体均不需虚假长期计划。

## 修改范围

- NEW domain/agent-initial-position.ts：资格与认证纯规则。
- agent-capabilities、agent-runtime、agent-eligibility、agent-kernel、agent-state-event：能力及即时行动复用。
- world-awareness：已认证执行结果投影，保持事实和认知隔离。
- agent-snapshot-repository：只读资格与现有地点裁剪。
- npc-execution-intent、npc-model-protocol、npc-agent-model：同次模型调用中的即时行动语法、上下文与人格自主权。
- npc-agent-kernel：原事务执行及晚到结果重验。
- NEW tests/integration/agent-initial-position.test.ts。

0118 无需新增迁移，预约释放。没有改 scene-repository、调度/等待、图片生成/存储、HTTP 或运行端口。

## 必要验证

独立 PostgreSQL 55673：真实 source snapshot → 当前 npc-wire-v15 解码 → 原 runNpcAgent/kernel → 原 awareness 投影。

- v0 unknown 初始资格、旧保存边界支持能力更新；没有起点时不提供 travel.begin。
- 非法地点行动实际 failed，权威位置仍 unknown。
- 正常即时行动没有 goals/plans，当前版本保存实际位置与成功结果。
- 没有制造消息、约定、旅程、现场会话、其他人物知情。
- 原请求重复执行不再次调用模型、不重复结果。
- 并发旧快照/claim 被拒绝，不能覆盖已确立位置。
- 下一次快照移除 position.establish，提供现有合法起点对应的路线。
- 纯规则覆盖已有位置、历史行程、跨人物、无政策来源、非法地点。

结果：新 PG 旅程 1/1 通过（含非法地点 failed、并发旧 claim 拒绝、重复原请求及规则负向）；当前协议与新 PG 合计 38/38 通过；原 agent-travel-kernel PG 回归 8/8 通过；typecheck 0 错误；boundaries 730 files 通过；git diff --check 通过。未跑全量 build/check（按 root 范围），未真实模型/原档验收、未部署。

## 明确保留的边界

本批补的是“旧稿位置未设定→允许 NPC 独立确立本人起点”能力，不保证 NPC 必然选择执行，也不强制唤醒或增加模型调用。若原存档没有 v0 unknown 权威行，仍保持未知，不能在读快照时补写；需另查合法创世投影。现有赴约调度、早到等待、现场形象与真实原档连贯体验归其他任务及 root；受控 PG 通过不冒充原档/真实模型体验通过。本批不部署，不运行 full check/build，交集成人统一完成本地集成构建。
