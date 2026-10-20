# 44-168 核心聊天链路减法

root-simplify168 唯一集成。基线4685cd74，主目录main。用户已授权开发、真实验收与每批部署；不以减少保护或假消息冒充提速。

## 实际调用与第一批边界
原入口world-message-http → npc-agent-services → readPrivateAgentSnapshot → run-agent/NpcAgentModel → stream prefix/完整kernel.commit → 原事务/Outbox → 原媒体worker。第一批修改同一条路径，不新增快速聊天或另一套执行器。

原v14请求依次经过v13/v12/v11/v10/v9/v8/v7/v6/v5/v4/v1解释，多次映射来源和完整schema。新v15请求直接一次来源映射、一次意图编译进入canonical proposal。历史v14及更早解码保留且只负责历史输出，不重解释付费记录。

## 删除、合并、保留
- 删除即时生图必须由模型构造goal/plan的要求；原AgentAction支持goalId=null，原能力执行仍保存真实结果。无空壳目标或计划，旧关联行动不能改null脱离旧责任。
- 当前模型顶层仅protocol/statements/executions/changes。普通交流changes=null，不需要回显十余项空状态；变化时提供原受权限裁剪的增量。没有输出等于不变，不清空旧状态。
- required事件选择/议程复盘仍要求changes对象，避免schema允许空而提交再拒绝。普通交流没有新增强制判断。
- 提前生图直接编译canonical proposal，不再借用v1包装绕一次历史解码。
- 保留身份和可见材料、原工具执行/去重/回执/unknown保护；原旧存档内容不删除，不让模型直接改数据库。
- 人物上下文协作06f1777b合并：同事务重复材料复用、按实际来源类型读取，原夹具45→32及60→39次上下文查询。仍需进一步降低完整hydrate和提交查询，未宣称已简化到底。
- validateInput与describeSuppliedContext复用同一快照已准备的模型消息，避免付费前重复组装。

## 状态归属与迁移
原world事件/actor state/action results继续权威；新即时行动仍在原actor actions及原媒体请求/任务中，不新增表或旁路。保留旧目标/计划，不批量重写用户档。无新SQL。
旧版本软件可能不识别新行动goalId=null，因此回滚须保留本批nullable读取/领域支持，仅回退新模型协议选择；不得直接降级到不支持新记录的整包旧二进制。已提交媒体继续由原任务恢复；unknown不自动再买。

## 验证
领域42项、当前协议普通/即时工具/required事件/空工具6项；原流式真实PG正常与suffix中断均使用v15无目标生图，原ready先到/幂等/旧图片来源保护通过。上下文真实PG原输入/计划/记忆/媒体保持通过。check3852通过后追加2项当前协议测试通过，build通过。真实模型与部署证据接续填写。

## 未完成（第二批，不冒充本次已交付）
1. 统一整个回合的接收、文字、工具、最终提交版本规则，取消无关世界变化阻挡普通聊天。
2. 减少完整世界hydrate、claim重复认证、普通回合95次左右提交查询；当前数据来自受控PG，非公网SLA。
3. 在同一精简路径下验收多NPC主动消息/持续事件；165原用户档与长线体验仍保留原任务。
4. 对状态变化中的重复问题/责任引用继续机械绑定，进一步减少需要模型抄写的字段。

## 真实验收接续（2026-10-20，未部署）
独立合成正式测试档b95f78f6，未使用用户档。首次生图文字/动作成功提交，goals/plans均0；供应商HTTP200但适配器未取得图片字节，outbox明确failed:no image bytes，不自动重试原请求。另一次独立索图成功，35.032s首文字、88.294s读取新图；原资产API200/image/png/1787372字节，文字与图独立；本地跨区样本不代表线上SLA。
普通聊天检查暴露模型重复历史索图；不是保存失败。清理旧提示词中强制创建计划及重复图指引，重新验收后再部署。失败样本保留，不用后续成功掩盖。图片首次无图原响应未保存，不能断言是解析格式还是提供方没有生成；新成功响应为已有字符串data URI格式，无证据不扩展解析旁路。
重验普通聊天4832ec2f：真实输出changes:null/executions:[]，成功提交，未再创建媒体任务；本地31.694s首句/53.120s整轮，时延仍未合格，第二批继续处理。最终模型/协议46项通过，build再次通过；生产100/100迁移一致。正在第一批提交部署。

