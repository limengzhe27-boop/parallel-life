# 44-179 续接决策减法

## 本轮完成

- `ActorContinuationSchema` 的 `planIds/questionIds/conditions` 改为默认空数组。
- 普通 continuation 只需 `decision/reason/sourceIds`，不再强制模型填写空集合。
- JSON grammar 不再把这三个空集合列为必填。
- 新增 v15 最小 continuation 旅程测试。
- decision 校验、source 授权、plan/question/condition 语义保持不变。

## 证据

- `npc-model-protocol`：37/37
- 全量 check：3887/3887；build：通过。

## 边界

- 这不是删除 continuation，也不是放宽 condition 来源；
- 旧协议解码保持不变；
- 未调用真实模型，不改用户存档。
