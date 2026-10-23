# 44-201-PLAN-REVIEW

只读基线3c7d14b2；无模型/生产写入，无公共源码改动。

## 实际链路

- agent-schedule-collectors.ts collect plan路径携带planReview.planId/goalId（有结果时result），无下一动作/触发条件的active/waiting/blocked计划可按原复查表进入窗口。
- npc-agent-advance-services.ts execute把planReview放进服务器wake输入，提前schedule原复查表。
- npc-agent-model.ts将wake JSON来源映射后直接传入input.text；SYSTEM解释planReview是本轮复盘对象。actor viewState包含原计划，response schema已有update/replace/close并枚举合法planId。
- wireCatalog只缩写sources，没有专门计划别名；模型必须选update并抄原planId。create一直可选。
- compileNpcPlanIntents对create省略goal自动生成新goal；ID依赖本轮input.sourceId和ref，因此不同wake即使相同意图也成为新对象。编译器完全不读取planReview。复查上下文与默认创建规则没有接通。

## 最小简化建议

仅对可信服务器wake、type=npc_own_condition_ready、source=actor_plan且合法planReview绑定成立的输入：create省略goal时复用被复查计划，走原update逻辑。显式goal:new或existing仍保持create，普通玩家和无planReview的议程保持现状。不新增字段，不按summary文本相似度，不偷偷将显式新目标改旧目标。

必须保留：

1. origin必须wake，不能只解析字符串；玩家粘贴相同JSON不生效。
2. planReview.planId/goalId与viewState中本人非终态计划及目标精确匹配。input身份由原accept/claim绑定，不信任模型返回的review。
3. 复用knownPlan(false)原有执行中/未完成action保护，不绕过未知动作或正在执行的计划。
4. 多个隐式create同时指向一个review目标仍走targets重复校验，不能last-wins。
5. 只绑定默认目标，不推断完成、玩家接受或期限；source验证和原后续条件仍保留。
6. ref是create机械编号；复用后不得让执行/continuation引用凭空生成的ID。现有planIntent编译输出无公开ref映射，仍需聚焦验证没有消费者依赖。
7. 无变化应允许changes=null，不要为每次复查强制update/追加source造成新进度。此绑定解决身份，不保证内容自然推进。

必要测试：可信review隐式create保留plan/goal数量；显式new另建；玩家伪造review不复用；目标不匹配不误写；未完成action保护；重复target拒绝。

## 本地实际证据边界

只读取.local/narrative200/middle.json，不输出人物原文。该快照90 attempts中可读snapshot含59个npc_own_condition_ready、12个npc_agenda_review、6玩家输入、7事件考虑；未找到带planReview的own_condition_ready样本。六个人物当时计划数为0/1/1/2/1/0，五个计划均waiting或blocked。

因此“planReview隐式create产生重复对象”是明确代码风险，但不能声称它就是本批实际重复等待的唯一根因。实际样本的actor_local/agenda_review重复联系仍需独立追踪；不应以此修复宣布长期演绎通过。

## 其他观察

现有update会把previous.sourceIds与本轮input来源合并；即使summary/条件不变也可能写新来源。应优先模型无变化返回空增量，若代码去无变化应严格比较实质字段，不删除真实的新证据。暂不建议新增“同题评分”、第二套计划状态或语义去重服务。

## 样本路径复核与限定

middle.mjs查询确实只选actor_id/expected_world_version/response；但response是run-agent.ts saveResponse写入的npc_agent_completion封套，含snapshot及模型response。本次实际读取路径是attempt.response.snapshot.input.text，不是模型response本身，也不是由缺字段推断无planReview。90条中84条存在snapshot；其中59条own_condition_ready全部source=actor_local、无planReview。其余6条无snapshot封套不作输入结论。

查询为created_at升序前90条非空response，不代表最新90条或全历史；原报告的“当时”不能延伸为当前线上不存在planReview。全历史真实输入应按agent_attempts.input_receipt_id关联agent_input_receipts.id读取document，并核对world_id/owner_id。保存封套证据只能解释所选已保存响应，未知请求需看原输入回执，不能用response缺失作结论。
