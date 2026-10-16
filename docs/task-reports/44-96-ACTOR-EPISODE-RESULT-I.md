# 44-96 人物事件真实子结果承接

负责人 codex-root-ma-arch44-i，唯一公共集成人；基线6905d7fc，工作树history-chat-media/codex/ma-arch44-integration。小安44-97独立负责真实现场观察来源适配，本批不修改其NEW文件、不接未经核实的94-B对象凭证。

## 实际接线

原Director产生机会→原episode request→原NPC同轮manifest/独立consideration→原NPC kernel实际能力执行→SQL83不可变episode evidence（原邀请回应/移动/到达事务）→本次readActorEpisodeResults→原NPC private snapshot/model→原runner→原kernel。

本次补的是链路中的“人物再次读取自己事件相关的实际子结果”，不是新建Agent、第二套调度或模型裁判。结果读取在付费发送和提交时以数据库重建校验，冲突按已知冲突处理；已保护的旧付费快照无新字段时保留原协议，不自动重试unknown。

结果严格属于当前owner/world/actor/engine epoch，限定本人真实考虑过、已有授权回执的事件；从SQL83受约束不可变记录join原成功command和world event。邀请答复还核对准确appointment/operation/command；不会信任调用方构造的certifiedReceipt。遗忘先排除再取最近12条，按发生版本稳定排序，输出无另一人物私聊/拒绝原因/全局脚本。只给private模型，群聊/现场不下发私人事件结果；跨渠道细分可披露结果仍需后续专门授权，不以提示词代替裁剪。

invitation_accepted、invitation_declined、travel_started、arrived是独立子步骤，overallOutcome始终not_certified。拒绝一次邀约不关闭共享事件，接受不等于到场，到达不等于实际活动完成。模型引用这些信息仍不能编造completedGoalIds或终局收据；原内核完成资格检查保持。

## 验证

- 原episode-journey-evidence真实PG 3/3（含父测试）：实际NPC提出邀请→玩家实际拒绝→本人后续private snapshot读取真实拒绝→原runNpcAgent经过付费前校验及kernel提交；共享episode不完成、evidence无重复。另一路实际出发/到达进入本人上下文，另一NPC无结果。篡改拒绝为接受被结果重建拒绝。
- NpcAgentModel局部20/20：private真实子结果序列化，group/scene不携带。
- check3148通过；最终build通过。独立只读审查发现action-result别名遗忘漏过滤，已修正SQL先排除真实sourceId及别名后取预算，真实PG回归通过。原玩家manifest/unknown原结果恢复/既有计划复查PG8/8通过。最终部署状态按主登记追加。无新SQL，0真实模型，0生产存档写入。
- 生产只读2026-10-16T06:38:05.791Z：84/84校验和、保护原稿/副本/玩家存档未变、epoch2世界仍0。

## 未完成与接续

本批不是完整架构交付。整体事件发生/结果认证政策及原子终局回执尚未实施；不能将本子结果视图改称完成。新结果专属持久唤醒消费、同episode新cause/revision再授权、完整自由原稿逐人物语义、97观察适配的公共接线、旧存档接管/退役、真实模型连续旅程及生产新引擎启用仍待完成。现有已有计划nextCheck继续沿95同一调度复查，不凭本次读结果自动新增计划/硬期限/消息。

回滚：无schema变更，回滚本业务提交即可恢复原snapshot；已提交事件/原回执不删除。新字段为可选，旧保护结果恢复不重算付费输入，原epoch边界及幂等保持。
