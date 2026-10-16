# 44-88C 独立限定验收

负责人：codex-ma44-88c-independent-q；辅助线程 01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。基线：1bc7cd0e927abbe78597d3d4e4290e2165f75d35，独立工作树 core-handoff88-q。2026-10-16。状态：待集成人验收。

## 范围与结论

接受集成人本批只读核查分工，主登记短锁领取 44-88C；仅新增本报告、本人主表行和报告镜像。未修改公共协议、源码、SQL、测试、配置或用户数据。没有重复其他人的架构总审，也没有重新实施已冻结功能。

限定核查暂未发现新的可确认阻断缺陷；这不是整套新引擎可启用的结论。当前生产 epoch2 世界仍为 0，不建议据本报告改变开关或发布“渣男体验”原稿。

## 实际核对

1. 本人事项目录来自 readActorStrategyBasis 的来源授权、authorizedAgentState 及模型状态投影；不把之前的 episode intent 递归当作新主题权威。validActorTopicSelection 同时在模型解析和持久提交检查人物、引用及内容哈希。目录哈希排除环境时钟和全局版本，但保留本人依赖图。
2. readActorEpisodeIntentsInTransaction 从已提交导演尝试、实际 decision、request 和 episode 关联读取；仅向对应人物发送所选本人主题。当前投递与 historical 策略恢复分开：前者重读当前授权内容，后者仍核对捕获身份与遗忘来源；private_strategy 的观测文本只能是无原私聊正文的固定说明。最终验证核对来源完整身份与观测原文。
3. 内核先记录实际 request receipt，再沿 projectAgentWorldChange 投影子证据；邀请、玩家答复和真实到达各走原有提交入口。新表须匹配成功 command、实际事件、epoch、动作结果及输出对象，答复和到达还须有同一 episode/人物/动作/对象的前置证据。相同记录重放核对完整 document，不以 ON CONFLICT 静默接受冲突。
4. 导演读取 agent_episode_evidence 时标明“实际子步骤证据”；本批投影没有据此自动把整个事件写成 resolved。邀请不是到达，出发不是到达，接受不是整体成功。
5. 位置告知核对原 input receipt、成功 command 和原消息/现场条目；群按消息历史可见性、现场按当时 presence 与 observableTo 取受众。内核和 awareness 重放都调用受众认证。传播的是带来源的 player_report、possiblyStale=true，未修改真实位置；私聊没有借群受众扩散。

核对路径：actor-known-topic.ts、actor-known-topic-repository.ts、actor-episode-intent-repository.ts、agent-source-resolver.ts、director-agent-model.ts、director-runtime-repository.ts、npc-agent-kernel.ts、world-awareness-commit.ts、episode-evidence-repository.ts、0083_agent_episode_evidence.sql、director-snapshot-repository.ts、location-report-audience.ts、world-awareness-repository.ts，以及对应已有测试。

## 本人运行的验证

- actor-known-topic.test.ts 与 episode-evidence.test.ts：8/8，0 skip。
- location-report-knowledge.test.ts：18/18，0 skip。
- 合计 26 个纯领域测试；不计作 PostgreSQL、真实模型、浏览器或公网验收。首次测试命令还带了不存在的 project-location-report-knowledge.test.ts，Node 没有因此报错；已核对实际文件名并单独执行正确的 location-report-knowledge.test.ts，18 项真实输出已确认。
- 没有业务代码改动，依集成人要求未重复全量 check/build；没有启动本地数据库、开发服务器或付费模型，没有生产写操作。

## 证据边界与接续

现有 actor-episode-intent.test.ts 真实库用例明确检查邀请提出、玩家接受、导演读取、重放去重和伪造对象拒绝。该文件及全部 integration 搜索尚未找到对新账本 invitation_declined、travel_started、arrived 的真实库端到端断言。已有纯领域拒绝/到达测试与旧内核到达数据库测试不能相加冒充新 episode 账本完整链路证据。

建议集成人在启用前补两条聚焦真实库用例：实际拒绝原邀请→新子证据→导演读取；同一 episode 的实际出发→到达提交→子证据→导演读取，并保留未整体完成断言。这是验收缺口，未复现为实现缺陷；不为此放宽内核或改用户存档。本报告没有新增测试授权，故未越界修改现有 integration 文件。

仍未完成：自由原稿完整逐人语义交接、复杂事件整体结果/改期与重考、完整主动观察和模型消费回执、旧档接管回滚与退役、真实模型连续旅程。由主表与集成人后续推进，不以本批局部通过抹去。

## 集成人提供的部署证据（非本人独立公网操作）

集成人确认业务 1bc7cd0e，正式部署 dpl_51nAqRuG8RvhG57coFuNFYxgknxJ READY；独立项目 prj_rdVjHzbkvZrX2aTkVNSafHhySrT2，parallel-life-nu.vercel.app 精确别名/SHA核对。2026-10-16T03:28:28.710Z，health/workbench/published 200，两个匿名受保护 API 401。生产83/83，83 checksum cc245f3d18bcd3e5f97eb2ddff7ba7764bb51d917333ad8e3768561e4e909173；受保护原稿、副本及玩家状态未变，新引擎世界0。

集成人 check3126/build/type/format，以及相关真实库30、32、受众5、权限2属于其验证证据，不与本人26纯测试累计成覆盖量，0真实模型。报告交付后仅由集成人审阅集成和更新限定验收状态。
