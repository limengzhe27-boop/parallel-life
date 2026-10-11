# SPACE-MATTER-AI-QA-02 — 分步执行与NPC真实动作

2026-10-11，根 codex-main-matter-steps-20261011，隔离工作树 xiaoan-accept，基线6e39217。

地图基础A/E/F已部署；完整场景事项链未通过。01真实样本说明只改提示仍重复欠项，本轮不能再用强制成功代替实际证据。

先做R17可信目标纵切：原目标为核对单据、向老周或车主说明接头检修并交付。没有新增客户必到场/签名/重新检查门槛；记录和复检可保存为可选步骤，不变成强制前提。允许接收人用当前该事项相关角色，且必须实际在场和玩家明确指定。已发展旧历史保留；新机制不扫描旧自由文本回填成功。

类型冻结：SceneProposal.stepProposals[] {matterId(世界事项ID),stepId,inputQuote,observationQuote,receiverId?}；NPC独立输出npcActions候选 {matterId,actorId,kind:receive_r17|inspect_r17,quote(必须来自其本次对白)}。运行时验证当前保存attempt、实际在场、事项地点/日程/原始定义/受邀关联、明确交付或请求、引文非计划/假设/自报，才保存。NPC不能操作其他对象/替玩家写单/虚构奖励。

WorldMatter.stepProgress={ruleVersion:r17-delivery-v1,steps:有界来源ledger}；每条带实际主体、接收人、scene/action/input/result事件与版本/时间/引文/目击者。同一步只留首次真实来源，无重复加分。总体完成新增scene_steps证据，不把某次partial硬写成succeeded；允许单次行动结果与累计事项完成区分。NPC效果随同一个结果事件/事务持久化并可回放。原旧提案无新字段继续走旧机制；本轮不标通用自由世界长线完成。

B独占scene-planner.ts和新planner测试；Q独占新scene-step-progress.test.ts和审查报告；根独占新domain、公共契约、policy/reducer/repository及PG专项与部署，先冻结再并行。

验收：纯正反例+真实PG事务/回放/重开/跨用户/回执重放，随后重新申请真实文字预算验分步累计→NPC接收→阶段/机会→下一行动。旧预算不继承，不生图/不用个人资料。尚未完成且未发布。

## 集成接续（2026-10-11）

已合并两位执行者：B规划器接线与执行声明护栏，Q来源/未来/历史不回填/人物隔离等37项负例。根补句首空白防漏判；当前真实历史保留，新步骤仅从本次动作与实际裁定产生。已有真实PG专项5/5，本轮最终全量检查和PG再回归中。此前沙箱禁止本地端口的check失败单独保留，不视作源码通过。

人类已明确授权新的最多2官方合成世界/18次文字（导演/NPC/所有重试计入），根唯一付费执行者；独立忽略账本，旧预算不延续。没有图片上传/生图/个人资料。当前0新调用，完成后正常API暂停；候选发布后真实验收，不凭任务成功认定整个事项完成。

最终本地回归：npm run check 806/806（允许本地端口方式）；npm run test:db 总247=242pass/5明确opt-in跳过、0fail；npm run build exit0。生产只读校验41/41迁移，无新SQL。待发布候选及真实模型纵切，未标交付完成。

## 真实验收第一失败与修复

候选32df2e0，Production racc3qapp / dpl_9rBtVMS4oqGhsAtvcw4VMP2KtzNJ READY、正式8组只读回归过。新独立合成官方v3存档1个，开场保守预留2/18文字；结果failed/AI_FAILED，日志分类TypeError，19874ms，resultVersion=null。未冒充开场成功，未自动重试，不退款/重用已占预算。

根/B只读定位commitSceneProposal非执行分支：Schema默认空stepProposals进入c.action!.relatedMatterIds，开场无action而解引用。修为非执行只拒非空执行候选；实际attempt仍有空数组执行声明护栏。真实PG开场使用同生产SceneProposalSchema默认，新增未来plan未执行，专项6/6；完整806check过。待修复构建/部署后显式读取原failed无结果再人工重试，所有额外调用计入原18上限。

