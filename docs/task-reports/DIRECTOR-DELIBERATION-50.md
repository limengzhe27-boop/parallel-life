# DIRECTOR-DELIBERATION-50：从“无候选”追到导演可见范围与实际交接

root-director50 唯一集成；proactive43 负责独立领域/协议/真实PG测试。沿现有 Agent、调度、内核与付费回执链路修改，不建旁路。用户要求仅更新本地3218，不部署Vercel/3219。

## 原档与判断标准

原档 world `2fb97a4a-7282-4d75-8a5c-67faf44a3188`。只有原档产生新导演安排、本人自主决定、新消息/实际行动和可接续计划，才能称相应阶段通过。quiet提交、世界版本增加、worker循环、合成测试通过均不代表剧情推进。历史消息不当新通知。

## 已定位并修改的根因

1. **人物评估永久消费**：49已修原v1/v2周期许可及历史自身位置来源丢失，不重新购买unknown原调用；但原档v814—825十二次评估仍quiet，证明恢复候选不是完整解法。
2. **导演周期没有作者视野**：普通复盘evaluationCause为空，作者deliberationWindow强制空。已评估原稿又被付费上下文过滤，18个节点无法正常进入新的全局考虑。复用原周期新增periodic_review原因枚举与原资格形状，不新增表列/timer，不清空付费账本。
3. **两槽盲轮转**：原档当前13个eligible节点，固定每次两项，每5分钟一次，一圈至少7次/35分钟，常连续评估尚不能发生的后段。新周期使用现有窗口version2，一次提供全部合格未占用节点（上限32），导演同调用最多提出2项机会。旧version1严格按原两项范围验证与恢复。native/开场/定向语义唤醒保留原范围。
4. **机械输出冗余**：共享actor task/defer/schema定义；v2只要求本事件cast槽，其余非参与null由代码绑定，不补缺失的参与者任务；空任务、越人物、越来源、超过2个机会仍拒绝。原档13节点离线实际输出schema20190字符，保留24000上限。输入system5100/user58943字符为v41预检，非token/速度成绩；v42职责说明另有少量调整。
5. **历史小聊被误当当前责任**：普通历史open question不再在空闲全局评估中表现为全局等待；正式等待责任、关联问题、当前真实focus仍保留。原始问题/决定/历史不删除。无等待责任的旧闲聊不能消费新事项资格。
6. **当前/历史混用**：导演当前工作复用currentActorWorkState，保留有效选择和责任；历史quiet参与不冒充当前任务。无关历史speech/belief/plan不挤入本次全局作者评估，真实结果与全局执行状态保留；受保护原快照和来源编号不变。
7. **新wire的旧消费者**：开场接续从原raw wire.mode读取，但v15已无该字段。改读认证后的director_decisions.mode，减少读取整份raw，不增状态源。
8. **固定null造成整轮失效**：无opening authority时不再让模型填写openingContext:null，v15解码仅绑定此机械空值；有authority仍严格必填，缺业务决定仍无效。
9. **已知quiet恢复**：复用原handoff revalidation，完整已保存且无任何副作用的quiet可结清，不再额外购买。0125仅将原proof表opportunity_ids长度约束1—2改为0—2，无新增表列/授权。原档bd97…于16:44从invalid_output恢复committed，原sent_at16:10:39、原输入hash/响应hash、原version854保留，应用proof版本887、opportunity_ids=[]；未产生episode或消息。
10. **恢复时间误当评估时间**：周期从不可变sent_at/created_at计算；updated_at只是恢复时间，不能重新算5分钟等待。
11. **旧unknown影响无关事项**：仅隔离同epoch、已过租约、无raw的旧两槽周期评估与新不相交资格；锁内fence旧调用。live/raw/native/相同scope不绕过，不把unknown自动重试。v2全范围unknown不能冒充另一个不相交两槽；一般unknown保护保留。

## 原档真实证据与纠正

