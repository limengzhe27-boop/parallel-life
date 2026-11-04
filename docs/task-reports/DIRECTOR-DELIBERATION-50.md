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
- **纠正归因**：原档16:04 grok4.7评估已69秒后committed quiet；汇总TIMEOUT属于另一世界4953，不属于此原档。原档16:10真实失败是遗漏机械openingContext:null。该对照阶段导演和NPC均grok4.3，不保留4.7；最新本地模型分工见下方续验。
- 16:44 v40正确defer两项出租屋后段，仍无新来信。
- 16:55 v41实际已获得13项窗口，仍对所有节点输出“无新玩家回应或到达证据”，没有安排；不能称成功。v42明确导演主动发起职责、作者入口本身的授权以及等待的作用范围，不强制选择/发言。后续正常周期实际结果继续核验。

## 验证、运行与待办

- 早期check4247/4247、boundaries/typecheck、isolated build通过；最终门禁见下方续验。
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


## 续验收口：实际无候选和重复处理的代码错误

root继续独占集成。已退出的proactive43不再修改文件。以下均为共享领域/仓储/应用实现，本地worker只是启动入口。

### 修正1：获知背景被误认成已向玩家呈现

`actor-observation-candidate.ts` 的 `initialMessagePresentation` 曾把 `authored_initial_context + received_opening_information + executionEvidence=false` 过滤为“已发过”。这些字段只证明人物收到作者背景，完全不证明玩家收到来信。删除这一推断；保留来源认证、本人范围、内容hash、真实消费证明及历史消息通知隔离。没有清空旧ACK或强制发送。

### 修正2：同一来源在收件箱与入口判定不一致

`actor-observation-inbox.ts` 只有scene/group历史时读取消费证明，漏了纯narrative。现在读取一次原narrative packet后，按同一认证消费记录过滤，后续复用packet。消费查询仅取实际supplied observations，不再搬运无意义记录；不加表列/cursor/新队列。

真实PG对照：恢复旧条件时，处理一个人物后pending仍为2；新代码为1。修正了测试的作者初始位置和原信息正文断言，没有通过重置消费历史让测试通过。原档六人分别读回真实ACK（舒雅婷2条，其余各1条），当前pendingNarrative均为0。这意味着原档旧开场已被评估，不能靠重新投递同份材料伪装新剧情。

### 修正3：全库输出控制与已知失败入口

原f2ff868b响应在逐节点输出中产生10个机会，被总数2上限拒收。v2全库现在使用`director-wire-v16`单一opportunities数组(maxItems=2)，无逐项重复defer和模型填写机会ID。未选节点由适配器机械标为本轮未选，不能当NPC拒绝或剧情结束。旧v1/v15受保护结果仍按原目录恢复。原档schema从20190降为18433字符，非token或回复提速结论。

一次显式已知失败修复得到4ec07052原始响应，两项作者机会，但`nudge:null`在v16早于既有空值转换被解析，导致invalid。离线同raw对照确认只此空值造成解码失败。现把既有nullable处理移到版本分流之前，不增加特例或业务默认；原paid raw不改。完整parse原响应已通过。其同时选择旧人物候选，超出原future-only无模型恢复范围，原恢复方法保守返回null，未丢弃部分决定强行提交。

进一步修正：显式v2作者修复沿原周期作者入口，传递认证retryCommandId；不再落入普通候选调度，把六人的独立自主机会再次交导演审批。quiet修复完成即返回，不额外购买无关NPC轮次。真实PG通过原`advanceIfEnabled`验证：v16、candidates=[]、同一source只有一个付费successor、重复请求不增加调用，原失败输入/响应hash与状态不变。

### 当前模型容量与真实结果边界

直接玩家回复仍grok4.3。人物后台自主决策通过既有schema.name标识复用配置的导演推理模型（本地gpt4.1），仍是本人私有上下文、同一NPC协议和单次调用；不增加导演审批或额外模型层。v95标记此行为，导演v45标记有界输出。

原档17:25导演曾真实派出两项作者任务，NPC原响应仍quiet。之后真实后台已产生多名NPC新消息，但有开场报告复述、普通情感小聊、继续等待，六人尚无新有效计划。消息数不作为剧情推进成果。主动进程已在诊断期间有序停止，避免长期购买相同空转；web/队列保留。最新修复后的有界原档结果继续记录，不能称主动推进通过。

### 最新门禁与未完成

- check4253/4253，边界/typecheck通过；隔离生产build通过。
- director-frame-lifecycle真实PG9/9，包含原服务显式重试、旧unknown隔离、付费结果恢复、失败当前视图排除。
- independent-opening-observation真实PG1/1与旧条件失败对照；通知回归16/16；v16/模型针对测试通过。
- 只运行本地3218，原档/原历史保留；未启动3219、未部署Vercel。Mac锁定，通知弹窗尚未目视验收。
- **未完成**：原档持续的有因果主动推进及真实下一步；作者后段前提只存在自然语言而prerequisites=[]的协议落差；已评估但未演机会如何在相关变化后安全续接；v2全范围unknown的后续策略；长周期人格与事件结果质量。既有保护和旧账不通过清零绕过。


## 最终共享运行层收口（继续验收中）

### 同一主动联系仅保留一个资格入口

