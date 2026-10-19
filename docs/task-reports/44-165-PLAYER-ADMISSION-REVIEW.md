# 44-165 玩家私聊准入与选择版本审查

状态：只读设计完成，待负责人实施；没有改动源码、SQL、生产、模型或浏览器。工作树 unknown-isolation165；审查对象为 unified-engine137 当前实现。`44-164` 的 agent-runtime-repository / npc-agent-services 等公共源码仍归原负责人，不通过本报告转移归属。

## 结论

可以把“接收玩家文字”与“按世界快照执行变更”分开，但不能仅把接收处 `currentVersion === expectedVersion` 改为 `>=` 就宣布安全完成。文字准入本身无需锁住全世界版本；玩家答复所指向的问题、邀约及责任版本必须属于玩家发送时已经看到的范围。当前实现对后一层尚无完整界限。

建议两段实施：先允许无关世界变化下、目标人物状态未变的普通私聊；随后增加原客户端版本对应的可答复对象投影，才能完整接纳目标人物也已变化的陈旧文字。两段都保留原 command ID、客户端 expectedVersion、inputHash，不重写成最新版本，不重新付费生成。

## 真实调用链与已有保护

1. `npcAgentServices.sendMessageIfEnabled` 在收到 private/player 文字后构造 receipt：客户端 expectedVersion、commandId、text、inputHash，以及服务端 receivedAt/storyAt。
2. `acceptAgentInputInTransaction` 持世界行锁，先查同 command receipt。已存在则按 receiptBody 核对重放，不要求当前世界版本仍相同；新的 receipt 当前严格要求版本等值。
3. 服务重新 hydrate 当前世界、读取人物状态；新 attempt 绑定当前 world.version / actor.revision。接收 receipt 与执行 snapshot 本来就不是同一版本概念。
4. `claim` 已允许 receipt.expectedWorldVersion <= attempt.expectedWorldVersion，但严格要求 attempt 对应当前世界版本、人物revision、epoch、receipt hash及权限。
5. `NpcAgentKernel.commit` 再检原receipt/source匹配、当前人物状态、原snapshot及执行CAS，事务持久化。
6. `acceptedMessage` 的回查校验要求原 command.expectedVersion 等于原receipt.expectedWorldVersion。应保留这条不变；不能让服务端替换该字段。
7. SQL 0074 已有 `inputWorldVersion == receipt.expectedWorldVersion <= attempt.expected_world_version` 的投影约束，无需为了本方案移除或放宽它。

因此409发生在receipt/attempt均不存在的接收阶段时，确实是全世界版本过度耦合；不意味着执行CAS应放松。

## 当前语义缺口

`playerReplyTargets` 只按当前人物 state.questions / responsibilities / focus 和 authorizedSourceIds 选答复对象。`interpretCurrentPlayerInput` 与内核questionChanges授权也未用原inputWorldVersion过滤。输入自身的授权source已有worldVersion，但尚未用于这条边界。

反例：玩家看到版本10的“周六吃饭吗”，输入“好”；后台在版本11又问“借给我一万元好吗”。若仅放宽接收，最新context可把“好”绑定到版本11的新责任。逐字quote、同人物、同会话和合法source都成立，仍然是错误决定。责任变更也同理：旧“好”不能接受新金额、时间或参与方式。

不能使用文本关键词“好/同意”等判定是否安全；所有自然语言都可能包含选择。也不能删除新事实让NPC假装世界未变化；要限制的是该输入能够确认的对象，不是人物能知道的事实。

## 第一段：最小安全准入

接收陈旧版本时只放行同时满足以下条件的输入：

- origin=player，channel=private，recipientActorId非空，threadId严格等于recipientActorId。
- 所有权有效，世界未删除，目标actor在当前世界真实存在；future expectedVersion 一律拒绝。
- 当前epoch有效；wake / coordination / group / scene继续要求原版本等值。
- 读取同世界锁下目标 actor_agent_states，`projected_world_version <= input.expectedWorldVersion`。这证明人物当前问题/责任等状态自客户端版本后尚未变化。未知或缺失状态不默认通过。
- 执行snapshot组装时仍核对该界限；若接收后人物恰好变化，原receipt仍保留，不能用新问题解释旧输入。进入下述第二段的明确关联处理，或在尚未实现前以零模型的已知冲突处理；不能以后台重复模型掩盖。

这段允许其他NPC发消息、无关世界进展导致的旧版本输入继续，不保证目标NPC也有新消息时仍无冲突。它是明确范围的兼容改进，不应作为完整聊天体验完成声明。

不要把actor projected version当真正的用户已读证明：它只用于保守判定“发送时显示版本后目标人物未变化”。对于实际用户已读状态，现有UI版本仍只是保守上界。

## 第二段：完整的消息接收与答复范围

