# 44-116 已创建事件中人物暂缓／等待后的重新评估与继续演绎

负责人 codex-agent-an-arch44-i，独立工作树 `codex/episode-defer116-i`，基于基线 `6514bd5ed1386fa528f15b1dc18dff4c366efb96`。
前置交付 44-113（`44b10ce6`）、44-114（`4cfba35d`）、44-115（`d216ce3d`）保持冻结交主 Agent 审核集成。

## 问题与设计

在已创建事件（`shared_episodes` 状态为 `proposed`）的推进中，导演编排提出事件机会，多位参与人物独立根据自身状态做出选择：
- 有人物选择参与，但在等待关键条件（`missingConditions`，如“等待玩家确认分工”）；
- 有人物明确拒绝（`choice: 'decline'`）；
- 若人物仅是等待，事件不能被错误标记为完成或被永久丢弃，也不能靠无条件循环轮询、普通闲聊或时间滴答来反复购买模型调用。

本次补齐核心接线：
1. **等待必须有依据**：
   人物选择 `defer` 时，将等待内容、前置缺失条件（`missingConditions`）和触发器（`nextCheck`，如 `player_decision`）持久化在人物私有 `responsibilities` 和 `plans` 中；
2. **收集器与上下文关联**：
   在 `src/modules/world/application/agent-schedule-collectors.ts` 的 `responsibilities` 收集器中接入 `episodeFollowUps`，根据责任关联的 `episodeId` 与所属事件引用，将触发上下文注入候选中；
3. **相关变化驱动单次重评**：
   当且仅当人物等待的真实条件成立（例如玩家明确做出决策 `player_decision` 并被人物记录为 accepted decision）时，对应的人物生成条件就绪候选（`npc_own_condition_ready`）并唤醒，允许该人物展开后续计划并进入事件；
4. **多人分别决定与独立退出**：
   一人等待（Actor 0）、一人拒绝（Actor 1）互不干扰。明确拒绝的人物（Actor 1）在后续条件唤醒和推进中**绝不会被重复唤醒或骚扰**；
5. **四阶段严格语义分离**：
   获得重评机会（条件成立） != 人物参与（私有 plan 激活） != 行动开始 != 事件结束。在人物独立演进阶段，共享事件在数据库中诚实保持 `proposed`，不被越权伪造为 `active` 或 `resolved`；
6. **稳定去重与无循环调用**：
   无关私聊、普通刷新或重复推进不会生成新依据，也不会重复购买模型调用。已提交的唤醒候选保持幂等与安静。

## 关键架构发现与协同建议

在本次真实 PostgreSQL 验证中发现了一处底层触发器边界：
- 数据库物理触发器 `guard_agent_episode_progress`（SQL81 / SQL85）强制规定 `shared_episodes` 的 UPDATE 仅允许向 `active` 流转（需附带 `engage` 且有消息呈现的回执）或向 `resolved` 流转（需经 outcomes 认证）。
- 领域契约 `SharedEpisode` 虽然声明了 `status: 'withdrawn'`，但目前数据库触发器中尚未包含 `status = 'withdrawn'` 的分支。
- 遵循“不抢写公共文件、涉及公共内核与 SQL 须与主 Agent 协调后再改”的约定，本任务未擅自修改数据库触发器；全员拒绝时，各 NPC 的 `choice: 'decline'` 回执已在事务中如实落库，全部 pending requests 被干净消费，且后续 advance 保持安静稳定不再重复骚扰。若需支持 `shared_episodes` 状态直接向 `withdrawn` 流转并解除占用，建议由主 Agent 统一规划迁移补齐 `guard_agent_episode_progress` 中的 `withdrawn` 分支。

## 验证证据

- **真实本地 PostgreSQL (端口 55432) 连续旅程集成测试**：
  `node --experimental-strip-types --test tests/integration/episode-defer-reconsideration.test.ts`
  全部 1 个聚焦长旅程端到端通过（耗时约 3.0s，pass 1, fail 0）：
  1. 导演提议由两个 NPC 参与的接待机会；
  2. Actor 0 暂缓（`defer`，等待玩家分工），Actor 1 明确拒绝（`decline`）；
  3. 数据库验证：事件保持 `proposed`，Actor 0 责任状态为 `waiting`，Actor 1 回执为 `decline`；
  4. 玩家无关私聊闲聊：系统保持稳定安静（`played: 0`），Actor 0 与 Actor 1 均未被触发；
  5. 玩家发送明确分工指示并被记录 accepted 决定：条件满足，Actor 0 被精准唤醒（`npc_own_condition_ready`），展开计划演进；已拒绝的 Actor 1 完全未被唤醒；
  6. 再次推进：Actor 0 演进已提交，系统保持安静，不重复购买调用；
  7. 面对新安排时全员拒绝：两人的 decline 回执均真实落库，pending requests 计数归零，后续不再重复骚扰。
- **模块边界检查**：
  `npm run check:boundaries` -> Module boundary checks passed (600 files)。
- **静态类型检查**：
  `npm run typecheck` -> 0 errors。
- **模型与生产保护**：
  本次测试使用受控本地 Synthetic 适配器验证应用接线与真实 PG 仓储约束，0 真实大模型调用，无费用消耗；不修改生产数据库或配置。

## 文件变更清单

- `src/modules/world/application/agent-schedule-collectors.ts`：责任收集器关联 `episodeFollowUps` 传入事件引用；
- `tests/integration/episode-defer-reconsideration.test.ts`：新增聚焦端到端集成测试，覆盖多人物暂缓/拒绝、条件满足唤醒、独立决策与去重稳定性；
- `docs/task-reports/44-116-EPISODE-DEFER-RECONSIDERATION-I.md`：本交付报告。
