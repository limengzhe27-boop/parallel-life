# ACTOR-QUIET-DIAGNOSIS-40：原档事件交接后为何仍然安静

2026-11-03；独立诊断 `astra-quiet-diagnosis40-20261103`；代码基线 `98c89d7a3bf99daa1bd5410dcaf05fc086905ba9`。

## 1. 结论先行

**这次不是“人物收到一个有新进展的事件，却无法形成意图”，而是导演再次派出已经反复问过的旧议题，人物明确选择不重复表达。** 与此同时，旧“等待玩家”责任确有问话关联断点；最新精简又漏迁了导演的参与回执读取。三者应分别处理，不能用强制发言或多调几次模型掩盖。

1. **直接证据：**导演原响应承认“已有等待玩家回应的工作安排确认请求”，却以“基于此实际等待继续发起相关确认互动机会”为由再次派发；机会唯一依据是旧导演决定，而非新的玩家答复、执行结果或安排变化。
2. **历史连续性缺口：**首次接洽确实产生过 `engage` 和消息，但自动生成的等待责任没有与同轮问题关联。当前没有责任决定、条件或下一步计划；问题回答和业务责任无法沿这一关联自然接回。
3. **最新精简的新增读消费者缺口：**人物提交已删除持久 JSON 中的参与历史；NPC 读取会从认证回执补回，导演读取没有补回。此缺口会影响后续导演，但不能倒推为本次旧机会的原因：本次导演保存的快照仍有11条舒雅婷历史参与。
4. **排除：**本轮不是 parser 把有动作的响应变成 quiet，不是裁剪删除了已有计划，不是三个新事件全被拒绝，也没有证据证明玩家已接受该活动。

## 2. 范围和取证方式