## 第一批生产与追加清理
5ea6fa5156b6e9013308b93b551402f3696d33a0 / dpl_GTXtBGKYQ7kiUCXGYCPMmW9WCGDV READY，正式Nu别名一致。公网普通聊天589dd189首句5.285s/整轮5.935s，单次样本非SLA；原资产真实读取200。公网再索图38fe1571有对白但executions=[]，因此本次发图不合格，未伪造任务或手工补图。
协作只读审查发现旧提示词85仍要求所有承诺必须建goal/plan、95仍带v11不能省略目标、99要求已删除机械字段，已一并清理，并使末条通用指令同时覆盖立即执行与不执行，未加关键词触发/额外模型审批。46项聚焦/build通过。追加真实索图3d7f22f2已自动收到新图74.269s；但人物提前说“拍了一张”，措辞仍不够准确，列为语义质量未完成，不宣称所有人物表现稳定。
连续复验：3d7f22f2新索图真实图 → b5986b7d普通聊天executions=[]且没有新媒体任务 → ebcc4ce4再次索图自动收到新图74.414s。三个请求均为原消息入口、同一合成存档、一次人物调用；没有手工动作/消息或自动重试。提前声称“拍好了”仍不合格，明确留待优化。本地测试档已暂停。

追加部署dbe42d73 / dpl_DmCfmeFp6VdTpgFqwpo9DsX8AHGj精确READY，Nu正式别名一致。最终原资产1752685字节PNG，原消息独立投影。三个协作子任务集成验收完成释放；root第二批与明确语义质量缺口仍进行中。

## 第二批：事务内读取复用与同轮版本规则统一
基线11f570cf；小迪44-169有界上下文读取独立进行，未修改其文件。
- 新增agent-commit-version.ts：文字prefix、媒体prefix、最终提交复用同一V/V+1判断及原attempt/command/event/segment归属证明，删除两处独立解释。非本人版本仍拒绝；未宣称解决无关世界变化。
- beginAgentCommitFrameInTransaction返回本事务已经锁定认证的世界基底、人物与输入。旧begin入口仅委托同一实现，不增加另一套引擎。kernel复用输入、地点和原始状态；执行器使用structuredClone工作副本，防止变更基底后重复施加效果。
- finish合并世界/attempt/epoch/真实event+command证据读取；仍按提交时clock_timestamp检查租约、核对token/actor修订、实际写后版本，并在同一事务核销。没有以开始时live布尔替代结束时判断。
- 原流式真实PG通过；runtime31项包括新增事务中途租约到期回滚；上下文对照普通总查询127→121、stateful135→129、image142→136（每轮6次减少，非延迟SLA）。check3854/build通过，生产100迁移一致。
- 后续真正相关依赖准入尚未实现：需将输入快照版本和实际追加事件版本区分，并统一来源/回执/恢复消费，不能修改attempt原始请求或只放过一处比较。小迪的新reader接线待其交付。本批不修改用户世界内容。
第二批真实合成档原入口81fa56b8：一轮真实文字调用、正式文字与整轮保存成功、测试档暂停；本地首句20.952s/整轮32.844s，不能当公网速度。原同档普通查询236→230、提交173→167，与受控PG每轮减6一致；仍需后续大幅减少调用链，不宣称已消除全部延迟。待部署公网检查。

第二批部署278d925b / dpl_FvXy7EQswYGXKonkHpjNV7yn1fJb精确READY、Nu一致。公网cd7e05e6单次文字调用首句6.522s/整轮7.212s、230查询/167提交查询，承接前轮音乐话题并保存，测试档暂停。额外旧npc-agent-kernel PG四项失败，隔离git archive 11f570cf同样四项失败：空等待计划、旧原始协议引用短来源和位置报告来源失配；不是本批新回归，但应整理旧夹具并重新验证，不能标作通过。整体相关版本准入与主动演绎仍未完成。

## 第三批：付费前无关版本准入（2026-10-20）

业务提交4c1fbe99。统一acceptsAgentInputVersion：原输入版本/hash不改；private/player仅当目标人物投影不晚于客户端版本且没有后续正式私聊消息时，允许无关世界版本推进后的接收。accept及claim共用规则；流式文字先于actor状态提交的窗口由world_messages事件版本保护。群聊/现场/系统唤醒原规则保留；付费后提交仍使用原快照CAS。

