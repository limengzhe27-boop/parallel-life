# 44-160 · 失败分层诊断接线只读审查

2026-10-19，负责人codex-failure160-review。按用户新“优先修当前对话失败、再依证据简化协议”附件和root限定分工执行。独立author-eligibility63/人生剧本，codex/failure-diagnostic160-review自 **fe53bb9c5bebc2de952b96ad39b4ecb3a119caff**。唯一主表先短锁登记；独占本NEW报告/本人行/主镜像。其余parser/kernel/HTTP/协议/SQL/phone只读；0生产查询、0模型/写、0代码修改、0测试/全量/部署。

## 1. 最新基线与已有工作对照

root确认正式 **b52f5928 / dpl_82nQJ3n6WhQmNk7yenJgbZkXaT6x**；候选fe53bb9c / dpl_A2V9T5nFxgnDX2m9UsSx26nCmAAY已READY，尚未晋升。160 root独占公共集成/生产/真实模型/部署，第二隔离正常发布档真实零输入旅程进行。本文不借旧ee456cba目录部署。

| 类别 | 已核对事实 |
|---|---|
| 已有且通过限定验收 | 原服务绑定world/actor/channel/input/epoch/版本/lease，原compiler生成正式execution/plan ID；普通聊天允许空goal/plan/action；原失败动作结果可保留独立speech，成功台词仍依赖真实成功；原lookup只读恢复committed/failed/unconfirmed。154旧正式曾验证双人物开场和合法quiet。 |
| 已有待本轮真实验收/正式部署 | 160 v10 execution当前accepted-input机械归因、认证publication-genesis本人历史/初始facts及最终strategy来源、原Director未来安排整份readset重验/0096凭据、历史通知隔离。root报check3674/build、PG恢复18/交接来源3/通知29等，本包不重复执行。 |
| 存在但未集成 | N10纯分类源码55f19109（报告f22b916b+62ae56ae）仍在独立分支；本fe53树中不存在application/agent-rejection-classification.ts/test，且55f19109非HEAD ancestor，实际没有公共import接线。不得把12/12纯测当当前运行时诊断功能。 |
| 尚未实现/需另分期 | 跨原错误包装的安全诊断链、统一requestId、replyTargetRef代四元组、测量后轻输出、NPC paid raw一般读集rebase和更广部分成功。不能为这些后续重构阻塞本轮160已确认断点修复。 |
| 本包范围 | 只核失败丢失路径和N10接线点，给root原模块最小清单及反例；不重复新helper、不修改状态机/宽松内核、不追加付费调用。 |

## 2. 先按已有证据分开真实案例

只引用root已获授权的160报告/状态同步，不重新读取用户私密记录，不把静态推测当新生产复现。

| 已确认案例 | 阶段与真实状态 | 分类 / 对应修复 | 缺口与边界 |
|---|---|---|---|
| 用户5fe档首个bootstrap Director0042ef19，formal b52f5928，原Director wire-v8 | v0送出后玩家先提交v1/v2；已有protected raw含合法未来作者机会，但原attempt stale_discarded、未保存decision/派发 | 世界版本并发；160 known-only原整份安排readset重验+0096原子凭据 | 不是模型没构想，不需重买。旧snapshot/raw/hash/assessedVersion不改，不直接改expectedVersion。 |
| 同用户档第二Director681bd7b6 | v2已发送、unknown_after_send、无protected raw；原时点0 decisions/0 episode_requests | 上游/结果未知；保留未知，不新发相同请求 | 不能把之后NPC quiet当开场已完成。仅在已知原安排成功应用同事务按专用凭据隔离旧过期未知，不泛化所有unknown。 |
| 首个隔离523档，候选2eaf05e7，NPC wire-v9 | 已请求且保存raw；合法semantic basis漏本轮input锚，原检查拒NPC_EXECUTION_INTENT_SOURCE；原报告17文字、1 known invalid、无unknown，已暂停 | 机械执行归因；160 v10短ref精确解码后绑定原accepted_input | 这是原raw审计结论，不能由同名SOURCE错误一概推断合法。旧v1-v9失败按原契约保持。 |
| 发布人物历史缺失 | 初始publication-genesis来源没有对应world_events；原reader仅认genesis导致合法本人speech/facts未进入快照/最终source重验 | 上下文/合法来源恢复；认证binding+immutable初始数据+source.initialFacts helper | 不是允许跨人物隐私或信任来源前缀。历史恢复为认知，不重放新通知；该上下文bug不代表每次quiet都是故障。 |

