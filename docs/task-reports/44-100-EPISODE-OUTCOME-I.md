# 44-100 事件结果与人物观察唤醒核心接线

主负责人codex-root-ma-arch44-i，history-chat-media/codex/ma-arch44-integration，基线c1a5cb99。用户要求尽快推进新功能，不重复已有整套验证。小安99独占5 NEW文件，公共契约/SQL/model/runtime/kernel/集成与部署root独占。

## 本批实际调用路径

1. 原导演机会→原人物同轮考虑→原NPC能力建立邀请→原玩家实际回应事务→SQL83真实证据→本批SQL85不可变事件结果→shared episode CAS resolved→原作者资格读取后继。导演取得全局结果来源，但knownByActorIds=[]，不会变成所有NPC都知道。
2. 原成功现场记录→原98来源/历史入场及observableTo认证→本人private观察待处理→原collector稳定observation candidate→原advance/持久导演协调→原同一NPC Agent→最终实际模型输入manifest→原attempt response→原kernel成功提交→99读取真实供给/提交证明核销。quiet可只更新人物状态，不造消息；同源不再次唤醒。

没有新模型队列/定时器/另一个事实内核。浏览12倍/交谈1倍/离开暂停未改，多人/多人生未取消。生产既有世界不静默切换。

## 事件结果权威及限定范围

新增0085_agent_episode_outcomes.sql（sha256 e924b6efe2b375d1196b9e4d93b5d8e4ea74448c7365644ed92d825c0b625024）。append-only outcome同时绑定owner/world/epoch/episode、不可变作者origin与完整node、明确完成scope/policy、实际SQL83答复evidence、原成功command/event及版本。RLS/FORCE，app SELECT/INSERT，禁止app更新和worker/发布方访问，invoker guard不可直接执行。

第一类可核实完整目标是作者明确completion.scope=invitation_response且全部criteria为invitation_response。只有作者明确把“得到答复”定义为此事件目标时，实际答复可满足该目标并解锁after_committed/after_resolved依赖。scope选填、无默认值、不要求编剧界面新增工程字段；旧稿hash不改，不能根据标题或长文猜成“邀约答复即全故事完成”。未声明/混合未支持条件保持active，不从消息数量、engage、出发/到达或模型自称认证物理成功。

结果与原玩家回应事务一起提交，任一步失败全部回滚；原命令重放不重复结果。单人拒绝不关闭别人的责任。其他人物晚到的独立考虑不会重开已结束共享目标，也不被共享状态阻止正常保存其决定。

原64KB模型材料预算不再成为玩家接受/拒绝前提：先核目标是否有实际作者scope，再按服务端容量读取；无scope/即兴事件直接不作此投影，超服务容量不假完成也不回滚合法玩家回应。

## 观察、核销及持续人物身份

6a21c18a先冻结最终供给协议；97f0289c修正native wrapper为同一lazy NpcAgentModel实例，避免descriptor和实际send用不同实例。

suppliedContext={schemaVersion:1,promptVersion,modelInputHash,observations:[sourceId,contentHash]}由模型适配器根据最终prepare实际载荷生成并缓存同一messages发送；仅实际文本供给的scene观察，预算省略不列入。raw response/snapshot/manifest沿原response保存。99读原committed attempt与精确成功event/command/input/epoch/actor/version才算供给已处理，旧snapshot列表、projectedVersion、unknown/失败/raw未提交均不核销。

本人历史现场只进private策略回忆，当前群/现场不自动披露旧正文；人物说法仍为speech，player_report不改变真实位置。原发送/提交门重新认证inbox来源。ACK后若人物目标引用该来源，原sourceResolver核实际已供给hash并重读精确历史来源维持句柄授权，不把旧原文再塞进新群聊。

发现并修复容量饥饿：先认证、按精确source/hash排除已供给，再预算，较早未处理记录不会被最新已处理记录永久挤掉。旧scene当前上下文不按ACK删历史。private预算覆盖完整scene packet；本次observation wake的依据受最终prepare保护，不能正文已被裁而照常消费该wake。过大仍走原真实容量拒绝，不伪造已读。

NpcAgentModel升级v12-observation-inbox；同源candidate身份不含闲聊、world当前版本或检索时间；CAS仍携当前版本。未知收费原identity保护不改。

## 验证证据

- 新结果路径PG3（父+2子），加纯域1共4：正式create/check/publish/startPublished源→真实导演→原NPC邀请→原玩家接受→结果+共享状态→依赖资格。无scope保持active；伪evidence拒绝；插入共享更新故障时原邀请答复/结果/版本一起回滚；恢复原命令和重放不重复；个人goal不被强制fulfilled。
- 99新消费及root private路径最终真实PG11（父+10子）：实际native handler保留最终manifest、供给裁剪/unknown/invalid/stale/旧协议不ACK、raw恢复0额外调用；原private advance→持久导演协调→本人quiet→ACK→第二次无NPC调用；B不知情，目标句柄持续；大于单包预算的真实历史多轮可排空，不饥饿。
- check3159通过（含99 pure9及模型21等，不重复累计）；最终build/type完成后部署。独立源码复核定位材料预算和ACK预算饥饿，两项均已修正并用新增路径覆盖。0真实模型/生产测试存档/图片。
- 生产迁移与READY/公网准确证据见主登记最终追加。新SQL只允许限定结果，不启用生产epoch2。

## 未完成，不以本批宣称完整新架构

任意自由原稿的实际事故/交易/关系结果能力及终局规则、泛知情（房间/视线/非现场感知）、新cause/revision授权、完整旧存档接管/退役、新世界NPC初始实际位置、真实模型跨渠道连续旅程、生产新引擎启用仍未完成。当前99持久来源只覆盖有真实认证的现场历史，不是无限感知；不以API200或局部真实库模型替身宣称玩家自然体验验收。

回滚：保留85结构与已提交结果，不删除真实历史/时间/约定。生产epoch2=0时可退回本批前代码；将来若已产生resolved新引擎存档，需先暂停/排空并使用兼容结果的内核，不能直接退到会拒绝resolved的旧实现。旧已付费response保持原协议，不重新购买。

## 给小安的可转发分工提示词（本批已同步执行）

```text
负责人物观察待处理与消费、稳定候选，使用最新集成分支，不以4f16a7d7调用方传入的scene/接收人/位置说法作为权威。
复用98真实现场producer/历史入场/observableTo/遗忘过滤。私聊报告不升级真实位置。
只把最终实际模型载荷中供给的sourceId+canonical hash、且原NPC回合已成功提交的记录算已处理。quiet可以处理；unknown、未提交、预算省略、旧快照列表和projectedVersion不能冒充ACK。
沿原collector/advance/Agent运行，不另建调度器。候选身份只随world/actor/epoch/source/hash变化，不随闲聊或时钟重建。
公共协议、SQL、model/runtime/kernel归主Agent。仅在独立工作树修改已登记NEW仓储、领域候选和聚焦测试；回传独立提交、真实入口与未接线点，不修改生产或调用真实模型，不重复全量验证。
```
