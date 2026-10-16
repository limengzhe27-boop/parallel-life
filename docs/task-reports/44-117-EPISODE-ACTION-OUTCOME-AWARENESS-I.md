# 44-117 人物行动真实结果、事件收束与知情传播闭环

负责人：codex-ma44-117-outcome-awareness-i，独立工作树 `episode-outcome117-i`。
基于基线 `6514bd5e`。不修改 SQL 迁移、不修改公开契约、不调用付费模型、不修改生产数据。

## 一、解决的问题与核心原则

前序任务（113-116）实现了人物承诺落库、作者事件到达唤醒以及人物暂缓/责任等待的再演绎。本任务闭环解决行动产生结果后的事件收束与知情隔离：
1. **真实执行驱动结果**：口头对白（如“我去买”“已经处理好了”）不能充当执行结果；没有合法真实结果却申请完成目标被内核严格拦截（`GOAL_RESULT_REQUIRED`）；口头声称保留在对白本身，不冒充内核拦截了所有谎言。
2. **事件收束有依据**：只有满足事件作者明确声明的完成规则（如 `completion.scope = 'invitation_response'` 且收到明确确认）时，事件才收束为 `resolved`；中间子步骤（如发出邀约、到场）严格保持 `active`，绝不提前误结清。
3. **责任与目标分别维护**：事件完成不无条件清空所有人的未完成目标或私人责任，各自责任状态独立维护。
4. **知情传播有来源与隔离**：
   - 在场且具备观察条件的角色获得 `scene_record` 观察，保留真实 `learnedAt` 与 `eventOccurredAt`；
   - 不在场者严格保持未知（0 条观察）；
   - 口头或群聊告知仅生成 `player_report` 或 `actor_report`，接收者获知“对方如此告知”，不自动获得世界核实事实；
   - 导演的全局事件结果观察 `knownByActorIds` 为空，不直接下发给 NPC。
5. **克制唤醒与同源去重**：已知观察处理后，后续时间推进不重复唤醒同一角色；命令重放与推进严格幂等，不重复生成 `agent_episode_outcomes`。

## 二、实际调用链与验证范围

调用链：
1. `npcAgentServices.handle`：执行模型提案。模型无真实结果申请完成目标时，返回 `GOAL_RESULT_REQUIRED` 拒绝；普通对白提交不改变世界目标与事实。
2. 原入口执行行动：NPC 提出合法邀约行动 → 内核确认执行并创建 Appointment；此时事件保持 `active`，后续依赖节点保持 `blocked`。
3. 玩家通过原接口明确回复（`invitation.responded`）→ 内核原子写入 `agent_episode_outcomes`，满足完成规则后将事件收束为 `resolved`，自动解锁依赖后续节点（`dependent_followup_event` 变为 eligible）。
4. 数据库核实：通过原事务和仓储读取数据库，验证结果来源、目标状态、事件收束依据与命令重放幂等（重复提交返回唯一相同记录，不重复插入 outcomes）。
5. 现场观察隔离：通过 `readActorSceneObservationSourcesInTransaction` 读取现场观察，在场者（Actor A）获得 `evidenceKind: 'scene_record'` 与 `learnedAt`，不在场者（Actor B）获取 0 条观察；导演快照中的 `episode-outcome:...` 观察 `knownByActorIds` 为空，不广播泄露给 NPC。
6. 告知与事实隔离：群聊消息通过 `PostgresGroupRepository.send` 投递，接收者通过 `readActorGroupObservationSourcesInTransaction` 读取获得 `evidenceKind: 'player_report'`，保留 `learnedAt` 与 `eventOccurredAt`，不升格为世界核实事实；未在群内的角色获得 0 条观察。
7. 克制推进：时钟推进处理观察后，后续推进 `played = 0`，不重复循环调用模型。

## 三、必要验证结果

测试文件：`tests/integration/episode-action-outcome-awareness.test.ts`
运行命令：`node --experimental-strip-types --test tests/integration/episode-action-outcome-awareness.test.ts`
结果：
- 1/1 测试用例全部通过（耗时约 1.7s）。
- `check:boundaries` 通过（600 文件模块边界检查通过）。
- `tsc --noEmit` 静态类型检查零错误。
- 0 付费大模型调用，0 生产数据库访问。

## 四、剩余事项与接续

1. 当前仅覆盖邀约响应类（`invitation_response`）的事件完成收束与现场/群聊观察隔离；对于通用物理动作（如物品交付、制作等）的判定规则，仍依赖未来对应的实体交互系统。
2. 口头对白中若 NPC 宣称完成，当前内核保证了其目标状态不被篡改，但模型对白中可能仍包含“已经完成了”等措辞，需在后续提示词工程中进一步引导。
3. 本交付保持冻结，等待主 Agent 统一审核、集成与部署。