修复383be75 / almk7novd READY后显式检查原failed/resultVersion=null再retry，task succeeded。但开场旁白‘老周师傅在一旁忙碌’而持久presence仅player，无NPC对白，不能据旁白补在场。后续第一步核对R17输出schema被拒（Invalid scene proposal/INVALID_AI_OUTPUT），实际0步骤保存。已保守占5/18，原失败保留，正常API显式离场，没建第二world。B重新领取精确输出/schema白名单diagnostic，不记录raw/人物信息；Q独立语义复核，不称完整链通过。待新候选开场与精确格式验收，不盲重试同坏契约。

B v6源9bdab15已集成f17e061：json_object明确结构、来源步骤例示、省略非接收人ID、已有正式R17不再新建重复独立小任务；不从旁白补presence。Q只读查到agenda与return-followups只认scene_action，根扩至scene_steps并加2消费专项，目击/日期/冷却/旧版本过滤仍保留。新812/812check、真实PG6/6专项过，待build/候选READY后新开场。另一ack人物ID归一化前判断风险暂记待核，不据静态猜旧503。

## v7 有限开场到场与最终本地验证（2026-10-12）

v6候选897d67d READY后第二次新开场成功但presence仍仅player，正式R17本地目标不再重复生成无来源小任务。已保守7/18文字，1合成世界，无图。正常API离场后保留原结果，未据旁白制造到场。

集成B b040ba0/cd59f8c，并串行补显式scene预约无效不可回退其他预约。当前故事时间已到、同地点confirmed合法邀请角色（最多2）独立以present:boolean/text输出自己的在场判断，adapter绑定身份；false不写在场，true由原开场事务写presence来源/对白/预约到场，不产生接收或步骤动作。旧scene.entries不带入此独立判断；commit重复检查当前地点/邀请/时间，约定不等于到场证据。R17当前只有老周候选，开场最多2调用；后续每步2、后续2、手机1，余11严格不自动重试。中途人物进入现场仍待开发。

最终npm run check 820/820；npm run test:db 248=243pass/5明确opt-in skip，0fail；npm run build exit0。真实PG新用实际ScenePlanner+独立NPC判断mock验证开场presence来源保存，再验证分步、NPC接收、整体完成、后续机会与下一行动、回执回放/事务回滚；mock不称真实模型通过。无新SQL，生产迁移41/41已一致。待候选READY及真实完整链，母任务未完成。

## v7真实开场通过，首步NPC格式失败

c67e214 / 7ujmwpif6（dpl_ADNFHPMAz4e37ZoVUYnwE3DAsjbY）READY，正式别名已切换、8项只读回归过、41迁移一致。新开场成功，老周独立判断后正式presence joined/sourceVersion10，当前R17父任务保持in_progress，不再生成重复小目标。对白“这车修好了，刘航快来取吧”只承接原背景，不证明本轮交付/他人到场；旁白17:54说午后且引擎盖/轮胎打开，记语义质量观察，不据此生成重修门槛。

第一步“我核对R17维修单。”failed，事务0步骤保存；安全diagnostic为scene_actor_schema:actions.[0].kind:invalid_value，来自NPC而非导演。保守11/18总额，不退失败预算、不自动重试。B重新领取原NPC精确JSON enum示例（当前混合占位可能误抄），schema不放宽，0额外模型；Q只读判定开场并未明确新增客户必等/签名门槛。剩余若修复后复测原核对2+说明交付合并2+后续2+私聊1最多7，只有真实保存才算通过；原三分离动作尚未验证。中途NPC到场和私聊ack静态风险已加未来待办。

## v8 精确人物动作示例

根集成B be3e049→28c9bb2：NPC的无动作完整JSON、实际接收receive_r17与请求检查inspect_r17各给独立合法示例；不再用“receive_r17或inspect_r17”混合枚举占位，不新增动作/放宽schema/静默归一化。玩家核对明确不是NPC动作。安全日志只能证明kind.invalid_value，不能断言实际非法值就是旧占位。822/822完整check通过，build待完；本小修无SQL/状态逻辑变更，真实PG243pass/5 opt-in skip证据见v7最终回归。Q独立报告ca9b879审核收口预算，若修后原核对重试2、说明+交付合并2、后续2、私聊1=剩余7，且首次来源不能改变、整体与接收必须真实保存；不能称原三分离动作均通过。待候选READY再明确单次复测，不自动循环。

## v8正式复测第二失败

