# SCENE-CONTINUITY-44-M

## 已实现

actor-observation-inbox.ts 新增 readActorSceneRecall(sql, owner, snapshot)：最近3个本人曾参与现场，最多12条/16000字节，复用readActorSceneObservationSourcesInTransaction完整来源/在场/遗忘认证，usage=private_strategy。不查询消费状态，不产生通知/ACK，不新增存储。

## root接线

在private snapshot共享attach阶段合并sources/observations，不加入actorObservationInbox.sourceIds。提交阶段按已提供sourceIds重新认证；不能重新选择最新窗口然后要求全窗口完全相等。历史来源不可用不等于新消息重发。已存在重复source应由root统一去重，inbox提供的未消费记录仍按原方式ACK。

当前native读取明确排除private transcript/memory。双向连续记忆仍需root把现有私聊授权读取拆成共享可复用入口：只传本人的相关经历为private_strategy，不能将其升为现场channel_context。不要直接复制私聊SQL或每次构造第二份全量private snapshot。

## 验证及限制

新增纯测试验证无现场时有界读取、owner/actor参数与无消费读写。typecheck通过。未做真实PG/模型/原档写入；root应在现场源认证PG夹具里补“ACK后仍召回且不新增wake、遗忘/他人不可见”集成验证。单独helper尚未接入实际请求，不能称双向记忆已完成。

## 扩围实施

新增validateActorSceneRecall，按实际supplied source ids定位scene_items，再用原adapter认证本人当时在场、原event、文本与来源。native snapshot从world.messages选择本人近12条/8KB，经readActorStrategyBasis新可选referencedSourceIds认证后才作为private_strategy speech/speaker；不复制私聊授权SQL。

支持root新增turn.resolved.data.sceneReply.entries的严格原entry匹配；普通scene.reaction_recorded的narration也按dialogues中完整entry匹配。native事件读取只追加sceneReply投影，不带turn userText。

独立PG55744观察来源测试10/10，通过新增已消费过滤与独立召回、重认证、遗忘及旧隔离。修旧native测试receipt短引用错误，按当前线程查询实际receipt；未放宽生产。typecheck通过。未验证root尚未接的sceneReply实际commit，native私聊回忆需root追加正常私聊入口夹具。npc-agent-model validateSnapshot当前禁止非inbox的private_strategy speech，root必须统一更新该消费者，否则新召回输入会被拒绝。

## 44 整条交付补验（2026-11-04）

基线064a1bcd；借用root未提交源码只验证，不将root WIP提交。冻结消费者修复1ef76f20、整旅程8fcfa42c。

- 新真实PG测试scene-private-delivery44.test.ts：1/1通过。原npcAgentServices将私聊input保存到phone，NPC speech+narration作为两个scene entry保存，phone不重复NPC台词。重复HTTP不增加模型或entry。
- 原readActorSceneRecall读取现场回复（不带私聊input），缺席人物无召回，原validator通过。readActorStrategyBasis能认证本人private attempt实际交付的现场speech。
- 随后的原scene input + native task真实提交；同一人物读取自己私聊为private_strategy，未变channel_context。
- 模型生成期间通过原scene.navigate离场，提交拒绝且无迟到现场消息；不在场人物试图replyChannel=scene时拒绝。
- 本轮实际定位并由root修复：assertSceneEntry缺历史presence来源、仓储重复parse拒绝scene-only空phone dialogues、markRequestSent遗漏显式私人召回来源。未用假phone对白或放宽权限绕过。
- 既有strategy来源SQL补sceneReply完整entry认证及自有private输出归属；旧无hash strategy source不误进带hash recall重验。
- 独立测试PG55744；typecheck通过。0付费模型、0原档写、0运行端口启停。
- 原档真实模型、前端现场显示与本地构建切换归root；本报告不将受控PG视为真实人物体验完成。
