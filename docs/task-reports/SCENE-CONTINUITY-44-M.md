# SCENE-CONTINUITY-44-M

## 已实现

actor-observation-inbox.ts 新增 readActorSceneRecall(sql, owner, snapshot)：最近3个本人曾参与现场，最多12条/16000字节，复用readActorSceneObservationSourcesInTransaction完整来源/在场/遗忘认证，usage=private_strategy。不查询消费状态，不产生通知/ACK，不新增存储。

## root接线

在private snapshot共享attach阶段合并sources/observations，不加入actorObservationInbox.sourceIds。提交阶段按已提供sourceIds重新认证；不能重新选择最新窗口然后要求全窗口完全相等。历史来源不可用不等于新消息重发。已存在重复source应由root统一去重，inbox提供的未消费记录仍按原方式ACK。

当前native读取明确排除private transcript/memory。双向连续记忆仍需root把现有私聊授权读取拆成共享可复用入口：只传本人的相关经历为private_strategy，不能将其升为现场channel_context。不要直接复制私聊SQL或每次构造第二份全量private snapshot。

## 验证及限制

新增纯测试验证无现场时有界读取、owner/actor参数与无消费读写。typecheck通过。未做真实PG/模型/原档写入；root应在现场源认证PG夹具里补“ACK后仍召回且不新增wake、遗忘/他人不可见”集成验证。单独helper尚未接入实际请求，不能称双向记忆已完成。