42b80a5 / 2s95vc381（dpl_EQTo7Qx2puZQmUWwkUPbsAbYTkR1）READY、正式别名与8只读检查通过，822check/build0。明确读取原首步failed/resultVersion=null后人工复测仍failed，保守13/18，0步骤保存。精确safe diagnostic: scene_schema:matterTitle:invalid_type;matterUpdates:invalid_type;dialogues:invalid_type，director阶段，不能据日志断言实际字段值或已经调用了NPC。B仅新增缺失无副作用字段默认兼容与负例：matterTitle缺失null、matterUpdates/dialogues缺失[]，显式错误值仍拒，runtime动作来源/提案/事务不变；Q只读复核。不盲继续付费。余5如候选通过最多一条新核对+说明+交付2、真实后续行动2、私聊1，可验有限闭环但不能称三次分离累计模型通过。此前失败完整保留，不从旧文本回填。

## v9 严格无效果省略兼容候选

集成B c7a48bf→cf4ec8f：仅matterTitle缺失/undefined→null，matterUpdates/dialogues缺失/undefined→[]，语法接受范围有限扩大但不授权动作/事实；显式null数组、错误值/枚举、unknown、非空导演对白/假NPC动作仍拒，必需location/presence/outcome/observation不默认。4新pure证明中性默认不能完成整体或凭空接收。安全日志未给实际值，不称线上根因已证实缺失。826/826完整check、最终真实PG现场专项6/6通过（此前全PG243pass+5明确opt-in skip）；构建在途，无SQL/数据库迁移变更。Q 671d601独立复核边界与余5合并验收范围，跨轮累计质量仍未真实验证。

## 最终真实结果与交接（2026-10-12）

v9应用6b629ba / po54gy1kk（dpl_J7khbwtNXTwrXGKqaAawsADDY92j）READY，正式地址已切换、8组只读回归通过，41项迁移一致、无新SQL。826/826常规检查、最终真实PG现场专项6/6和生产build exit0；此前全PG248=243pass/5明确opt-in skip。本地/PGmock验证的是分步累计/独立接收效果/首次来源/幂等/rollback/跨用户/阶段与下一行动保存，不替代真实模型验收。

新实际动作“我核对R17维修单。我向老周说明R17电源接头检修细节，并将R17钥匙与维修单交给老周。”结果unknown，安全日志TIMEOUT/stage=response/HTTP200/duration85125ms。只读world version12仍无stepProgress，R17in_progress；没有近期完成、阶段、后续机会或phone实际保存样本。不能宣布v9治愈实际格式问题，也不能把HTTP200、已有开场或数据库测试当完整链通过。未知provider执行结果不退预算/自动重付。

本轮1官方合成world，保守15/18文字上限，失败和unknown全计，未耗尽但余3不足按原要求再验完整链且不盲retry。0照片上传/生图/个人资料。正常clock API确认全部测试世界paused=true；账本closed，manual工具补关账保护，只允许后续只读/摘要/重复暂停，关闭后尝试opening在发任何请求前被拒，计数仍15。旧预算不沿用。B/Q仅0模型独立源/规则审查，根唯一付费与发布。

母任务待验收而非完成，优先SCENE-MODEL-STABILITY-01：结构化模型输出与完整响应超时、unknown原回执/任务安全恢复、真实分轮核对→说明→交付→接收→后续→私聊的新独立验收。开场合法人物独立到场已真实保存；中途NPC进入SCENE-NPC-ARRIVAL-01未开发。NPC-RESULT-ACK-01静态风险未真实验证。通用自由/旧世界达成、长期分歧/资源/关系兑现仍NOTES-WORLD-03D；地图A/E/F基础已上线，地点玩法及用户视觉/操作验收仍待，不说地图完全补齐。

B83561cd与Q51028576最终独立报告均已集成：HTTP200只证明收到状态，不证明完整合法响应或schema通过，未归因到哪个Agent。只读v12无steps是该时点的保存证据；暂停不是退款或上游撤销，unknown今后恢复先核原command/task/receipt。两子任务仅技术/独立审查完成并释放范围，母项仍待真实完整体验验收。手工验收工具仅补closed账本保护，node --check/diff与闭账0请求负例通过，不是新的生产业务变更。
