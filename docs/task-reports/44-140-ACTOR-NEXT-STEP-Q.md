# 44-140-ACTOR-NEXT-STEP-Q

负责人codex-ma44-140-nextstep-q；root指定，待验收。独立actor-next-step140-q/codex/actor-next-step140-q，精确基线c2f01993。仅application/agent-schedule-collectors.ts、NEW domain/agent-plan-next-step.ts、tests/agent-schedule-collectors.test.ts、NEW tests/agent-plan-next-step.test.ts、NEW tests/integration/actor-plan-next-step.test.ts、本报告及本人主表/镜像。PG55600独占，启动前无监听；不改NPC model/kernel、Director、SQL、公共server，root统一接线/验收/部署。

## 问题与处理

138真实报告证明承诺已保存goal/plan/responsibility，但没有action/nextAction/trigger/nextCheck。原普通计划collector要求nextActionId及真实可用action；action=null重考只支持episodeFollowUps。因此单独有明确条件的普通计划也无法按条件承接。本补丁不凭空为旧空计划制造下一步。

- NEW纯分类agentPlanNextStep：closed、action（仅描述存在允许能力，非执行成功）、unsupported、reconsider、waiting、missing_next_step。无nextAction却有actionIds视为缺合法下一步，不绕过既有action执行条件；只有真的无动作且非空triggers才有条件重考。missingConditions有文字但无条件时诚实waiting，空白意图为missing_next_step。不做关键词识别、自然语言转动作或生成默认超时。
- 原collector扩展普通无action计划：本人授权goal/plan来源完备，非空合法triggers经原条件解释器满足，才产生actor_plan/actionId=null候选，沿原调度/原NPC回合/原事务重考。能明确等待、提合法下一步或安静，绝不自动完成实体工作。
- 新普通重考候选稳定身份仅绑定planId/goalId/触发条件/实际来源证明与条件结果；summary改写、actor revision、世界版本或时钟变化不触发新付费身份。同证据成功quiet继续由原wake command/receipt去重，unknown/running原阻断不改。真正来源/条件改变才有新身份；不加一次澄清付费，不靠反复模型补状态。
- 原episode重考candidate语义、source集合和reason保持，避免为已评估的旧episode重开候选；原有action能力/执行校验保持。

## 验证

最终聚焦35/35（34纯专项含2新用例、1真实PostgreSQL整链）通过，0skip；typecheck、精确Prettier/diff通过。纯测试覆盖next-step诚实分类、原action无next指针不得绕过、隐藏/缺来源/未满足条件/空条件不唤醒、同条件在改summary/CAS/时钟后同ID与consumed去重，原collector全部32既有专项保持。

真实PG18.4/55600：完整项目迁移→真实app身份/world初始化/epoch2→原npcAgentServices.sendMessageIfEnabled配合明确标注受控gateway产出计划→原状态与readPrivateAgentSnapshot→collector读出唯一action=null候选→原npcAgentAdvanceServices+真实Director snapshot/receipt/kernel提交一次本人重考→再advance无额外NPC调用；跨owner拒绝。最后goals仍active、resultIds为空、actions为空，未冒充备料/核对实际执行成功。gateway是本地显式假模型，只用于可复现接线验证，不是商业模型验收。

## 限制与接续

0商业模型/生产数据/部署。当前旧空triggers计划仍未就绪；需要root在同次NPC协议中让明确承诺给出真实能力action或有来源的等待/重考条件，能力缺失写missingConditions，后续真实相关输入可补全，不能替旧计划补“马上”时钟。本纯分类没有新增持久化字段或UI解释面板，不宣称所有等待已可视化。root负责公共NPC协议、完整check/build、生产迁移状态核验/部署READY及另授权真实模型旅程。没有真实模型证据，不能把138缺口整体标通过；渣男体验是否发布与玩家存档迁移仅由用户与root授权处理，本任务未操作。

root集成收口：ad547b04取为d9fd063f，配合139公共NPC协议v17与代码planNextSteps，check3299/build及Director PG19通过。业务a42484de / dpl_BhJrnRjsvwt8YKe4vyqngBzBP4PW正式Nu精确READY；生产91checksum只读一致，原合成试演读取保存内容与暂停正确。该限定代码交付完成，真实模型新复验待单独授权，旧空计划不会被自动补造。
