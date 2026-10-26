# QUESTION-PROOF-FIXTURES-09

基线1993a4fa，独立codex/question-proof-fixtures09。0模型/原档/端口。

- 修 authored-evidence-isolation 精确SQL mock：分别认证semantic、arrival、question-progress三条查询。新query断言真实committed attempt/succeeded command/input关联与owner/world/版本参数；旧stale来源隔离与基础设施错误传播断言均保留，不再按查询次数猜返回内容。
- world-awareness reason闭包新增本次delta内ID Set：重复ID只保留首次，其他kind/ref及原顺序不变。测试真实question progress+同轮engage各触发cross_impact只产生一次，独立plan_changed继续保留且顺序不变。
- 新question cross_impact退休资格纯测试：新cause、新版本且命中actor才提供旧执行权限退休证明；同cause、旧版本、其他actor或无actor不行。重复source只返回一次，原旧snapshot不修改。这证明证据资格，不冒充完整数据库unknown退休旅程。

17/17聚焦unit、typecheck0。未重复check/build，由root统一门禁。
