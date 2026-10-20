# 44-172 人物事件选择与持续自主调度验收

## 基线、工作树与范围

- 任务：`44-172-EPISODE-AUTONOMY-ACCEPTANCE`
- Agent：`dsh-episode172-20261020`
- 最新 main（开工）：`33ce096c`
- 工作树：`.local/worktrees/episode-autonomy-172`
- 分支：`codex/episode-autonomy-172`
- 本批测试/报告提交：`275c0766`（无公共源码修改）
- 本批新增：
  - `tests/integration/episode-choice172.test.ts`
  - 本报告
- 复用：
  - `tests/integration/player-episode-manifest.test.ts`
  - `tests/integration/npc-agent-advance-service.test.ts`
  - `tests/integration/native-commit-version168.test.ts`
- 公共协议、模型、内核、调度、SQL、页面、生产部署未修改。

## 44-171 收尾

`301a3068` / `65fd9a3b` 与最新 main 仍有 3 个文件未集成：

- `tests/integration/append-receipt-route171.test.ts`
- `tests/integration/append-effect-dependencies171.test.ts`
- `docs/task-reports/44-171-APPEND-RECOVERY-ACCEPTANCE.md`

main 只有 44-171 报告镜像（未跟踪），没有这两个测试文件。没有公共源码 diff，不需要 cherry-pick 旧实现；主 Agent 只需把上述测试/报告接入并验收。

### 群聊/现场结论更新

阅读 `0103_native_actual_commit_version.sql`、`3985b554`、`1e1c6698` 后，此前“0074/群聊仍只能 expected+1”的结论需更新：

- `3985b554` 把实际 append 准入共享到 group/scene：`resolveAgentCommitVersion` 接受 group/scene，native projector 使用实际 `agent_commit_version`，不再要求 `world.version===attempt.expected_world_version` 或 `event.version===expected+1`；
- `0103` 的 group insert/finish guard 改为实际 event/command 版本关系，并继续验证 membership、receipt、actor state、source version、input hash；
- `1e1c6698` 只是把同一 group membership 认证从重复 join 变为 materialized 一次，**语义不变**，属于查询优化；
- `native-commit-version168.test.ts` 当前 **3/3 通过**，覆盖 group/scene 在无关 private chat 推进 append head 后仍按模型基线提交；
- 仍在缺口：群聊/现场没有“本频道后续独立交流插入后再继续追加”的完整旅程；现有 native 测试覆盖的是无关注入和基线保持，不等于全部群/现场调度闭环。不能再用旧 0074 expected+1 解释当前所有失败。

## 1. episodeManifest 明确选择

新增 `episode-choice172.test.ts`，直接走实际 `parseAgentProposal`：

- player `episodeManifest` 存在、`changes:null`：必须被拒绝；
- `engage`、`decline`、`defer`、`need_information`、`quiet` 五种 choice 均可解析并生成 `episodeDecision`；
- 普通无 manifest 聊天仍允许 `changes:null`；
- `quiet` 不被强制改成参与；
- defer/need_information 保留 waitingOn/missing。

运行结果：

- 在 **main 当前未提交 WIP**（agent-kernel/npc-agent-model/npc-model-protocol 的 episode 必选改动）上：**7/7 通过**；
- 在**已提交 main `33ce096c`** 上：**6/7**，只有“manifest 必须明确选择”失败（`changes:null` 仍被接受）。

分类：**已有但未集成**。WIP 已实现协议/解析守卫，尚未进入 main；不能把新测试当生产已交付。

### 现有真实 PG 覆盖

`player-episode-manifest.test.ts`：

- 已提交 main：9/9 通过（旧行为，允许 omitted decision）；
- main WIP：7/9，失败项为 `omitted event decision preserves pending...`，原因是新 WIP 已按需求拒绝 omitted decision，而旧测试仍断言 pending；
- 现有 PG 覆盖 engage/defer、消费、恢复、tamper、unknown、unrelated chatter；
- 尚未覆盖 decline/need_information/quiet 的**真实服务保存与消费**；新 guard 只覆盖协议解析。

需要主 Agent：

- 更新旧 `omitted event decision` 测试为 expected rejection；
- 用真实服务/PG 补 decline/need_information/quiet 的保存、消费和重复请求不重复购买；
- 确认 quiet 不消费机会、defer 等待依据、decline 不重复邀请、无关聊天不清旧责任。

## 2. 连续自主调度

复用 `npc-agent-advance-service.test.ts` 当前结果：

- 通过：
  - production batch 给两个独立人物一次请求内原 kernel turns，quiet 不阻止另一人物；
  - epoch2 无候选时 honest quiet，零模型/零假消息/零事件；
  - stable same-plan wake 不被无关 native 消息和 world version 变化重复购买；
  - 一个 unknown wake 只阻塞该人物，其他人物继续，不重试 unknown；
  - known failed semantic candidate 资源阻塞，但同一人物其他 matter 可运行。