允许上述有效private/player文字在current>=clientVersion时保存，随后由原上下文组装创建有来源的 `playerReplyScope`（概念名，最终与现有协议合并，不另建引擎）：

- `observedWorldVersion`：原receipt.expectedWorldVersion，保持不可变。
- 可回答的question：本人当前同线程尚未结束，且问题正式消息/event版本 <= observedWorldVersion。
- 可决定的responsibility：必须在该版本已向玩家提出，且当时revision与当前待答revision相同。纯NPC私人目标、definition来源、当前focus不能独自证明“已向玩家提出”。
- 责任内容/时间/金额等改变后revision不同，旧输入不得接受新revision。若需要查看旧state，使用原world events的agentRuntime.stateAfter/已有权威投影按版本只读重建，不读取整世界私密资料给模型。
- 新问题、修改后的责任仍可出现在NPC最新context中，但不进入本轮related_reply schema允许目标；NPC可解释变化、澄清玩家意图或将本轮识别为new_request/topic_change/uncertain。
- 新玩家请求仍可使NPC提出本人的合法计划/行动；“不允许接受未见邀约”不等于“陈旧消息只能无效闲聊”。
- 无对应旧问题的自由输入，不凭空记为接受、拒绝或任务完成。明确提到某事也不绕过责任身份和revision。

范围应进入原受保护snapshot并有服务端证据，不接受模型自报；schema编译与内核执行必须共用同一选择范围，避免模型合法输出后保存时才突然拒绝。

已有AgentSource.worldVersion可以验证问题消息来源，但责任sourceIds里的definition或旧引用不一定等于该revision开始生效的版本，因此仅用“所有sourceVersion<=客户端版本”不够。旧责任revision的确证需要原持久事件或可靠投影。

原有replyAssessments、decisions与已付费旧协议还须保留版本语义：不能用新增过滤器重新解释历史已付费raw，也不能隐式补授权。新增snapshot范围应只用于新接收的新协议请求，旧请求仍走受保护原输入。

## pending choice 与普通文字

- 自由私聊：接收本条文字是新增事实，不直接等于执行其字面要求；可在当前状态处理。
- 用户点击明确邀约/事件选项：是特定对象与revision的命令，继续严格校验该对象版本，不能普遍套用旧世界版本放行。
- 私聊“好”：允许收进消息箱，但只有旧已见且未改版的目标可产生决定；未明确关联则不替用户选择。
- 同actor已有reserved/request_sent/response_received/unknown：本方案不取消原单actor执行边界，不重新发送未知调用。后续排队/接续属于原输入与任务机制，不把准入改动当成并发执行许可。
- 已付费响应晚到：仍按原snapshot CAS处理；本方案只改善付费前准入，不允许把旧响应套到新世界。

## 必要测试（聚焦，不新增大规模重复验证）

1. 原私聊command客户端v10，其他人物真实commit至v11：目标人物状态仍<=v10，原服务一次保存receipt并执行；receipt expectedVersion/inputHash保持v10，attempt执行版本v11，原query重放一致。
2. future版本、跨用户、缺失/删除actor、private空recipient或thread错配被拒绝；0模型。
3. wake/coordination/group/scene陈旧版本保持拒绝，不改变群成员接受时与执行时双重范围、现场在场证明。
4. 同command重放保留原receivedAt/storyAt/id；改文字/hash/expectedVersion/actor仍幂等冲突；重复HTTP不增加模型或正式消息。
5. 原input已接收后才有新NPC提交：执行claim/CAS仍防冲突，不以接收放宽跳过版本校验。
6. 目标NPC版本11新增问题，玩家基于v10发送“好”：允许文字接收（第二段），但schema与内核均不得绑定新问题/新责任；无玩家接受记录、无错误邀约执行。
7. 旧问题仍在且责任revision未变，可关联本次输入；旧责任修改后revision变更不可接受新条件。
8. 当前私聊输入可正常new_request、与旧问题无关不消费旧责任；人物可独立回应新请求。
9. unknown / response_received / 已付费invalid历史保持原raw与原身份，不自动重试；迟到结果仍由原CAS处置。
10. 164增量分段若已启用：receipt原版本、attempt执行版本、segment帧和正式commit版本分别保留；同attempt推进版本不得用客户端旧版本覆盖。

保留并适量复用现有tests/integration/agent-runtime.test.ts的 immutable replay、actor CAS、group/scene authority与late response保护，以及npc-native-service与chat-latency测试。真实验收必须通过正常浏览器发送与并发主动来信场景，不以手动改expectedVersion后的成功重试代替。

## 交接

当前仅完成分析。root可先交付165主动调度与减少无效扫库；此项交给164实际公共文件负责人协调实施。未联系上负责人时不抢改文件，不将这份报告标为聊天功能已完成。
