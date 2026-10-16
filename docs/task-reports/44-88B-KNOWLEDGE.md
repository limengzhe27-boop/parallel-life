# 44-88B｜明确位置告知的历史受众

执行者 `codex-knowledge88-b`；独立 `knowledge88/人生剧本`，分支 `codex/knowledge88`，基线 `f351e221`。root 为唯一公共契约、SQL、旧源集成和上线负责人。状态：组件待集成验收，不代表完整观察传播已完成。

## 实际缺口与处理

原 `npc-agent-kernel.ts` 只把本轮人物从玩家原话提取的位置告知保存为自己的 `player_report`。即使群聊或现场另有人确实获得同一条玩家消息，这些原受众的认知也没有同步。不能用全体人物、联系人或同地点列表补齐；也不能把玩家告知升格为真实位置。

本批仅新增三个文件，代码提交 `2b86ac81`：

- `domain/project-location-report-knowledge.ts`：纯投影，只接受当前玩家原输入的逐字片段、明确 `reported` 断言及服务端认证受众。私聊只给原接收者；群／现场无受众证明也只给接收者。去重、身份／地点边界和输入来源检查；`hypothetical`／`uncertain` 不投影。结果恒为有来源、可能过时的 `player_report`，`occurredAt=null`，`learnedAt` 使用原输入故事时间，不读取或改写真实位置。
- `infrastructure/location-report-audience.ts`：`readLocationReportAudience(sql,ownerId,world,input,responderActorId)`。逐项认证持久输入与原成功命令／事件；群消息用 `canReadGroupMessage` 的历史加入／离开区间，现场用原 entry 的明确 `observableTo` 及原版本 presence。私密想法禁止。现在退出群或现场不会抹去已经合法获知的历史；不以当前同地点或当前联系人赋权。
- `tests/location-report-knowledge.test.ts`：18 个聚焦纯测试，覆盖私聊隔离、双渠道明确受众、不向第三人广播、历史证据标识错配、未知／假设、逐字引用、边界和副本独立。

群不能复用 `groupHistory`／`groupMessagesForActor` 判断历史认知，因为它们额外要求现在仍在群。现场同理，不能把当前 scene 状态／current_scene_id 当历史认知的许可依据。

## Root 接线要求

在原人物提交事务内，当存在位置报告时用上述读取函数获取认证受众，再调用纯投影函数。原 `world-awareness.ts` 的 `observerActorId===本轮actor` 限制需要改为通过同一历史认证函数重建的许可集合。重放不得信任模型或事件自报 audience；保持原 inputReceiptId、quote、owner/world/version/source 检查与忘记来源裁剪。

本执行者没有修改这些公共旧源，root 已接收精确接口和提交。不能仅因三个新文件存在就声称已接通。

## 检查与未完成

实际运行：专项18/18，TypeScript全类型检查0，聚焦Prettier和diff检查通过。按用户减少重复验证要求，没有完整check/build、数据库、端口、浏览器、真实模型或生产操作。root 接线后的真实PG与必要集成检查／部署单独记录。

未实现：`observe.place/room`、明确视线／完整覆盖授权、实际看到与离开／缺席感知的内核回执及模型真实消费。现同地点不等于目击；本批只传播玩家确实说过的位置告知，不证明其陈述属实，也不产生凭空的观察或真实位置广播。