check3854/build、原runtime真实PG34通过；生产100迁移checksum一致，无新SQL。本地构建原HTTP真实模型：合成档b95f78f6两次均以客户端v13发送，林悦成功提交v14，刘航仍以v13一次成功提交v15。command463d21d9-849f-4473-9ec8-80df82e7ef17与ec8e3941-c58c-4784-8666-e7f65d3bdbd7，各1次模型，共2文字，结束暂停。全轮44.1s/30.3s（本地跨网络数据库），不宣称提速。未改用户档。待部署READY及公网验证。

未完成：目标人物已变化时的可答复对象范围；付费后无关写入冲突；169有界读取接线；持续自主推进与媒体提前完成措辞。

第三批正式部署：4c1fbe996973d25eb8e806bd1588a422040fa8b4 / dpl_8XA3Z3gxFNeJ6PD1zSPp4vBjwnUq 精确READY、Nu别名一致。公网原消息接口同客户端v15，林悦/刘航分别提交v16/v17，一次成功无重试，全轮7.229s/4.696s；本批累计4文字/0图，合成档已暂停。check3854/build/runtimePG34/生产100迁移校验及公网health/workbench200通过。仅完成付费前无关世界变化准入；目标人物更新后的旧选择范围、付费后无关冲突、169接线及持续主动仍未完成。

## 第四批：有界读取实际接线与提交冲突审查

root已集成169冻结实现e5b02e13/e79a6c0f，未覆盖小迪工作树新增补测。npc-agent-services的新请求准备使用readChatContextWorld，actor state缺失仍原错误；仅ChatContextFallbackError进入完整hydrate回退并记录reason，数据库/权限等错误原样传播。之前已有attempt恢复仍原完整读取，claim/kernel/媒体/流式执行仓储不变。无新helper/队列/缓存/SQL。当前check3854通过，boundedPG/streamPG通过；native-service九子项在旧private fixture UNKNOWN_SOURCE失败，eaf8f3e4隔离基线复现同样九项，不算通过。

付费后冲突下一步明确：receipt.expectedWorldVersion、attempt/snapshot基线保持不可变；实际appendBaseVersion/commitVersion须在原commitFrame明确分离，并从原command/event/segment凭据恢复。所有实际事件/结果/人物投影版本与finish共同接线，媒体来源核验仍按模型基线。不可将临时改写的attempt传给校验器。当前流式反复补全同一event，若其他event已插入，不能回头改历史prefix；完整并发需将后续变化演进为独立追加事件并统一回执/重放协议。群聊0074有实际SQL约束不能仅改TS。本批不删保护、不另建纯聊天提交旁路，不宣称付费后冲突已解决。

第四批接续：集成小迪最终50d77b00为10eef235，新增边界及真实snapshot媒体接线PG2/2通过。check3854/build通过（最终追加仅测试/报告无业务变化）；本地真实原HTTP合成档c6717814一次模型保存v18，首段18.857s、serverTotal28.520s、contextQuery61/commit167/总228、事务12；相较前同人物样本230/13仅是查询减少证据，不是延迟SLA。合成档已暂停，0用户档写，待部署。

第四批正式部署：a37f82183d41cc3b9a0bec7a2f629caa18e764cc / dpl_8wcc8nemGKpi1z3jry5fsnTyMrhK 精确READY并绑定Nu。公网原HTTP真实合成聊天承接前文，首段6.758s、全轮7.674s、服务端准备819ms、保存775ms；一次文字调用提交v19，测试档暂停。批次2文字/0图，无用户档写。check3854/build、原streamPG及169最终边界+媒体PG2通过，生产100迁移一致，公网health/workbench200。169实际入口接线完成；付费后跨版本提交、长期自主推进、媒体提前完成措辞仍未完成。

## 第五批：付费私聊追加版本分离（待上线）
输入/模型基线不可变；事务内共用resolver证明中间是其他人物无共享变化的纯私聊后分配实际追加位置。事件、命令、结果、人物投影一致使用实际版本；后续来源/观察消费用实际event-command关系，不提高snapshot可见上界。恢复不再仅因世界版本增加丢弃原付费结果。
首段后交错仅封存原transition，禁止回写旧事件；未保存后缀不冒充完成。媒体来源使用同一提交证明。
限制：绑定事件私聊、coordination、群聊/现场仍严格；共享结果/位置传播/事件决定/计划变化不当无关聊天。相关SQL及交错后缀续写仍待后续，不宣称全部并发解决。
check3856、真实PG35（含原服务首段前普通回复/媒体、首段后交错历史不变及命令重放）通过；独立只读复审通过限定范围。生产100迁移一致，无新增SQL。