每案尚缺的requestId/commandId完整关联、具体客户端提示与阶段耗时不能由本报告补造；root原账本/原protected记录仍为事实源。只有after commit的真实event/receipt能证明消息或行动已提交。当前第二真实档通过与否由root单独登记。

## 3. 实际错误丢失路径

### 3.1 parser：原始具体原因被coarse覆盖

`agent-proposal-parser.ts::parseAgentProposal`：

- JSON解析失败→AgentValidationError(RESPONSE_JSON)，输出超限→RESPONSE_LIMIT，仍可明确识别。
- decodeNpcWire/机械compile任何throw→统一RESPONSE_WIRE_SHAPE；包含真正无权source、悬空引用、局部ID、状态矛盾等多种根因，不能将此值全部归“格式”。
- 原schema失败→RESPONSE_SHAPE:<describeShapeIssues自由细节>。字段path/validator消息不适合作为外部或运营日志的任意文本。
- 原domain validateAgentProposal的固定reason通常仍保留，如UNKNOWN_GOAL、UNKNOWN_SOURCE、UNCONFIRMED_RESPONSIBILITY_RESULT。

`director-agent-model.ts::parseDirectorDecision`：JSON/decode/shape等通过invalid()统一为DirectorProposalError(code=INVALID_DIRECTOR_PROPOSAL)，没有分阶段reason。单靠该外层code无法确认协议、语义、source还是业务失败。

**建议保留原对外code及旧reason语义，增加内部有限diagnostic投影**（stage+允许列表code/reason），不改变旧paid raw或proposal解读，不把任意Error.message/cause序列化。解码函数已有稳定结构code的直接使用；只有message常量的裸Error应在所属adapter明确改为有限结构code，而不是从任意message正则猜原因。未知保持unclassified。

### 3.2 runner：状态正确保护，但状态不是根因

`runNpcAgent`仍是claim→发送前→decide→protected response→parse→commit：

- preflight snapshot失败可记录cancelled_before_send；发送前scope/CAS/预算等待另有原收尾。
- 上游明确拒绝/not_sent保存专用响应、mark invalid_output；其它请求异常保留unknown_after_send。不能由invalid_output反推出“模型语义错”。
- decode/domain拒绝会mark invalid_output；commit冲突可mark stale_discarded，存储故障保持response_received以便原raw恢复。
- replay只抛ATTEMPT_INVALID等coarse结果。agent_attempts原表无独立failure_reason/diagnostic阶段列；source/raw存在不能替代原错误记录。

建议在各原catch处产出安全阶段观测，但不要改变mark分支/覆盖原异常，不能因分类失败另造业务失败。无法写诊断或数据库不可读时，保留原错误和unclassified，不为填诊断付费调用或重放行动。欲长期持久化诊断需root独立决定是否新增表/迁移，本包不建议偷塞世界facts/state。

### 3.3 service：包装丢失原因及提示不一致

`npcAgentServices.sendMessageIfEnabled`：

- private identity已由服务绑定，不需模型重填。
- 原AgentValidationError(code=INVALID_AGENT_PROPOSAL,reason=具体值)最终变NpcMessageError(apiCode=INVALID_AI_OUTPUT)，具体reason丢失。NpcMessageError没有code、attemptId或有限diagnostic字段。
- 原编译器有些code=INVALID_PROPOSAL或NPC_EXECUTION_INTENT_*不在此已列分支；DomainError直接穿透，其他未知code落UNKNOWN503。不能把这种API映射差异当真实unknown或真正格式错。
- 已有old stale_discarded与invalid_output同组返回INVALID_AI_OUTPUT422；而只读lookup对stale_discarded返回VERSION_CONFLICT。这是**明确静态提示不一致**，不是本包新生产复现。