原档林白语相邻两次actor_local原快照离线比较：没有新增外部observation，只是较旧记录从有界窗口移出，全量上下文身份仍改变，给重复小聊再买一次机会。原实现另有own_agenda_review同职责入口。现删除普通localInitiative收集、suppressLocalInitiative开关、无消费者的local-initiative-context.ts；删除仅服务已退休候选构造的quiet-context-review.test.ts。保留actor_local承接真实episode/条件的用途、初始定位、观察/计划/约定/结果来源；不删除旧记录。旧paid response_received恢复仍在候选收集前执行，unknown不重发。普通自主表达统一由已有own_agenda_review许可、周期、预算与回执维护。

既有unknown/partial/quiet/zero-send、双人物独立计划等不因删旧测试丢覆盖：真实PG own-agenda-runtime 8/8、window05 8/8（组合16含父项）。window05修正了将v2时间窗口grantId与原证据familyId混为一谈的断言；仍严格断言未知/无效结果不再购买原调用、partial不替代完整anchor、4200条取消历史不污染当前读取，未放宽生产规则。

### 人物本人工作不再反复送导演审批

原独立工作筛选只认wake:<candidateId>，把自主复盘自己的grantId当成共享资源；同时directorDue会使独立任务重新走总控审批。单人物调度fast path已经选中后，后续全局复盘又重复审批一次。现复用原agendaReviews认证许可识别本人围栏，仍只接受该许可+本candidate围栏，无共享资源且requiresCoordination=false、本人私聊；protected导演付费读帧/显式重试围栏不绕过。新作者机会先走既有入口，普通到期全局复盘不再否决本人合法工作；显式forceDirectorReview仍保留本义。真实PG将原导演复盘读取设为到期，确认两人物计划保存、无额外导演调用。

### NPC执行能力与玩家规则统一

原档有16地点，持久路线仅2条home↔park。玩家已有default_travel_v1十分钟产品移动规则，NPC快照、执行、认知投影、DBguard却只接受持久作者路线，导致多数真实在场人物完全没有travel.begin。现共享defaultTravelRoutes/resolveTravelRoute，增加可选本人起点参数，默认玩家调用保持原义；人物只从自己实际位置获取边界内路线，作者路线仍优先。快照只读派生，内核重验，投影认证相同路线，数据库0126核验完整默认路线、原起终点、同一FNV身份、固定政策时间及来源，原attempt/result/位置/权限守卫保留。无新表列，不写全连接路线图、不移动用户、不假造NPC到场。

真实PG travel-kernel 9/9：缺持久路线仍合法出发/真实到达，玩家位置不动、map.routes仍空；NPC到达park后下一条路线从park而非玩家room出发；伪造ID/时间/目的地/来源/额外属性均拒绝，重复请求不重跑，unknown不假造移动。修正旧夹具读取已被精简掉的state身份字段，以及scene打开自动seed presence后旧genesis初始化时机，未恢复生产冗余字段或放宽校验。

0126已仅应用本地clone；原档v958前后state hash与positions hash完全一致。只读原档六人均at、15条可行路线、travel.begin=true；六人当时仍goals/plans=0，不把能力恢复当成真实自主行动已发生。

### 原档演绎验收最新结果

显式已知失败修复后dfb9c258导演真实committed，dc9c9822李之之自主engage，提交新消息，v952。后续正常后台c1b306f7实际消费既有“参与但无下一步”候选；仍只说亲密话，changes=null、无计划。原候选优先级已用现有episodeId调整为50，高于普通可选联系30；没有制造新的任务或反复调用同候选。

这证明导演→本人→保存已能走通，但**仍未通过持续剧情/有效计划质量验收**。最新去重复审批、合并普通联系、恢复NPC实际移动能力之后继续正常有界原档验收，不清旧选择/账本，不手写消息，不重发unknown，不用另一个4953世界替代此原档证据。

最终本地门禁：check4247/4247、边界/typecheck、build通过（减少测试数来自退休普通联系机制及其专属旧测试，非删除仍在使用的安全断言）。own-agenda-runtime8、window05 8、travel-kernel9、director-frame9、independent-opening1均通过；通知16回归保留。当前3218 artifact build-director50-global，队列/主动worker使用共享最新源；health200只证明服务可用。正在原档正常有界后台验收；UI因Mac锁定仍未目视，整体不勾完成。

最后运行切换（覆盖上一阶段artifact说明）：最后两处独立工作审批修复已重新check4247/build验证，并切到3218 build-director50-current；四个核心源文件与artifact逐文件SHA相同，旧主动进程正常完成在途批次、确认stopped后新进程才启动，没有删除活锁或并跑两个调度。队列同批重启。新进程沿原存档正常资格验收，尚不以health200或消息数量结清主动剧情质量。

## v96：唤醒职责与compact格式分开

`systemFor`原wake判断依赖`!compact`，真正空状态人物会同时失去原planReview/agendaReview说明。现仅按input.origin选择这些已有说明，compact schema保持；未新增字段、调用或强制计划。模型63/63、check4248通过。

**归因限制与纠正**：对原档欣欣afdca822受保护快照，用v95/v96实际组包离线比较，原请求已有规划说明，两者schema均10458字符，messages34163/34155字符（非token/延迟测试）；因此不能用这个通用条件错误解释原档所有无计划。不得将本项修复声称为原档自主计划已通过。v96仅修复真实空状态分支，原档下一步质量仍待验收。

v96运行切换：3218当前使用build-director50-global（不覆盖正在运行的artifact），队列和有界主动worker均重启。此前e1df47b9已提交核心修复；v96空状态通用修复单独提交。check4248/build及63模型单测通过。完整体验仍保持未通过标记；不以新来信数量消除计划/事件进展缺口。