真实原HTTP并发模型验收：同合成档两人物同时以模型v19生成，分别committed v20/v21；第二条command追加基线20，attempt模型19保持不变。2次文字、0图片，无自动重试，档已暂停。耗时25.645s/33.302s，不证明提速；build通过。

44-168第五批正式部署：eb2589041a3d492e34c3ab0e045955f1b48c5561 / dpl_F7pnpD2jsef2LsXnM2j5FMHRVptv 精确READY并绑定Nu。公网真实并发：两个NPC同模型v21分别committed v22/v23，后者实际append基线22、模型仍21；5.271s/9.073s，无重试，合成档暂停。本批共4文字/0图；check3856/build/真实PG35、生产100迁移一致、health/workbench200。仅完成无绑定私聊首段前其他人物纯交流冲突；事件绑定、首段后交错后缀、持续主动仍未完成。

## 第六批：携带待演事件的私聊提交（待上线）
原输入与模型基线不变；无关人物纯聊天的追加证明现同样适用于player episode binding。actor intent与作者目录重验复用原事务提交许可，目录scope/来源范围保持原snapshot版本，材料hash仍精确比对。0101替换0084的两个消费函数，用成功command/event实际版本关系证明消费；claim绑定INSERT未改。narrative原输入版本允许早于模型基线，但仍校验原receipt/hash/manifest。

必要验证：原player-episode-manifest真实PG9/9，包括bound模型生成期间B先提交、原付费response_received恢复前B提交、manifest篡改拒绝、unknown不重买、同request只消费一次。旧夹具更新为当前导演v14、正确内部材料呈现及真实来源，计划复查统计只计原actor_plan，不把新增独立agenda初始化误算复查。check3856/build通过，独立只读复审通过。

真实模型（本地真实PG合成世界841e40a2-2183-42ea-bdd9-a28268a94d83，原npcAgentServices，导演为受控夹具，不冒充真实导演）：2次文字，A真实输出后B真实普通聊天先保存；A仍基于v0保存为v2。A回复愿意讨论，但changes=null，事件保持pending；因此保存并发通过，真实事件选择消费验收未通过。不得强制补choice或重买模型跑通。测试world由fixture结束暂停，无生产用户档写。

剩余：普通聊天对相关事件的语义选择遗漏；流式首段后独立追加单元与回执/媒体统一；群聊现场0074仍严格；长期自主推进。不称全链路完成。新SQL兼容旧业务写入方式；回滚仅回业务包保留0101消费证明，历史迁移不重写。

44-168第六批正式部署：a8d64ff00f6f032f89b3c55687c15b28b29f942b / dpl_8sf9etHAG36w2SUyrFQvQWucGK2M 精确READY并绑定Nu；生产101迁移checksum一致。check3856/build/manifest真实PG9及最终typecheck通过。公网普通并发两条回复均committed，9.871s/10.727s，合成档暂停；health/workbench200。本批共4真实文字/0图；本地真实绑定并发保存成功但模型changes=null，事件仍pending，真实事件选择消费不计通过。流式后缀独立追加、绑定语义选择遗漏、群聊现场及持续主动继续未完成。

## 第七批：独立追加与真实回复结算（进行中，未部署）
基线8c4cb3d8。root统一集成，append_units独立工作树实现原stream ledger上的确定性子命令/事件，final用原command；小迪56d15b0b五个测试/报告进入主目录待集成。不得重复付费调用或改写旧prefix。
root已接投影v2：回执声明同一原请求的真实messageEvents，客户端逐条验证来源并去重，不把所有消息假标final版本。partial_interrupted注释真实NPC末条消息，用户输入保持sent，不出现重新发送按钮；浏览器仅保存原命令查询身份，刷新只读回执，未知不重买。原服务中断分类修复：只有明确用户新输入打断才superseded，普通提交失败不能冒充正常打断。必要UI/回执单测24通过；完整core、SQL、真实PG及模型/浏览器验收尚未进行。
已识别仍需共同处理：历史prefix的兼容恢复、早媒体真实result复用、episode展示消息集合、同人物新输入遇到结算版本、图片投影锚点；群聊现场及人物语义选择仍单列未完成。

