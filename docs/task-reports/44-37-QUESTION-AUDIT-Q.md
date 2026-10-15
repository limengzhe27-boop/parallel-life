# 44-37-QUESTION-AUDIT-Q：原生群聊待答问题与责任生命周期审查

状态：待验收（审查交付，修复尚未实现）。负责人 `codex-ma-arch44-37-question-audit-q-20261015`，root 唯一公共协议/源码/SQL/集成/部署负责人。

独立树 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，分支 `codex/ma-arch44-37-question-audit-q`，基线 root `fe7e9432`。按主表短锁登记。本次只提交本报告，source/public/SQL/CI/现有测试均未修改。复现脚本位于被忽略的 `.local/question-audit.test.ts`，不形成新测试入口或另一运行时。

## 结论

1. **已真实复现：B普通插话会遮蔽A未答问题，玩家短答的任务直接失败。** A的状态尚在，并非数据库删掉；错误在于路由只检查最后一条NPC消息。应优先修复。
2. **已真实复现：同线程任意玩家输入后，内核无条件清空旧问题标记；跨私聊/群聊新问题会覆盖旧问题。** focus表示当前焦点，不能兼任所有未答问题的生命周期。
3. **普通问题没有自动进入responsibilities。** 不能说现有责任收件箱已经兜底。群聊责任路由还只匹配matter，普通request和appointment不在该兜底中。
4. **受控错误模型输出能把无关聊天误记为旧请求的accepted，但没有结清赴约责任。** 当前原文引用校验不足以证明答复语义归属；真实履约结果守卫仍有效，不应删掉。

## 实际入口与根因

|位置|行为与影响|
|---|---|
|`src/server/npc-agent-channel-services.ts:179–199`|群聊先选最后一条NPC消息，再只读取该事件`data.agentRuntime.stateAfter.focus`。B普通消息成为latest时，A旧问题不参与问题人选择。|
|同文件`:158`、`:278`|`questionActorIds`初始为`[]`，实际始终传入nativeResponder；函数里的`questionActorIds ?? states.filter(...)`不会回退到state搜索，空数组已经确定覆盖。即使改成state回退，questionMessageIds目前也只有latest，仍会排除A。|
|同文件`:202–234`|现场有类似latest筛选，但本次没有构造真实现场复现，只记录同构代码风险，不宣称已验证现场失败。|
|同文件`:59–86`|明确@唯一人物优先；问题人唯一才接；责任只取同relatedMatterIds的非终态matter；群聊relatedMatterIds当前为空。多人物最终抛`DIRECTOR_COORDINATION_REQUIRED`，并不实际自动调用导演。|
|`src/modules/world/infrastructure/npc-agent-kernel.ts:292–318`|只保留本轮最后一个`requestsPlayerReply`；任何同渠道同thread的player输入都会把旧questionSourceId清空，没有“确实已回答”语义判断；新问题又直接替换整个focus。|
|`src/modules/world/domain/agent-runtime.ts:105–144`|ActorAgentState仅一个focus。AgentStatement可标requestsPlayerReply；没有独立Question条目、answered证据或跨线程未答集合。|
|`src/modules/world/domain/agent-kernel.ts:374–391`|decision验证当前player source、连续原文quote、存在的responsibilityId、不可改旧记录和一轮不重复；不验证当前话确实针对该请求。|
|同文件`:499–510`|fulfilled仍必须有真实succeeded action result且handledResponsibilityIds包含本人责任；聊天和接受提议不能替代执行结果。|
|`src/modules/world/infrastructure/agent-source-resolver.ts:14–27`|已有焦点来源可按private_strategy授权恢复；未来Question来源应复用此隔离机制，不能为了路由把私聊全文塞入群聊。|

## 真实 PostgreSQL 复现

自有PostgreSQL18.4，专属55565。复用现`agent-phone-entry.test.ts`的真实react-server HTTP/服务组装夹具，复制到忽略目录并只加本次审查断言。原群事件全部通过实际GroupRepository.create/send、实际`POST /api/v1/tasks/:id/run`、真实worker lease、nativeNpcTaskHandler、NpcAgentModel、NpcAgentKernel、事件/回执/投影事务生成。私聊走实际`svc.npcAgents.sendMessageIfEnabled`。没有伪造group事件、直接UPDATE actor state或把内存列表当Repository。

