# 44-111 未演作者事件按新依据重新考虑

负责人 codex-root-ma-arch44-i，唯一集成目录 history-chat-media，从3bc59d51继续。109诊断f7eab87d→9761f709；110身份协议2d99f22f→6234bdc9。小安只改NPC模型/对应测试/报告，root独占本次导演语义与调度。

## 问题与决定

旧唤醒把每次导演snapshot里全部eligible qualification视为已消费，quiet与实际演出没有区分。作者节点未写completed，却可能在前提不变时永久失去再考虑机会。

改为“同一依据只评估一次”：quiet暂缓当前依据，不结束作者事件。原节点仍在作者库，只有原参与人物出现经过确认的新计划、玩家明确决定或执行结果时，才允许新的语义上下文触发一次重新考虑。资格/排除/占用仍由原作者资格读取器决定；不改为必演、定时重试或靠消息数推进。

## 真实调用链及归属

内核原成功event/command→director_pending_reasons→新只读来源认证器（world/owner/version/committed command及原attempt旧state）→按作者resolved参与者选择相关证据→原narrative wake稳定ID→原Director snapshot/send/commit CAS→原opportunity/episode请求→本人NPC模型/内核。没有旁路引擎、新状态表或SQL迁移。

来源必须确实对应事件里的新增/改变计划、新玩家决定或实际结果，不能仅凭一条report、聊天或caller ID成为新依据。每actor/kind只取最新已提交依据，避免把全部历史正文带入唤醒。重建过去上下文只作付费去重边界，不作为完整历史摘要。过去没有语义证据的cause维持原哈希字节，保护部署前paid快照；unknown仍沿原pending/recovery栅栏，不换身份重买。

导演模型说明更新为v9：authored_eligibility可以代表新资格，也可代表相关真实改变后的再考虑；允许有依据quiet，事件仍待演。110v15显式replyAs与input.speaker，保留原text/source/history/goals、Output及实际供给manifest，不关键词改写输出。

## 必要证据

- 真实本地PG18/18：原付费/unknown/深聊/资格/CAS边界及新增连续旅程。导演quiet后普通私聊不重买；非参与人物计划不重开；原参与人物经原NPC服务实际提交新计划，作者qualification不变但出现稳定新cause；时间前移ID不变；原Director创建作者机会→本人NPC独立engage并发言→episode active而非completed；后续相同依据不循环调用。
- 110专项25，纯重评来源选择；集成check3171与最终build通过。最后PG源码18通过，不重复其余旧套件。
- 独立只读审查无新增阻断，指出到达/现场进入来源不在本轮扩展范围，已保留OPEN。
- 无新SQL。生产2026-10-16T09:05:30.248Z只读86/86 checksum，原作/副本/玩家保护数据未变；epoch2=2为前轮明确授权合成测试。

受控gateway证明实际运行链路，不等于真实模型自然演绎。本轮尚0模型，另提最多6调用沿用合成档验收，未答复不执行；前轮4/6已闭账。

## 迁移、回滚、剩余

旧世界、时钟、草稿、人物档不改；不将普通玩家或旧档切成新引擎。回退本次应用提交即可恢复旧重评策略，既有不可变事件/回执不删除。新证据上下文已有paid调用须原身份恢复，不能通过回退清除unknown。

OPEN：实际到达、进入现场等若没有改变原作者qualification，暂不通过本次typed actor来源重开；已创建episode全部参与者quiet/defer后的修订和再安排仍待继续接原责任生命周期；真实模型NPC是否不再复述玩家、是否自然承接作者事件尚未验收；泛物理结果、非现场感知、旧档接管与普通玩家启用仍未完成。最终SHA/READY/公网及本轮模型结果接续主表和报告镜像。
