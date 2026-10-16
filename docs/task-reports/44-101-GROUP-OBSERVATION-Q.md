# 44-101 真实群观察来源适配

负责人codex-ma44-101-group-q，辅助线程01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b。root指定并在主表预登记后，本人按主目录短锁确认进行中及准确范围。最终独占group-observation101-final/codex/group-observation101-final，基线a242c31d0aee46884d3126f3c4696672a45a5ef2。状态：待验收，公共102接线与部署由唯一集成人负责。

## 文件与接口

仅新增src/modules/world/infrastructure/actor-group-observation-sources.ts、tests/integration/actor-group-observation-sources.test.ts及本报告；主表只更新本人行和报告镜像。97/99已交付源码保持冻结，公共类型/SQL/inbox/model/kernel/部署不修改。不合入21fad360的内存仓储或字符串ACK。

接口readActorGroupObservationSourcesInTransaction(sql,owner,frame)；frame为worldId/actorId/engineEpoch/worldVersion/storyAt/groupId（必填），可选sourceIds、consumedSources:{sourceId,contentHash}[]、maxBytes、maxEntries。返回sources:AgentSource[]、observations:AgentSnapshot['observations']、omittedSourceIds、groupIds、status。来源沿用group:<messageId>、kind=group_message、recordId=messageId；usage由root根据原目的渠道设置。

## 已实现能力

- 精确核owner/world/actor/当前epoch与版本；读取原group.created及每个相关membership真实成功producer，准确核participant、sourceEventId、sourceVersion、joinedVersion及原leave事件，不能把任意成功消息当入群许可。
- 使用原canReadGroupMessage与真实历史区间核当时读者、发送人；后来入群不补旧，离群保留当时真正收到的历史，重入不补离群空档。历史适配不使用仅服务当前群上下文的current roster函数，不以群成员关系生成物理在场或地图知情。
- 原player producer须text与messageId（缺省event.id）精确匹配；NPC producer须唯一reply actor/text/messageId绑定。native还核原实际committed attempt与runtime本人身份。消息行id/source字段也与真实表列及事件核对；当前原writer只支持文本，不把伪media引用当图片。
- 玩家文本保持speech/player_report，NPC文本保持speech/actor_report，没有升级真位置或整体事件结果。eventOccurredAt、原storyAt/learnedAt和当前retrievedAt分开，检索旧消息不变成刚发生。
- source.contentHash绑定完整消息、原事件身份和准确原听见/发送人的稳定入群证明，不含当前世界版本/轮询时间/后来leftVersion；后来离群不会重写历史hash。
- 先认证及forget过滤，再按精确sourceId+canonical hash排除已消费，最后预算；sourceIds可作准确溯源，不旁带兄弟消息。默认16000字节/80项，全文不截断、超额明确omitted，超大条目不阻断较早可容纳条目。非授权/被遗忘项不泄漏在omitted里。
- 默认pending模式不把NPC本人刚发出的消息当成新外部观察再次唤醒本人；sourceIds精确读取仍能溯源其已发言，保护本人持续目标的引用。
- 修复适配器内的原文保留：loadGroupRead旧UI schema会trim文本；本适配器仍使用其结构与权限规则，但从原world_group_messages.document取完整text，保留首尾空白和段落后再验证producer/hash。未修改公共旧UI schema。

## 实际验证

最终专属真实PostgreSQL18.4/55579，启动前核无监听，应用本基线85项迁移；原owner-RLS仓储和原worker队列实际调用。新增专项8子测试+父节点=9/9，0skip：

1. 原玩家群消息只被当时成员看到；非成员无正文/省略ID，玩家“已在公园”不改真实home位置，读取不改world。
2. 实际join/leave/rejoin验证旧消息、离群期间消息、重入后消息不同受众；离群前后已有来源hash一致。
3. 原群输入→真实leased nativeNpcTaskHandler→同一NPC kernel实际提交；另一原成员取得准确actor_report，NPC本人默认不被自己回复再唤醒，精确sourceIds仍可追溯。模型为本地明确替身1次，0供应商调用。篡改发送人被原DB guard真实23514拒绝。
4. 将成功普通群消息伪作membership来源被原DB guard 23514拒绝，不禁用保护。
5. 篡改正文被原DB guard拒绝；若原guard允许修改仅document.id，适配器仍要求原消息行/producer精确身份并拒绝输出，随后恢复合成记录。
6. 多段长文原样到尾；单条预算逐次准确排除已消费hash，5条消息可排空，旧积压不饥饿；错hash不误排除；精确读取不带其它消息，0预算明确omitted，非成员不知隐藏ID。
7. 原MemoryRepository创建对应源记忆，原forgetMemoryInStore实际遗忘；仅该observer不再获源，另一原成员仍保留自己的真实来源。
8. 错owner/epoch/旧world版本拒绝。

必要类型检查退出0；两新增源码/测试Prettier与git diff --check通过。不重复全量check/build或旧来源套件，root102统一做最终集成检查、构建和部署。

首轮专项4个场景失败：三处测试原本预期reader处理篡改，原DB guard实际更早23514拒绝，改断言真实保护边界；预算长文暴露旧schema trim导致真实消息匹配丢失，已在本适配器修复原文读取后9/9通过。没有削弱DB或公共源门以迁就测试，没有手工填认知或消费回执。

最终隔离说明：原core-handoff88-q checkout在收尾期间被不明来源覆盖为另一实现（缺engineEpoch/groupIds，与已测版本不同），类型检查发现差异；没有将该版本交付或把旧测试套用。root保留已知及未知两份副本并确认停止复制后，本人创建全新独占树，先短锁更新目录/端口，恢复已知版本并明确补raw document全文修复，再在新PG55579和新树重新专项/类型检查。本会话未启动子Agent；覆盖来源未确认，不归因于root。旧树及未知55565服务保持不动，避免覆盖或误停其他会话。

## 接续与限制

root102扩原private inbox/最终supplied manifest/ACK/collector/来源持续授权；当前group上下文不要顺带冒充ACK，旧paid快照无groupIds应保原scene-only版本语义。适配器不设置usage或声明新群/现场披露许可，读到自己历史群消息不意味着可以把另一NPC私聊转发出去。

groupId必填；root可按原本人group membership扫描后逐群调用。groupIds只用于当前适配器已认证的历史群，当前无消息并不制造知情。status仅表示本适配器合法候选容量是否有省略，不证明完整物理世界观察。源认证并不证明台词内容为真；真实群消息的actor_report也不自动变成结构化relayed位置。物理查看/视区/发现无人仍未开发。

本人没有新增pending表、内存仓储、模型循环或调度器，没有修改SQL/生产数据/用户草稿，没有真实模型或公网浏览器操作。PG9是来源适配和原producer证据，不是完整private唤醒或自然模型旅程；root所述102实际private quiet/ACK/持续目标路径属于root证据，不冒充本人运行。未集成上线前本任务保持待验收；“渣男体验”不发布，新引擎不启用。
