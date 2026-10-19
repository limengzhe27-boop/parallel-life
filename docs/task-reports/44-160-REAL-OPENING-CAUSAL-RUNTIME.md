# 44-160 实际存档的开场断点与恢复

## 实际调用图与断点

正式b52f5928。用户新发布存档5fe9e203-f4ae-444e-bafd-710ecc245628（非测试档）只读证据：首个bootstrap Director0042ef19在v0送出，模型返回前玩家两次私聊分别提交v1/v2，原安排因此stale_discarded。原snapshot/原wire-v8解析有一个作者开场未来机会、6个独立人物任务；audit自由文本不能当作quiet判断。第二个Director681bd7b6在v2送出后unknown_after_send、无保护raw；0 director_decisions、0 episode_requests。因此后来的actor committed和own-agenda quiet不证明作者开场交接成功。只读核对至v48，6参与人及作者来源/资格仍合法，没有重写玩家状态。

现有链路：手机进入/在线检查→原advance batch→原schedule/Director→director_decisions/shared_episodes→agent_episode_requests→原NPC runner/kernel→事件/人物状态/消息/Outbox→原手机投影。补齐的节点是已收到未来安排的重新核验应用；不另建剧情引擎。

## 实施与状态归属

原paid snapshot/input/raw/hash/assessedVersion不变。新增immutable director_handoff_revalidations记录appliedVersion、当前readset hash、原response hash、机会ID与被隔离的过期未知attempt ID。纯domain完整验证原作者未来安排：无旧candidate执行/nudge/nativeTurn/私人actorTopics，来源/原稿/人物/边界不变，当前仍有资格且未占用。已有合法世界地点可用于未来会话，不产生移动或地点事实。

原repository在当前CAS下原子保存原canonical decision、proposed episode、原六人物考虑请求及应用凭据；原attempt只在SQL凭据门禁下转committed。世界新观察不因旧安排应用而被标已评估。人物仍自行engage/quiet/defer/decline，原内核执行，不插入预制运行消息、不强制事件完成。原始已知安排已经不再需要新Director模型。过期且旧帧未知请求仅在成功应用已知安排同事务隔离为stale，保留sent_at/无raw及凭据；不宣称未计费、不重发未知。未知且没有可验证已知安排仍受保护，不伪造恢复。

调度接到原advance、read-only phone continuation probe；参与请求按原batch分次继续，单人物quiet不消费其他请求。生产迁移0096仅新增凭据表/权限/guard，不改变原稿、历史、位置、玩家选择或进度。回滚应用代码仍可读取原committed决定/请求；保留0096，不回退原始付费状态，不重放已提交动作。

作者预置历史/opening来源由原publication-genesis身份只读标识，保留聊天原文与initialRead，不计锁屏通知/联系人未读/主动消息计时。真实运行新增及用户已读语义保留，见通知子报告。

## 必要验证

check3648/build通过；纯策略补丁32项通过。原真实PG Director恢复18、原交接旅程2通过；后者覆盖真实玩家回合并发造成stale、无凭据直接revive被SQL拒绝、过期未知不重发、原raw/input不变、应用版本独立、两NPC原dispatcher各自参与、事件active非completed。通知独立PG29和纯20通过。生产95→96及FORCE RLS核验，未写世界数据。

真实模型、原手机UI、公网READY与本轮闭账仍进行；未通过前不宣称主动开场和长线自然表现已完整验收。无新复制/发布作品。最终证据及未完成项在唯一主DEVELOPMENT登记。


## 首轮真实验收新增断点与后续修复

候选2eaf05e7上独立正常发布实例523ef612（非用户档）首轮17文字调用，无unknown、1 known invalid，已暂停。Director成功交开场给青青，但NPC执行合法semantic basis缺当前输入机械归因，旧v9按原规则拒绝NPC_EXECUTION_INTENT_SOURCE；其余初始化/复盘quiet，不能宣称开场通过。新v10仅传输层为合法basis追加accepted_input，v1—v9原raw解释不改，见EXECUTION-PROVENANCE报告。

更根本的上下文缺口：NPC reader只认genesis:，发布作品使用publication-genesis:；没有对应world_events，导致本人作者历史全部未进入NPC。新增认证helper以原binding/origin函数、immutable initial snapshot、source.initialFacts交叉验证，恢复本人合法历史speech/初始事实及最终策略source认证，不靠前缀授权。生产只读确认六人物各能认证本人历史、跨人物消息0；原真实PG增加本人历史进入/跨人物隔离/伪造同ID内容拒绝/最终策略引用验证，通过。历史进入认知不等于新通知。完整事件意图还需导演编排，不通过固定台词重播历史制造主动。

本轮总有界账本调整为48文字、2测试档、最多2自然媒体请求，依据用户standing全部真实验收授权；不沿用已关闭额度，不重试旧invalid/unknown。同一已发布作品验收，不再复制/重新发布。第二独立正常入口与后续实时验收仍进行。