- 核对 [37最新交付记录](<ARCHITECTURE-SIMPLIFY-37.md#L104-L133>)，追原世界 `2fb97a4a-7282-4d75-8a5c-67faf44a3188` 的既有调用。
- 仅连接已经运行的本地克隆库，URL 代码检查限制为 loopback；使用 `BEGIN ... READ ONLY`、限定原 owner/world 查询、事务回滚；已读回 `transaction_read_only=on`。没有连接生产。
- 读取原 attempt 的受保护 response/snapshot、导演原输出及决定、真实事件回执、早期消息和当前人物状态。只在忽略目录保存必要本地证据，不把整段人物私聊复制进本报告。
- 本轮0新增模型调用、0业务/存档修改、0服务启动或重启、0部署；只写本报告、本人主表行及忽略的诊断脚本/证据。
- 113项聚焦离线测试通过；另执行原响应纯解析和问题关联对照探针。没有全量 check/build、真实写库集成或自然演绎验收。

## 3. 最近三次调用到底是什么

真实时间为2026-11-03 10:09:47Z至10:10:07Z，分别保存为世界v484–v486；原 [advance记录](<../../.local/audit36/real-advance39.log#L1-L39>)与本轮只读查询一致。

|人物 / attempt前缀|实际触发|原始模型结果|可确认的解释|
|---|---|---|---|
|舒雅婷 / `2a2aa5ae`|`npc_episode_consideration`，请求 `5d4773…`|显式 `consideration.choice=quiet`；依据 `source:44`；`planIntents=[]`、`statements=[]`、`executions=null`|确实考虑了一个机会；没有产生可供运行时保存的发言或动作|
|李之之 / `45f8f7e8`|`npc_own_condition_ready`，`actor_local`|`changes=null`、`statements=[]`、`executions=null`|自主联系机会，不是另一个新剧情事件；没有结构化quiet理由|
|刘胜男 / `52a2fb12`|`npc_agenda_review`|同上|议程复盘，不是另一个新剧情事件；没有结构化quiet理由|

因此“3次全部quiet”可以作为无可见输出的概括，但不能推成“3个人分别拿到新事件都不愿参与”。后两人的内在判断原因没有保存，不能从空数组补造。

### 输入与输出没有发生什么

舒雅婷的原受保护快照中本来就是0目标、0计划、0动作、0玩家决定，以及1条等待责任；原响应本来就没有计划。当前工作视图保留非终态责任和未答问题：[筛选规则](<../../src/modules/world/application/agent-state-context.ts#L300-L407>)。本轮协调请求明确不走 compact：[compact判定](<../../src/modules/world/infrastructure/npc-agent-model.ts#L248-L255>)。`planNextSteps`只是现有计划的投影，不替责任发明下一步：[组包](<../../src/modules/world/infrastructure/npc-agent-model.ts#L504-L511>)。

v19必须输出事件选择；缺失会拒绝，不会默认为quiet：[绑定校验](<../../src/modules/world/infrastructure/npc-model-protocol.ts#L1670-L1699>)。本次原响应明确引用的 `source:44`，按稳定来源目录对应当前导演建议；真实回执也保留该机会来源。

**精度限制：**本轮用保存快照和当前真实组包代码离线重建了3份请求，但重建的 `modelInputHash` 均未与原保存hash一致。没有完整原始HTTP messages封包可逐字比对，故不把重建件称为原请求字节复刻，也不以重建字符量承诺token、延迟或完整逐字还原。根因判断主要由原响应、原决定、原快照和提交事件相互印证。

## 4. 直接原因：导演把旧等待当成再次派发的依据

### 4.1 这次机会没有新进展

舒雅婷实际得到的建议是：

> topic：确认之前安排的活动委托和报酬详情。  
> personalObjective：确保活动顺利执行，了解玩家近期状态及时间安排。  
> proposedInteraction：主动联系玩家，发起关于活动和状态的交流邀请。

见[原人物快照中的机会](<../../.local/audit36/response39.json#L1059-L1062>)。这是一份未来互动建议，不是刚发生的事件、玩家同意或新执行结果。

本轮定向读取舒雅婷共15条事件请求，其中14条围绕确认活动、报酬及近况，另1条是其他工作危机；合计11条quiet、1条engage、3条仍pending。不能把所有pending当可重买：旧付费围栏保持。

早在v64、v80、v145、v199、v231、v265的参与记录，人物已经多次解释：安排问过、细节说过、尚未得到答复，再问属于重复确认。详见[旧参与理由](<../../.local/audit36/response39.json#L162-L247>)。本轮quiet理由虽泛化，但它不是没有历史依据的突然静默。

### 4.2 原导演输出已直接说明错误判断

该请求源自导演 attempt `2d3756db-5930-4285-8a80-8707e319e4c5`，真实创建于2026-11-03 09:52:41Z，输入世界v465。原audit原文：

> 当前舒雅婷已有等待玩家回应的工作安排确认请求，基于此实际等待继续发起相关确认互动机会，推动剧情发展和关系深化。无其它候选。

它的机会 `basisSourceIds` 只有旧导演决定 `a4dc85a1-…:decision`。**等待未变，被当成了继续催同一事项的理由；旧提议又成为新提议的来源。** 这与当前导演提示“同一请求无新依据时不能新建同主题机会重复确认”相反：[导演规则](<../../src/modules/world/infrastructure/director-agent-model.ts#L318-L334>)。

该次快照 `candidates=[]`、`deliberationWindow.nodeKeys=[]`，不是有一批新作者事件交给人物而遭集体拒绝。完整资格表中的 `eligible` 也不等于本轮窗口已授权重新审议，不能直接清空审议历史重开。

保存的导演快照仍包含11条舒雅婷旧参与、等待责任和旧问题，离线组包也保留这些信息。因此不能简单归为“本次完全没给导演历史”。原audit还明确承认等待存在；问题是如何使用它。

### 4.3 原身份被编译成另一个新机会

原导演响应把机会 `id` 填成了既有active事件 `director-opportunity:006d84…`，正文仍是同一确认活动。当前协议规定id仅在本轮唯一，解析器按 `[worldId,epoch,attempt.id,opportunity.id]` 重命名：[命名空间逻辑](<../../src/modules/world/infrastructure/director-agent-model.ts#L174-L218>)。

离线直接将原snapshot和原raw送进真实parser：

- 输出得到与真实保存完全相同的机会 `director-opportunity:078f5d…`，不是更新原事件；
- 仅更换模拟attempt id，同一raw和同一旧依据又被接受为另一机会id；
- 当前检查能验证人物、来源、作者资格和本轮唯一性，但没有将这类旧机会续接与新互动依据区分开：[解析准入](<../../src/modules/world/infrastructure/director-agent-model.ts#L261-L292>)。

命名空间本身是必要的防模型ID碰撞措施，**不能直接删除它或把任意模型ID当更新权限**。真正缺口是：同一事项应沿原episode/责任续接，没有新依据时不能靠新attempt身份再派一遍。也不宜按标题关键词相同一律去重，合理的后续沟通仍需保留。

## 5. 独立连续性断点：等待责任和提问没有连起来

### 5.1 找到了最初断点，不是只看当前猜测

首次实际engage保存于v63，对应旧attempt `e3c51455-ad91-4cb1-80c5-f84183d863f8`，协议v15。原raw同时包含：

- 一条活动安排问话，`requestsPlayerReply=true`；
- `questionForResponsibilityId=null`；
- `consideration.choice=engage`，`followUp.waitingOn=player`，缺项“玩家回复活动安排与近况”。

于是系统创建了 `episode_request:370b62…:followup` 等待责任，但问题没有指向它。最新原快照仍是：5条问题（4 open、1 answered）均无 `responsibilityId`；`focus.subjectId=null`；该责任 `nextCheck=[]`、`decisions=[]`。

代码延续了这种结构：consideration自动生成责任但不自动绑定statement：[自动责任](<../../src/modules/world/infrastructure/npc-model-protocol.ts#L1700-L1741>)；落库问题只有显式 `questionForResponsibilityId` 才存链接：[问题投影](<../../src/modules/world/infrastructure/npc-agent-kernel.ts#L1734-L1760>)。

### 5.2 当前入口的确不能从未关联问题记录责任决定

[reply target生成](<../../src/modules/world/domain/agent-input-interpretation.ts#L27-L85>)只允许问题已有的责任关联，或有证据的focus责任；[绑定校验](<../../src/modules/world/domain/agent-input-interpretation.ts#L111-L129>)拒绝在责任null的target上记录accepted/declined等决定。

本轮用真实快照、合成下一句“好，就这么办”做内存对照：

1. 原结构生成4个question-only targets，责任均为null；
2. 试图记录accepted被 `PLAYER_INPUT_INTERPRETATION_SCOPE` 拒绝；
3. 仅在内存给原问题补准确责任关联后，同一句accepted通过。

这证明连接缺失，不证明历史玩家曾答应。真实早期玩家说的是：**“你说的活动具体是什么？我先了解安排，还没有确定参加。”** 随后只是问对方在哪里、想当面聊，不能擅自改成接受活动。原责任也不能因为过了几天就自动完成。

责任自身调度要求检查条件、实际决定或约定依据；本例三者皆无，所以没有责任candidate：[条件及决定规则](<../../src/modules/world/application/agent-schedule-collectors.ts#L246-L257>)、[责任收集](<../../src/modules/world/application/agent-schedule-collectors.ts#L725-L783>)。生命周期是open却没有ready责任：[生命周期](<../../src/modules/world/domain/episode-participation-lifecycle.ts#L162-L200>)。这不是“永远无法唤醒”：自主复盘、其他观察和新事件仍可能触发，模型也可依法调整责任。但正常的“问→答→本人下一步”路径确实断开。

## 6. 精简遗漏：导演没有迁移参与回执消费者

- 人物合法提交删除持久 `episodeParticipations`：[删除处](<../../src/modules/world/domain/agent-kernel.ts#L811-L818>)。
- NPC的权威参与读取从真实request/receipt/attempt/event/command认证投影：[统一读取](<../../src/modules/world/infrastructure/episode-lifecycle-repository.ts#L13-L58>)。
- 导演仍直接读取人物持久document，没有调用该认证投影：[导演读取](<../../src/modules/world/infrastructure/director-snapshot-repository.ts#L887-L925>)，然后直接序列化：[导演组包](<../../src/modules/world/infrastructure/director-agent-model.ts#L724-L731>)。
- quiet消费请求但不会更新共享episode为某人的quiet理由：[提交分支](<../../src/modules/world/infrastructure/agent-narrative-repository.ts#L636-L700>)。所以仅保留shared episode不能替代个人回执。

本轮真实查询：舒雅婷当前人物document已无该字段，而认证关联记录有12条已消费参与。**后续导演的这份人物状态视图将缺失迁移前可见的个人参与选择和理由，现有读取没有以认证回执补回。** 应接现有权威回执读视图，而不是把副本写回人物JSON或建第二套状态账。

因果界限：本次v465导演快照仍带旧11条，故这个新增消费者缺口不是解释本次重复派发的充分原因；它是本次诊断顺带实证的后续回归风险。

## 7. quiet语义必须保留，但不能用它冒充演绎验收

显式quiet可合法消费“参与考虑请求”，不要求产出计划或消息；消费不代表活动完成。当前请求消费后不会自动重买；quiet也不承诺已安排条件重考。详见[消费和共享状态](<../../src/modules/world/infrastructure/agent-narrative-repository.ts#L636-L700>)与[后续brief保留范围](<../../src/modules/world/infrastructure/actor-episode-intent-repository.ts#L558-L567>)。

这不是要求每轮必须发言。对已有未答重复问题，quiet可能正是正确人物行为。应修复的是导演机会重复与业务接续断链，而不是禁止quiet、强制每次建plan或一轮接一轮付费寻找不同输出。

提示词还存在“某类私聊固定要求追加问题”与“不要重复未答问题”的张力，但当前资料不足以把它认定为本次quiet的直接原因，不以当前prompt倒推所有旧聊天。

## 8. 建议的最小修复顺序与验收

|顺序|处理|必须证明|
|---|---|---|
|1|导演按既有episode/责任/参与结果处理续接，区分原事项重考与真正新机会；旧导演提议本身不构成重复确认的新依据|同一原raw换attempt不会绕过事项准入；没有新依据不重复调用NPC；真实新信息、玩家重提、本人合理调整仍可继续；不靠标题关键词去重|
|2|完成followUp与同轮提问的来源绑定闭环；恢复旧档关联须有原响应/事件证据，不按文本相似度批量猜|明确答应/拒绝能绑定正确责任；询问详情、换话题、表情不被判同意；多个问题/责任不串线；答复后能进入本人下一步；流式与最终提交一致|
|3|导演接认证参与回执读视图，沿原权威来源、不写回冗余JSON|人物正常提交前后导演获得同一已授权choice/reason；quiet/decline/need_information语义不消失；关联范围有界；伪造回执不能混入|
|4|最后做有限真实自然演绎验收|使用原档、不复制不补台词；选择真正的新依据或原事项可行下一步，记录原输入→选择→行动/等待→真实结果；无可行进展则明确quiet及限制，不重复刷调用|

不要先重跑那条已经quiet的付费请求；不要清掉玩家未确定参加的语义；不要自动接受、手工补计划、把开放责任判完成。长历史决定超预算及其他精简项依旧属于37后续，本诊断没有顺带实现它们。

## 9. 验证证据与交接状态

- 既有8个聚焦测试文件合计 **113/113**，0失败；[本轮测试日志](<../../.local/quiet-diagnosis40-tests.log#L115-L122>)。
- 纯探针：原导演raw成功重现真实新机会ID；更换attempt仍形成另一ID；真实快照的无关联accepted拒绝/加明确关联通过；非终态责任没有被当前工作视图裁掉；当前持久状态无参与字段而认证回执存在。[探针](<../../.local/quiet-diagnosis40-probes.mjs>)、[结果](<../../.local/quiet-diagnosis40-probes.json>)。
- 原始记录查询：[三次调用及请求](<../../.local/quiet-diagnosis40-read.mjs>)、[原导演](<../../.local/quiet-diagnosis40-director.mjs>)、[最初责任与早期消息](<../../.local/quiet-diagnosis40-history.mjs>)。三者仅SELECT/事务设置，无业务写；原记录只保存在忽略目录。
- 源码全程保持基线；没有本轮业务修复、check/build、实库写验收或部署。因此本任务只交付诊断，不宣称37或原档主动演绎完成。

**交接：诊断证据已完成自审；实施建议待37唯一集成人采用。**
