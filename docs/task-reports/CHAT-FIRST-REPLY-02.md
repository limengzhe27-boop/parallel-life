# CHAT-FIRST-REPLY-02 · 私聊热路径往返精简

负责人 chat-hotpath-20261026（/root/chat_hotpath），独立tree chat-hotpath-20261026，基线main606927b4。parent授权范围：npc-agent-services、npc-stream-segment-repository、chat-context-read-repository及专属测试/报告，后追加原chat-context-bounded-read测试计数断言。0商业模型、0原档写、0端口3218/3219操作；root统一main集成。

## 第一批：有界上下文投影合并

既有readChatContextWorld已持world FOR SHARE并确定actor/世界版本；消息、事实、日程查询彼此无依赖，合成一次SELECT的三个有界JSON数组。保留owner、event版本、人物知情、最新窗口+1、精确旧引用、关联证据、排序、回退和邀请响应后置回放。不在同PoolClient并行，不新增业务字段/缓存，不裁人物记忆。

独立真实PG18.4端口55652：原chat-context-bounded-read完整用例修改前后均通过。短档和长档业务SQL从5→3（底座BEGIN/owner/COMMIT不计此计数）。原长档返回336行、76098字节、203消息、83事实、50日程；改后相同；短档4行2196字节相同。多轮身份/可见范围/旧引用/活动责任/邀请回放/回退断言全通过。在原测试加入每次最多3条业务查询的性能回归上限。

本地PG长档94.21→97.73ms、短档8.12→8.06ms是单次测量，不能宣称CPU更快或用户首句已达标；本批收益是少2次远程往返。当前其余stream提交读合并仍在审计，优先保留所有判定早退/锁顺序/活动freshness，不能证明就不提前读取。

## 第二批：流式提交元数据少一次往返

仅合并epoch与receipt/newer-input为一次读取，prior segments仍在原authority/activity之后读取。world→attempt→actor行锁获取顺序不变，epoch→attempt stale→revision→missing input→interrupt判定顺序和理由保留，最终活动和版本校验原样。

审计：src里input receipt INSERT仅acceptAgentInputInTransaction；该函数先world FOR UPDATE。epoch UPDATE仅switchAgentEngineEpochInTransaction，先world FOR UPDATE；SQL initialize_built_agent_world（0091替代0090）也先world FOR UPDATE。没有在已锁world之前用同statement快照读这些值。真实PG新增chat-hotpath-guards测试证明：epoch/token/revision/missing input/新玩家输入分别原理由早退，0事件；paused保持NPC_DELIVERY_DEFERRED；同时启动真实accept和epoch switch，在pg_stat_activity看到两者都等world锁，释放后继续接受/按原pending规则拒绝epoch switch。成功commit、交错多段、输入只保存一次、媒体一次、打断/重放/partial恢复由原chat-latency-stage2完整测试通过。合成测试存档留在独立库且全部暂停，0商业模型。

原stage2 PG SQL总数3259，合入两批后3222（少37），上下文每次少2SQL、11个文本分段各再少1SQL。不能以总量直接承诺首句低于5秒。

初轮check时独立dev库未迁移，旧character-image-flow/media-pipeline-handler单测在清理missing schema后未关闭连接；仅终止本人两个测试子进程，迁移本人dev55652后重跑check，不修改无关测试。guard最初fixture只改revision列违反document一致约束，修正合成fixture；清理account会触发epoch删除围栏，改为保留隔离合成证据并暂停，未放宽任何生产规则。