- 失败/旧夹具：
  - main WIP 下 18 项中 8 pass、10 fail；
  - 失败包括旧 `UNKNOWN_SOURCE`/director-wire 夹具、`Director proposal is outside its authorized boundary`、travel/scene 旧输入、注入 SQL failure 断言等；
  - 这些是测试协议/夹具与当前 director v14/新 actor 协议不一致，不应全部归为“调度未实现”；但也不能算调度通过。
- 缺口：没有一条从“事件库机会→导演安排→多人物独立考虑→至少一人合法行动/消息→结果反馈→后续条件触发”的完整 no-player 旅程；现有测试覆盖局部组件。

需要主 Agent：

- 更新 stale director/UNKNOWN_SOURCE 夹具；
- 提供 no-player 连续旅程序列和可观察的 next wake/待办去向；
- 验证 quiet 人物不阻塞其他人物、结束/拒绝/暂缓后其他合格事项仍可调度；
- 心跳/刷新/双标签/无新依据不得重复购买导演或人物评估。

## 3. 导演观察与知情

当前 `DirectorSnapshot` 已有：

- world time/cursors、boundary、worldSetting；
- candidates、episodes、authoredEligibility/occupied；
- actorStates、actorKnownTopics；
- observations（fact/speech/belief/plan/result，含 knownByActorIds）；
- focus/conversation scope。

仍缺或不够稳定的独立投影：

- 人物实际位置/旅行状态的统一可读清单；
- 已完成/失败 action result 的稳定结果清单；
- 玩家明确答应/拒绝/暂缓的独立决定清单（目前散在 actorStates/observations/episodes）；
- 导演安排与人物最终承接下来之间的可追踪关联；
- 调度器下一次唤醒依据/待办去向的可观察输出。

边界：

- 导演拥有当前虚构世界/当前玩家存档的全局观察，不代表 NPC 共享这些信息；
- `knownByActorIds`/actorKnownTopics 是知情隔离输入，不能把导演观察直接广播给 NPC；
- 导演只选择候选/机会/协调，不能替 NPC 决定参与、发言、移动或完成行动；
- 当前代码没有第二套状态表或调度器，测试也不应另建。

## 4. 现有测试与文件

新增：

- `tests/integration/episode-choice172.test.ts`
- 本报告

只读复用：

- `tests/integration/player-episode-manifest.test.ts`
- `tests/integration/npc-agent-advance-service.test.ts`
- `tests/integration/native-commit-version168.test.ts`

未改：

- `src/modules/world/domain/agent-kernel.ts`、`npc-agent-model.ts`、`npc-model-protocol.ts`（main WIP）
- 调度、SQL、页面、生产配置

## 5. 分类汇总

### 已通过

- 44-172 协议 guard 在 main WIP 上 7/7；
- 已提交 main 旧行为 9/9（但不符合新需求，不能算新验收）；
- native group/scene actual append 3/3；
- advance 中 production batch、honest quiet、unknown 隔离、stable wake 等局部用例。

### 已有但失败/未集成

- episode 必选选择 WIP 尚未入 main；旧 `omitted event decision` 测试与新需求冲突；
- 真实 PG 未覆盖 decline/need_information/quiet 的保存/消费；
- advance 10 个 stale fixture/director 协议失败；
- group/scene 后续本频道插入再追加缺旅程。

### 尚未验收

- 无玩家输入完整连续旅程；
- 多种事项结束/拒绝/暂缓后的继续调度；
- 心跳/刷新/双标签/沉默无新依据不重复购买；
- 导演结果反馈和下一次唤醒依据；
- v14 回执兼容（保留，不阻塞 v15 主线）。

## 验证

- `npm run typecheck`：通过。
- 44-172 guard：main WIP 7/7；已提交 main 6/7（缺失必选选择）。
- `player-episode-manifest`：已提交 main 9/9；main WIP 7/9（旧断言冲突）。
- `native-commit-version168`：3/3。
- `npc-agent-advance-service`：main WIP 8/18，10 个 stale fixture/director 失败。
- 未跑全量；0 真模型、0 生产写、0 部署。

## 主 Agent 最小接线

1. 合并 episode 必选考虑 WIP，更新旧 omitted-decision 断言；
2. 补真实服务/PG 的 decline/need_information/quiet 保存与消费；
3. 修 advance/director stale fixtures，补 no-player 连续旅程；
4. 增加导演可观察的 next wake/待办去向与行动结果/玩家决定投影；
5. 继续 group/scene 本频道后续插入旅程；
6. 全量门禁、真实模型体验、部署。
