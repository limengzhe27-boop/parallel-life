# SPACE-MATTER-AI-QA-02 — 分步执行与NPC真实动作

2026-10-11，根 codex-main-matter-steps-20261011，隔离工作树 xiaoan-accept，基线6e39217。

地图基础A/E/F已部署；完整场景事项链未通过。01真实样本说明只改提示仍重复欠项，本轮不能再用强制成功代替实际证据。

先做R17可信目标纵切：原目标为核对单据、向老周或车主说明接头检修并交付。没有新增客户必到场/签名/重新检查门槛；记录和复检可保存为可选步骤，不变成强制前提。允许接收人用当前该事项相关角色，且必须实际在场和玩家明确指定。已发展旧历史保留；新机制不扫描旧自由文本回填成功。

类型冻结：SceneProposal.stepProposals[] {matterId(世界事项ID),stepId,inputQuote,observationQuote,receiverId?}；NPC独立输出npcActions候选 {matterId,actorId,kind:receive_r17|inspect_r17,quote(必须来自其本次对白)}。运行时验证当前保存attempt、实际在场、事项地点/日程/原始定义/受邀关联、明确交付或请求、引文非计划/假设/自报，才保存。NPC不能操作其他对象/替玩家写单/虚构奖励。

WorldMatter.stepProgress={ruleVersion:r17-delivery-v1,steps:有界来源ledger}；每条带实际主体、接收人、scene/action/input/result事件与版本/时间/引文/目击者。同一步只留首次真实来源，无重复加分。总体完成新增scene_steps证据，不把某次partial硬写成succeeded；允许单次行动结果与累计事项完成区分。NPC效果随同一个结果事件/事务持久化并可回放。原旧提案无新字段继续走旧机制；本轮不标通用自由世界长线完成。

B独占scene-planner.ts和新planner测试；Q独占新scene-step-progress.test.ts和审查报告；根独占新domain、公共契约、policy/reducer/repository及PG专项与部署，先冻结再并行。

验收：纯正反例+真实PG事务/回放/重开/跨用户/回执重放，随后重新申请真实文字预算验分步累计→NPC接收→阶段/机会→下一行动。旧预算不继承，不生图/不用个人资料。尚未完成且未发布。