所有网关fetch被拦截且禁止网络转发，返回明确合成raw JSON；真实模型调用为0。此证据证明程序如何处理给定输出，不证明真实模型必然犯同样的语义错误。epoch2初始NPC状态按既有可信初始化函数建立，模型不直接写数据库。

执行：`node --conditions=react-server --experimental-strip-types --test .local/question-audit.test.ts`。最终11/11断言节点通过，0skip；其中包含原10节点和新增一组审查断言。通过表示**成功验证缺陷存在**，不是修复通过。日志 `/tmp/44-37-final.log`。

最终合成世界 `cee0e2a0-b810-4b2c-902a-03685eab5e98`；群 `82672691-5f33-4c48-ac3d-26df52fc11ed`；A=`79e477b7-2b7e-43d4-8983-4b2f57885b47`，B=`9ce967b6-2b41-4186-9004-db4a0d17cacb`。

|步骤|真实保存/返回|
|---|---|
|玩家@A，A输出“Can you make dinner?”并标requestsPlayerReply|任务`b5e85567-90ee-49cc-bd0c-a47369f9067a`成功，focus问题=`group:921b29e8-4cd8-86ad-815b-31a87347cd25`；responsibilities为空。|
|玩家@B，B输出普通天气插话|任务`ed5b4f8c-e5bb-429a-b98a-044a84fb4965`成功；A状态前后严格一致，旧问题仍未答。|
|玩家短答“OK”|任务`775373f7-8990-411a-8db8-f8f96003d1c9`失败INVALID_COMMAND，实际日志detail为DIRECTOR_COORDINATION_REQUIRED；这一短答新增网关调用0，A状态仍不变。|
|玩家转而@A聊普通天气，A普通回答|成功；A focus.questionSourceId变null，问题未有答复判定就被清。|
|A私聊提出“Can you come tomorrow?”，随后A群聊问“Do you want coffee?”|两次均真实提交；private question `message:1af4255c-1ee7-4182-bc8d-2fab54cc65fa`被group question `group:4348776e-a972-8b6e-8044-cfab71677630`替换；responsibilities仍为空。历史事件保留原问题，但运行时没有独立未答条目。|
|模型明确提出waiting request `dinner_request`，随后玩家说“@A Yes, the weather is nice.”|受控raw输出把quote=`Yes`指向旧dinner_request accepted，实际保存decision `weather_as_acceptance`，responsibilityRevision=0；证明原话连续出现仍可能语义错归。责任本体仍waiting，未fulfilled。|
|再让受控raw把旧请求标fulfilled，引用不存在的bogus_result|任务`1fa092fc-cfc4-4e21-a56c-f46e59cc3a9d`实际INVALID_AI_OUTPUT；责任保持waiting。没有用任意聊天生成可信履约结果。|

SQL复核路径（仅在该本地合成库，由现有身份/RLS事务读取；不是生产写入脚本）：

```sql
-- $1=上面的合成worldId，$2=该世界ownerId；使用现有事务身份。
SELECT actor_id, revision, document->'focus' AS focus,
       document->'responsibilities' AS responsibilities,
       document->'decisions' AS decisions
FROM parallel_life.actor_agent_states WHERE world_id=$1 AND owner_id=$2;

-- 原始事件证明问题是真正投影后绑定，且私聊问题历史未被数据库删除。
SELECT id,version,payload->>'type' AS type,
       payload->'data'->'agentRuntime'->'proposal'->'statements' AS statements,
       payload->'data'->'agentRuntime'->'stateAfter'->'focus' AS focus
FROM parallel_life.world_events WHERE world_id=$1 AND owner_id=$2 ORDER BY version;

SELECT id,status,error_code FROM parallel_life.tasks
WHERE scope_id=$1 AND owner_id=$2 ORDER BY created_at,id;
```

原文输入可从`agent_input_receipts.document`和`world_group_messages`核对；原始模型输出在`agent_attempts.response`，attempt身份/epoch/revision及event_id为同表独立列，并绑定对应world_event。不要只看当前focus反推历史问题已经回答。

## 建议最小协议（尚未实施，等待root裁定）

**先在现ActorAgentState里增加独立questions集合，focus继续只表示当下注意力。** 不另建第二运行时。Question最少保存：服务器生成id、questionSourceId、owner actor、channel/thread、提问时worldVersion、当前question revision、open/answered/declined/deferred/withdrawn等状态、可选关联responsibilityId及其request revision、最后答复来源与逐字quote。问题消息ID必须内核在实际投影后绑定；模型不能编未来消息ID。一次多问不能只留下最后一项。