建议在包装前对原错误和已认证原attempt身份生成diagnostic；NpcMessageError可携带内部安全投影，或通过原observer关联上下文，不能只在HTTP最终拿已丢失的apiCode再猜。保持对外有界产品提示，不把原reason/raw给用户。stale与invalid应依据原durable状态一致映射，但不新增自动重试或改变原命令。

### 3.4 route/HTTP：漏日志、双requestId、自由文本外泄面

`world-message-http.ts::worldMessageRoute`捕获NpcMessageError后**直接return json**，因此绕过`http.endpoint`的catch日志。它给body.error.requestId另造UUID；外层endpoint又创建自己的UUID并给X-Request-Id，所以这条错误分支正文/头部两ID不一致，用户回报body ID不能直接关联endpoint元数据。

`http.ts::endpoint`仍：

- console.warn含自由 `errMessage:error.message`；与旁注“不记private/upstream内容”不一致。
- 将error.message前500字符编码放进 **X-Error-Message**。即使正文是固定提示，响应头也可能含校验/SQL/上游自由信息。
- 对通用503按status给retryable=true；它不是允许重新付费的可靠依据。原NpcMessageError已固定retryable=false，不能借诊断工作统一打开。

建议单一requestId由endpoint上下文提供给route，成功/失败响应头、body及日志共用；对被route处理的NpcMessageError也走原统一安全logger一次，避免漏记/重复日志；删除自由errMessage与X-Error-Message，只保留白名单分类、阶段、固定code、合法status/duration及经scope认证的关联身份。requestId不是授权信息，不能以传入客户端ID代替服务端关联真实性。

### 3.5 receipt/frontend：保留原命令查询，不将UI错误等同世界失败

`lookupMessage`按owner+原accepted inputHash/text/actor读取原attempt/event，明确返回failed/unconfirmed/committed；`reconcileRestoredSendReceipts`只读、按world/command/actor一致性更新本地pending，不授权重发。原known failed与unknown有区别。

`sendFailureStatus`按API code映射UI failed/unknown，BUSY也可显示failed；这不是durable attempt终态，不能拿UI状态决定换新command。没有回执不等于未提交，已提交回执丢失必须查询原请求，unknown不自动重买。后续诊断只用于解释，不绕过原receipt核对与恢复门槛。

## 4. N10复用与不能误用的地方

冻结源码 **55f19109bc7c4a9f85f8885c55f35ac8a75d50fe**，原12纯测；本包只用git show核源码，**未重复运行或声称已合入**。

API `classifyAgentRejection(error,audit?)`输出固定category/code/reason/basis/auditCase；无message/stack/cause读取、原数据回显、重试或权限决策。适合原catch在原因丢失前调用。

当前N10审计case只允许已确认**v6计划漏input**，不是本轮v9 execution错误；不得直接传v6 auditCase洗白v9错误。若要识别160经审计机械归因问题，应另加明确case+原artifact认证/反例，或者保持generic来源问题并在根因报告说明。仅存在SHA字符串不能由纯函数证明审计真实性，调用方必须先验证。

对来源字段/原schema动态细节，N10只回固定白名单reason或unclassified。对裸Error message不分类是正确保守行为，不因此扩大message收集。现有upstream_or_unknown类是诊断分组，不能据此覆盖modelRequestNotSent/modelRequestRejection、原status或退款/重试合同。

## 5. Root最小接线顺序与具体文件

