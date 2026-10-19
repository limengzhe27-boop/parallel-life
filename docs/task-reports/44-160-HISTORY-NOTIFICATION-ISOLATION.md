# 44-160-HISTORY-NOTIFICATION-ISOLATION

状态：待root集成验收。唯一公共集成人root-runtime160；执行者codex-history-notifications160。
基线b52f5928，独立工作树history-notifications160，分支codex/history-notifications160。源码冻结34fc604e。

## 具体断点

作者phone.messages的history在publication-genesis编译为initialRead:true并保留history标记；作者已写的incoming/opening则initialRead:false且无history。原readPhone仅history投影origin:fictional_history，通知和联系人未读只检查initialRead，因而把作者预置来信显示为新锁屏通知。它与NPC本轮模型实际执行无关，不能作为主动运行的证据。

## 修复与所有权

- 原BuildRepository.phone已验证seed/opening/immutable publication binding一致，在同一原投影中按精确sourceEventId===`publication-genesis:${worldId}`把非history作者消息标为origin:publication_preset。无日期/文本/ID前缀猜测，无额外查询；非publication和真实运行期消息不被归类。保留history优先标记fictional_history。
- WorldPhone消息来源联合增加publication_preset；不改变world保存内容、initialRead、原稿、初始快照或用户已读记录。
- 新纯展示策略isIncomingRuntimeMessage排除user、initialRead:true、fictional_history、publication_preset。世界适配器原样保留origin，联系人未读和锁屏通知共用该规则，作者内容仍在聊天中可读。
- root独占world-phone-app.tsx，须将observeIncoming原三条件改为该helper，确保作者预置内容也不冒充新来信重置主动调度时钟。执行者未修改此文件。

独占源码：contracts/world-build.ts；world/infrastructure/build-repository.ts的来源投影；features/phone/message-notification-policy.ts、notification-projection.ts、world-app-data.ts、apps/types.ts。聚焦tests：notification-projection、world-app-data、integration/publication-worlds。

## 必要验证

- notification-projection + world-app-data：20/20通过，覆盖preset/history即使initialRead:false仍不通知、同刻真实消息仍通知、已读集合保留、原内容不移除。
- 独立本地真实PostgreSQL55661，原publication-worlds：29/29通过（约2.4秒），新增原API/编译/绑定/读取路径断言：初始作者history+incoming仍保持原文和true/false initialRead，来源分别history/preset，联系人未读与通知均0；真实原事务commit用户输入/NPC回复后，手机投影仅该NPC回复通知且未读1，原已读集合应用后0。不是模型质量验收。
- tsc --noEmit 0错误；check:boundaries657通过；git diff --check通过。
- 无SQL迁移、无生产读取/写入、无模型调用、无全量check/build、无部署。完整真实手机/PC/模型旅程及check/build由root集成一次执行。此修复只消除伪新通知，绝不声称已解决NPC主动演绎。