第七批集成验收：7a8f2c7f（append_units 4b8cbc5d）、b636887d（ba71e9e9记忆来源）已接原入口；final/seal按真实单元事件写原记忆，不给首条增加派生查询。每段使用独立成功子命令与不可变事件，媒体来源仍绑定同一attempt的真实文字；final原请求结算。查询/回执聚合真实来源，投影v2保留各自version；原版本客户端仍走原六字段回执。
PG连续旅程16/16通过（并发6、恢复9、stage2 1）：A首段后B插入A继续、首段前交错、同人物新输入、历史回放、媒体只生成一个任务、记忆真实来源、中断封存。check3863/build通过。
真实模型：本地真实PG合成档55551bce-16b4-45de-91e5-c3ff4c6083c1，2次真实文字/0图；A首段v1 → B结算v3 → A后两段v4/v5 → finalv6，耗时7.896s（含受控等待B插入，不是速度SLA）。原模型基线保留，重复原请求不增加调用，原prefix payload不变，结束暂停。原始记录.local/168g-real.log。
页面：Ego同一验收space4、本地本批生产构建、合成档，390×844无横向溢出、1046×663 PC聊天输入与消息布局正常；未实际在浏览器注入partial故障，不将单测冒充该体验。浏览器任务已关闭。生产102已应用；部署READY与公网验收仍待完成。
回滚：保留102迁移和已提交单元历史，不删除或重写事件；若需停止新单元生成应前向修复/暂停相关入口，不能直接回退旧消息读取实现，否则已生成单元的原请求回执可能漏消息。

第七批正式部署：业务fdb89b7e5361ccf783d54dd3f4bb2855bd20b082 / dpl_3LGkxkTi9BKWwFgJB2HFZbt7w6Xk精确READY并绑定 https://parallel-life-nu.vercel.app ，生产102/102迁移checksum一致。公网原HTTP合成档b95f78f6两人物同模型v25生成，文字分别v26/v27、最终结算v28/v29；各一次模型均completed，耗时7.731s/8.124s；v2原请求查询完整保留messageEvents及消息来源，结束暂停。health/workbench200。本批总计4次真实文字、0图；没有对用户存档写测试消息。
已完成本批“首段后交错后续丢失”的核心修改与上线，不代表群聊现场、相关行动条件变化、事件选择语义和长期主动推进已经完成。这些继续保留任务清单。

## 第八批：群聊／现场复用实际追加位置（待部署）
原统一resolver扩展到player group/scene，仍只接纳经过逐事件证明的其他人物无共享变化私聊；不是任意跨版本重放。native projector使用同事务已准入head，snapshot/attempt/receipt不回写。群聊来源认证改用成功command的实际追加版本；frame.worldVersion知情上界、当前群成员/现场/位置重验保留。SQL0103替换0074两函数及0080出发行程guard的旧expected绑定，其他授权/结果证据不变。独立只读审查通过。
新增原入口真实PG group/scene旅程3/3：模型准备后B私聊先提交，A在实际位置保存；下一轮原上下文包含前轮群/现场内容，不包含B私密文本；原事件不改写，重复任务不调用模型。旧native/scene/journey回归37项35通过，actor_left_presence旧用例及父项失败；在未修改基线ba71e9e9的独立工作树同样复现，非本批引入，已登记交小迪审查，未弱化断言。
真实模型发现合法完整JSON外包单一代码块被RESPONSE_JSON拒绝。原解析入口只去完整单一代码块外壳，保留原始输出、原JSON/schema/内核验证；不从说明文字提取、不修复损坏JSON。30协议测试通过，保存的真实失败输出离线以原snapshot解析成功，0重买。另两份真正损坏JSON/缺字段仍invalid_output，未放宽。
真实模型本地合成：第一组群聊A在原模型v2上保存实际v4，B为真实私聊；群第二轮遇完整JSON代码块失败，原响应离线解析验证通过。后续两次嵌套B真实调用因坏JSON失败，A的测试包装器尚未实际调用上游但原运行器保守标unknown，未重试这些请求。将隔离变量B改为受控私聊后，新的现场合成档20c8e5fc-4efc-47ce-a555-ada2b3e147b6两次真实NPC调用通过：模型v3、B提交v4、现场v5，下一轮v7。受控B不计真实模型成功，重复提问导致近同回复，不以此证明人格/长期叙事质量。本地本批实际调用共8次文字、0图；合成档全部暂停。
尚未完成：相关共享条件变化时无依赖文字与失效行动分离、长期主动推进、人物语义选择遗漏、模型结构输出稳定性；本批不宣称这些已修好。待check/build/生产103核验/部署READY/公网关键入口验收。