- v94人物评估没有新消息/计划；完整保留。
- node_1最近原始defer与当前人物definition相同，不能以早期错配为由清账本。青青尚未真正收到本次假扮男友邀请任务。
- 15:03旧导演再次给舒雅婷派工作/报酬/近况重复确认，引用不证明新进展；人物quiet并非运行时吞消息。
- 15:33—16:10多个真实导演评估仍quiet；一次consider却actorTasks全null已按真实任务约束修复，旧响应不伪造任务。
- **纠正归因**：原档16:04 grok4.7评估已69秒后committed quiet；汇总TIMEOUT属于另一世界4953，不属于此原档。原档16:10真实失败是遗漏机械openingContext:null。当前本地导演和NPC均grok4.3，不保留4.7。
- 16:44 v40正确defer两项出租屋后段，仍无新来信。
- 16:55 v41实际已获得13项窗口，仍对所有节点输出“无新玩家回应或到达证据”，没有安排；不能称成功。v42明确导演主动发起职责、作者入口本身的授权以及等待的作用范围，不强制选择/发言。后续正常周期实际结果继续核验。

## 验证、运行与待办

- 最新check4247/4247、boundaries/typecheck、isolated build通过。
- 独立v2范围/协议17/17；隔离真实PG lifecycle7/7，包含旧v1 unknown、完整v2提交、重复请求不再调用、最大2机会、缺参与者/越cast拒绝。无原档测试写入，无商业模型。
- 原档0125本地应用，应用前后world v887及state hash相同；约束读回0—2。旧完整quiet实际无新增模型恢复已确认。
- 本地当前3218、队列、主动worker使用最终构建/共享源码；仅本地clone库。原稿、位置、玩家决定、约定、原消息均未人工修改或插入。
- Mac锁定，通知弹窗尚未目视验收；后台真实结果不替代页面验收。
- **仍未完成**：原档持续主动来信与后续计划；导演仍错误等玩家时的语义表现；作者原文中后段前提未结构化（prerequisites=[]不等于文字前提满足）；长期人格、合理结果收束；v2全范围unknown的后续安全处理及大于32/超schema预算的内容分批策略。不以字段删除或门禁数量掩盖这些问题。

## 当前待办读者一致性收口

独立核对原始coordination正文后纠正：四条旧proposed不是零调用，分别由旧输入正文关联到两条stale_discarded已发送无raw、两条invalid_output已付费raw；执行器统一判paid_terminal、eligible=[]，导演此前仍当proposed当前事项。四条都是emergent，不能用作者cast过滤器处理，更不能按标题人名删除。

共享 `episode-pending-work-repository.ts` 复用episodeDispatchAttempt/episodeRequestWorkState/hasHandoffFollowup；只有proposed、各人物请求均pending且paid_terminal、没有事件/呈现/结果/后续才从当前视图排除。缺state、任一仍可执行/在途/已消费/已有事件或后续均保守保留。历史、原响应和恢复入口不变。定向读取只返回候选请求的相关attempt（含旧coordination的原receipt.id）；SQL文本预筛不授予权限，仍经原精确解析器。

原档只读实测排出26d10/3d305/85e8/8c840四条，查询返回8行；导演当前episodes从6条变为2条真实active。无数据写入。新增fixture最初按数组首位配人物，在随机UUID排序下暴露cast错误，已改为严格沿material.participantRefs绑定，不放宽校验。

最新check4250/4250（768模块）、真实PG director-frame-lifecycle8/8、读者单测3/3、受影响模型62/62、build通过。本地构建 `.local/build-director50-current`。agent模型容量中断后root接管并完成helper定向查询、接线和最终PG；未覆盖其他文件。

原导演mini模型在17:06对照仍全defer（但逐节点理由不同），因此模型配置不是唯一根因。v43进一步明确现有字段的含义：episode.active只是人物承接，sourceEventIds可能只证明发言/考虑；作者原稿并非已经发出的邀约。当前本地NPC保持grok4.3，导演恢复原gpt4.1-mini比较修正后输入；不新增模型层/自动fallback。原档纠正后的实际交接继续核验，未宣称新来信通过。
