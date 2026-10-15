# 44-71 · 导演发送与提交的活跃边界

唯一集成人 codex-root-ma-arch44-i，源码 history-chat-media/codex/ma-arch44-integration。延续同一多Agent方案，不另建引擎。主登记仍是主目录 DEVELOPMENT.md。

## 已修改的实际入口

`PostgresDirectorRuntimeRepository.current` 在原 world 锁内取得 clock 锁，锁后采样活跃状态。实际 claim、request_sent、commit 和原结果 recovery 均经过这里。暂停、离开/managed租约过期返回明确 DIRECTOR_DELIVERY_DEFERRED，不把暂缓当作未知或非法输出。短事务之外才调用模型。

request_sent 更新后再核活跃，commit 完成所有决策、机会、游标与人物请求写入后再核一次，避免活动租约在短事务期间自然到期。失败回滚整个事务；付费模型原返回是在先前事务中受保护保存，不随本次提交失败丢失。

新增 bootstrap 和作者时间机会均服从已有业务焦点：玩家深入交谈时延后。实际全局变化与原有责任的正常协调不套用“一律深聊禁止”。epoch切换、版本、来源、token、执行lease等已有围栏保留。

`runDirectorAgent` 对确认的发送前延期记录 cancelled_before_send。bootstrap 原因只在数据库确认 sent_at 与 response_hash 都为空时，依据原取消记录产生一个稳定后继；普通轮询不变号。任何已付费终态消费原启动评估，unknown保留原身份。原 pending 优先恢复，不用后继绕过已付费结果。

## 验收与边界

第一轮旧相关真实PG50pass/2fail（含父）：仅原时间资格测试仍期待借cause冲突标stale；现在更早返回明确延期并cancelled_before_send。已更新精确诊断断言，同时保留零发送、无raw、同V稳定后继及仅1次付费断言；再次相关真实PG52/52通过。

check2936/2936；最终边界补充后build通过。D72独立验收新的真实暂停/焦点、付费结果恢复及SQL期间活动自然过期；最终联合结果和部署证据在实际完成后追加。所有模型均明确替身，0真实模型/生产测试存档/图片/浏览器。

本批只修导演。普通 NPC player/wake 的发送前暂停竞态及零发送恢复还在69，不能宣称所有渠道已覆盖。普通NPC最终内核已有暂停保护，但入口读取clock后、真正发出模型之前仍缺原子活跃检查；修它必须同时解决原外部command到零发送后继的结果查询，不能简单cancel后永久BUSY或悄悄重复购买。

具体事件的逐人物语义交接、真实事件发生与结果、完整观察、旧档接管与旧入口退役、手机首次启动及真实模型连续旅程继续未完成。生产epoch2仍为0，本批不改变正在体验的存档。

集成实际入口时，旧64暴露advance应安静等待，而新guard将暂缓向上抛出。root93e8ce1c在scheduler及额外global协调边界返回确定性延期/quiet，不伪造Director决策。旧64改为核对更早的原子回滚：暂停时0episode/0request、原response_received；恢复后同attempt/responseHash、同原raw opportunityID、2真实request及一次NPC执行。所有world_messages/commands/outbox/events/receipt/actorstate不写断言保留，不能只比较空集合。

最初相关98项96pass/2fail含父；旧helper默认要求2request，首次调整仍26pass/2fail。已明确未创建与已提交两阶段，旧组最终11/11；最终联合真实PG **63/63，0fail/skip**。D72独立20/20包含两种实际SQL期间activity到期探针，不以初始guard拒绝冒充末尾检查。

最终check **2936/2936**，最终build与format通过。2026-10-15T18:26:55.493Z生产81/81 checksum只读核验一致，保护原稿/副本/玩家world未变、epoch2=0。无新SQL，0真实模型或生产测试存档。READY与公网证据待实际追加。

发布前只读审查发现P2：普通无evaluationCause的全局协调也可能被发送前取消，其固定frame command导致恢复时INVALID_STATE。root9c51f896/3367a574已补同帧零发送前驱读取与稳定后继；scope/current/source/epoch/版本重验，sent_at和response_hash都必须NULL，完整语义帧匹配，排序不依赖数据库collation。paid/unknown绝不进入后继集合。没有取消记录时保留原命令身份。

D72增量实际PG **21/21**，包含已完成bootstrap后真实travel产生普通全局变化、claim内暂停、同V恢复一次，以及普通paid unknown仍无后继。root最终源联合 **36/36，无fail/skip**；前批受影响联合63/63保留，不能把两次相加冒充独立测试数。最终check2936/build/类型/格式通过。中间c104f98e已READY但含上述已定位恢复缺口，不作为最终71交付，最新修复部署接续中。