第八批公网阻塞定位：3985b554/0103已上线，群聊原PUT120秒超时、无新NPC或导演attempt。a9735ba7增加不含正文的阶段日志并READY。合成任务通过原取消入口停止；原零调用恢复因世界已推进VERSION_CONFLICT，未改历史或强行重试。新合成群同样停在claim前，pg_stat_activity证明requireInputAuthority群聊15表来源连接执行超过90秒，renew_task等待其事务锁；并非模型慢。将group和membership来源认证各自MATERIALIZED一次，复用四个时间点资格检查，原身份/事件版本/成功command/遗忘来源核验不变。同一生产合成档只读权限查询666ms，原native实际追加PG3/3通过。未声称全轮耗时同比改善。旧挂起合成查询被明确取消，测试脚本finally暂停；无用户存档写。check/build及修复后真实公网验收继续。

44-168第八批交付：1e1c6698577704d5cb72c8b4befa14af802dc1ac / dpl_3bSW2Usvak4pujip5HHM3arXLBby精确READY绑定Nu；生产103/103一致。check3865/build通过，native实际追加PG3/3，协议30；旧scene actor_left_presence失败基线已复现未掩盖。原15表群聊权限查询阻塞超过90秒，改为认证来源一次再检查双时点，同生产合成档只读666ms。原零调用失败任务经原恢复入口完成v35，本地真实模型1次；公网接续原群真实模型1次，v36输入/v37回复，8.001s，历史可读，测试档暂停。本批累计10次真实文字/0图，无用户档写。完成群/现场限定无关私聊追加与群权限查询精简；相关共享effect分离、人物事件选择遗漏、长期主动及模型输出稳定性仍未完成。171状态/测试由小迪维护，不修改其文件。

## 第九批：明确事件选择与真实结果继续（等待公网验收）

业务922f8d06。服务器episodeManifest与coordination共用required consideration，schema/decoder/kernel一致；同次模型可engage/decline/defer/need_information/quiet，不允许口头承接而缺记录，无机会普通聊天仍可changes=null。当前模型输出移除continuation.act重复声明，执行由既有executions/planIntents负责；旧act仍可解码，非法continuation用原AgentValidationError而非UNKNOWN。

原advance的受保护response_received不再因世界版本不同直接丢弃，交统一kernel判断无关追加与真实依赖冲突；查实终态才继续，存储失败不吞。真正deferred paid frame全局保护暂留，未声称任意跨人物相关变化可重放。

原actor_plan收集器对nextAction匹配本人可信真实resultId/outcome时提供一次重新考虑；指纹含结果证据、无时钟/无关版本，旧执行地点不再阻止结果后反思；人物自行更新/关闭计划，结果不自动等于整个事件完成。无结果的terminal标签不授予资格。

必要验证：协议/收集器/选择70通过；原manifest真实PG9通过（含advance恢复无第二模型、已知无效选择不自动购买、暂缓条件重评）；check3867/build通过。独立只读审查指出旧执行trigger应与结果重评分离，已修，最终collector通过。

真实调用：首个合成回应engage但continuation.act无计划，已保存原响应离线核对、没有重买该请求；正确归类已知无效。第二个合成明确engage保存、事件消费成功；扩展旅程又复现重复act后精简当前输出。最终合成806aeb6b经原私聊两次真实模型产生engage和正式appointment.propose；停止玩家输入后原advance三次真实模型（含导演/人物）产生新人物协调回复并初始化另一人物议程，world v5、played1，无手工消息/结果。所有合成档finally暂停。本轮本地累计8次真实文字、0图。该旅程未证明所有后续来自terminal result候选，结果后重评为确定性测试证据；观察到重复确认与角色分工表述不一致，持续质量未过关。

仍未完成：全quiet且无未来条件时的有依据持续议程，长期多事件体验、重复确认/角色立场一致性、相关共享变化的独立文本/失效行动提交，旧v14回执状态兼容。小迪172/171冻结专项测试正在接入；未修改其工作树。

第九批上线：922f8d063db335d11326d9af517da0f3b113b63e / dpl_HUMhQCJYqpwagnkPD7kCzdygDhXH精确READY并绑定Nu，生产103/103迁移一致。公网原合成群下一轮真实调用成功保存v39，7.642s、历史读取完整，结束暂停；这是普通聊天回归，不冒充公网作者事件长期旅程。本轮共9次真实文字、0图。小迪301a3068/275c0766的三个新增测试已接入，当前代码聚焦16/16、typecheck通过，报告镜像保留；不重复购买或运行已通过全量套件。以上明确选择、真实结果候选、自动恢复修改已交付，长期主动体验仍按上述缺口继续，不能标全部完成。
