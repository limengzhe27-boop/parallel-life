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