问题正文可按questionSourceId读取已授权原始消息；集合不复制完整私聊记录。新问题仅追加，普通插话、切换焦点、玩家无关消息不关闭旧问题。不从“聊过一轮”推导answered；无真实deadline不自动expire。旧状态缺questions兼容为空；不要从所有历史问号猜出一批未答问题。若做旧focus回填，只能沿已经有requestsPlayerReply的可信event与可访问投影建立候选，不能臆断历史回答结果。

**一次NPC调用同时输出普通对白和replyAssessments。** assessment应引用本次提供的、属于本人且可见的questionId/revision，inputSourceId必须本轮实际输入，quote必须当前玩家输入中的非空逐字片段，语义结果可为answers/declines/defers/unrelated/ambiguous。不强迫每条回复都变决定；歧义保持open。内核校验owner/world/channel/epoch/revision/原话和来源后在同一事务更新Question与原消息状态；回复证据留在不可变事件，可幂等恢复。模型语义判断仍有误判概率，增加字段不能声称确定性地证明语义；不要再仅凭一个“是”或一句含quote就关闭所有旧问题。

**答复与履约必须分离。** “我会去”可回答邀约问题并产生关联request revision上的accepted，但赴约责任继续waiting，直到可信执行/到场等结果按原守卫证实。问姓名等普通问题回答不需要伪造action result，不应塞进fulfilled责任来绕开当前执行结果守卫。responsibility decision若要消费旧请求，应额外绑定确实回应的question/request与修订、语义归属、原话；无关聊天不产生该决定。跨线程答复只在显式关联且授权足够时处理，不能私聊问过就让群成员看见其内容。

**常规链路不增加导演串行模型调用。** 服务端先按真实@/明确回复引用确定收件人；没有显式引用时查当前thread所有尚未关闭的Question、可见成员和实际来源，唯一提问人即可调用其原有NPC模型。B普通插话不移除A候选。该NPC在同一次调用判断当前短答是否针对问题，unrelated则保留。多个不同提问人且无足够引用时维持显式歧义/沿现协调入口，不使用数组第一个或任意最近人物兜底，也不增加所有普通聊天的导演前置调用。未知/失败恢复继续复用现attempt/raw response/command receipt。

## 改动面与迁移需求

root统一分配后最小需要：agent-runtime类型/初始化、agent-proposal-parser及模型协议、agent-kernel语义归属与状态增量、npc-agent-kernel真实消息绑定、agent-state-context复制与预算、source resolver/授权选择、群聊/现场nativeResponder候选收集、持久事件重放及专项实际入口测试。不能只改prompt或把latest向前多搜几条就当完成。

现72迁移的actor_agent_states.document是JSONB对象，关键校验只约束身份、revision、projectedWorldVersion，没有禁止questions新字段；**若采用上述现JSON集合方案，本次只读证据尚未发现必须新建表/迁移的理由**。但需要审计所有state复制、授权/遗忘裁剪、字节容量和旧事件回放，不能无界追加。若root选择独立query projection，届时才需要一项受owner/RLS保护的迁移、同事务投影和不可变事件来源约束；不得开旁路直接写问题表，也不扩大worker权限。77注意力迁移不是待答问题库，78开场时间迁移也不应塞入本协议。

后续验收至少包含：A问→B插话→短答仍由A处理；无关输入不关闭问题；私聊/群聊两个问题并存且不泄漏；多问题/多提问人歧义；回答不等于赴约；原话错误归属不得消费旧承诺；拒绝/延期/撤回真实来源；重试、并发revision、unknown与失败回放无重复；旧epoch兼容。此报告没有实现这些修复。

0真实模型、0生产、0公网/浏览器、0fullsuite/build。本轮仅审查报告，不冒充已修复上线；“渣男体验”原草稿未修改/发布。root决定协议后需另行登记实现范围，再统一check/build、部署READY及公网验收。

报告中的三条只读SQL已用本地pl_app与实际owner事务身份执行，分别读到2个NPC状态、16条世界事件、8条任务。自有PostgreSQL已正常停止，55565已核无监听，没有停止其他Agent服务。忽略目录复现脚本和本地记录保留供root核查。