| 顺序/文件 | 最小动作 | 保持不变/反例 |
|---|---|---|
| 1 原agent-proposal-parser.ts与所属NPC/Director adapter | 在decode/compile边界保存有限stage/code/reason；原外层错误语义兼容，未知unclassified | 原v1-v10 raw解读不变；错source/悬空goal仍拒；不用任意message恢复原因。 |
| 2 集成N10源码+纯tests（不是重复新helper） | 明确补160所需安全code/reason或审计case，仅有证据时扩目录 | 不把classifier变为permission/retry gate；没有artifact不标合法意图误拦。 |
| 3 原run-agent.ts（可选observer/metadata接点） | preflight/send/model/store/decode/commit分别有限阶段记录，使用已认证原attempt关联 | 同一raw不重买，诊断失败不吞原错、不改receipt/attempt状态/事务原子性。 |
| 4 原npc-agent-services.ts | 包装前捕获有限diagnostic，stale/invalid API解释与lookup一致 | 不自动改expectedV；response_received仍走原恢复，unknown仍保护；不能由通用INVALID_PROPOSAL误称传输unknown。 |
| 5 原http.ts/world-message-http.ts | 单一requestId、被route处理的错误也记一次安全元数据，去掉自由errMessage与X-Error-Message | body/header/log同ID；不记录secret/raw/访谈；产品提示不出现内部实现细节；retryable不增付费权限。 |
| 6 原receipt/query与phone（确需才改） | 只展有限可恢复提示；仍原command查询与幂等恢复 | committed回执丢失不再执行；pending/unknown不换command；真实failed不永转圈。 |

该工作可作为独立低风险诊断交付，不要求同批重写NPC schema或读集rebase。root本轮160已确认缺陷先完成真实验收/部署，诊断接线另行登记；本报告不擅自抢公共源。

## 6. 拟合并/删除校验逐项依据

| 校验 | 信任边界/时序 | 审查建议 |
|---|---|---|
| HTTP session/owner、数据库RLS | 外部入口与内部数据库访问分别保护，多条服务/worker入口 | 均保留，不用server已认证为由撤RLS。 |
| accept receipt/hash/actor/channel、claim版本/租约 | 输入不可变与执行身份建立，期间可并发写入 | 均保留；可缓存同一immutable receipt的纯解析，不缓存可变权限。 |
| snapshot可见source、发送前source/definition、commit source/state/CAS | 跨模型等待期间可遗忘/撤销/修改/移动 | 发送前保护费用，commit保护世界事实，两处不能合并成一次。 |
| 编译当前input ID、正式ID | 来自服务端唯一已认证输入，属于机械字段 | 复用已上线/160 v10绑定，减少模型抄字段，不补业务理由/承诺。 |
| playerReplyTargets四元组 | 已由当前同会话合法目标精确给定，原schema已有anyOf耦合 | 可另分replyTargetRef确定性展开，但语义relation/decision/quote及多渠道检查仍保留。当前不重写。 |
| 行动依赖、结果/责任完成、终态、循环 | 真正业务一致性和执行证据 | 必须保留。合法失败结果可按原kernel过滤依赖speech，不能丢非法动作后将余下全部标成功。 |

没有实测查询/模型耗时，**不认为相似校验就是主要延迟来源**；本报告未删任何检查，也不宣称错误率或性能提升。

## 7. 接线后建议验收（本包未执行）

- 原结构具体JSON/shape/source/goal/执行前提失败，以及完全未知错误：安全分类不同，未知unclassified，不输出秘密标记；新旧协议接受/拒绝结果保持。
- 真实not_sent、HTTP明确拒绝、unknown、protected raw未提交、commit冲突和已提交回执丢失：阶段/原status准确，不新增decide、付款或动作。
- 同一NpcMessageError的body/header/log requestId一致，仅一份日志；无X-Error-Message及自由errMessage；代码字段和阶段只允许白名单。
- 服务stale与receipt VERSION_CONFLICT一致；invalid_output不能自动解释为AI理解错，真正无权来源/未确认结果仍拒。
- observer/日志抛错或DB暂不可用：不替换原业务错误/不回滚已提交消息/不释放unknown围栏。
- 原普通聊天、答旧问题/新请求/NPC拒绝/玩家拒绝暂缓、承诺+合法计划、工具来源/本人历史、并发/多渠道/旧raw恢复都沿原链验证。可控模型、PG、真实体验、正式公网分别记录。

本包结果：只读审查与明确接线清单完成，主表待root验收；没有代码/技术门禁/正式部署/真实体验通过等新增交付声明。用户要求先修真实报错再按证据简化，root仍按当前有界48文字/2隔离档账本进行160真实验收。本包不读取/挪用额度，不覆盖用户存档，后续由root统一check/build/PG、READY及公网验证后逐项交付。
