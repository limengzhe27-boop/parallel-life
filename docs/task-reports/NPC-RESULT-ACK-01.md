# NPC-RESULT-ACK-01

唯一负责人 codex-npc-result-ack-01a11a84-20261012；工作树 `.local/worktrees/nar-03`；分支 `codex/npc-result-ack-01`，基线 b930ef3。主集成人 I。状态：待验收，源码冻结，尚未上线。

## 复现与修复

原 ackReply 在 message.received.actorId 被归一化为当前人物之前，以真实ID严格相等判断。新专项首次运行 6 项、5通过/1失败：同一保存且当前人物可见的R17结果，回复为当前真实ID时 ack1，精确姓名“老周”时 ack0。因此可确认姓名漏承接；仅本地模型stub复现，未做真实模型概率评估。

不能简单把判断后移：原归一化会把任意另一个actorId改为当前target，而旧测试明确要求 another-actor 不ack。保留该拒绝边界，只增加可识别的当前人物姓名与 ACTOR_ID / actor_数字占位。精确姓名不得与possibleRecipients的其他人物同名；任何别名不得与其真实ID碰撞。缺失ID、其他姓名、任意陌生字符串或外来UUID仍不ack。已有targetId行为不变。

不改正文校验、角色关系校验、私有ack字段删除、事务与已保存可见来源校验。必须仍有合法当前回复、明确ack列表、匹配 canonical 的已保存 matter_result/pursuit_result 来源及当前人物授权。无ack列表的无关回复不自动消费结果；用户自述或候选结果不会在这里成为已完成事项。本补不新增语义识别器，正文是否实际承接仍按现有模型明确ack约定，不能承诺任意错误ID或模型虚假ack均被解决。

## 验证与限制

- 新7专项+既有matter-feedback-ack/turn-planner专项共13/13通过。覆盖真实ID/精确姓名/ACTOR_ID/actor_1、其他身份、局部ID撞他人ID、同名歧义、缺失ID、无明确ack/无对白、不可见/非canonical/伪来源/外来factID，以及空正文/结构化正文/私有标记正文拒绝。旧 another-actor 与 blocked 来源反例保留通过，未改旧测试。
- 初次新fixture缺persona导致类型错误已修复；最终 npm run typecheck 通过，边界检查331文件通过，diff检查通过。
- 遵I限定只专项/type/边界，不运行全量check/build，不启动数据库或浏览器。I统一集成check/build、必要真实PG、部署READY与公网验收后才标技术交付完成。
- 0付费模型、0图片、0数据库/生产写、0部署；旧18预算closed。本地stub通过不是实际模型整条结果承接体验验收。

文件范围仅turn-planner.ts、新npc-result-ack.test.ts、本报告和主登记本人行。源码冻结释放I。
