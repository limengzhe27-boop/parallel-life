# 44-162 NPC v13 原目标无变化回显

负责人protocol162-tests；基线50f19a03；只改npc-model-protocol.ts、四个聚焦协议测试及本报告。root独占npc-agent-model及真实验收/生产。

## 已定位根因

原林白语真实paid v12输出的agendaReview为quiet，未提行动、计划或台词；既有goal和原来源集合原样回显。v11机械附加本轮accepted_input来源后，v7 quiet比较把自动追加来源当成议程改变，触发NPC_AGENDA_REVIEW_QUIET_CHANGED。没有修改、重试或恢复该历史paidinvalid。

## 新版本最小修复

NPC wire版本升级v13，字段保持v12。仅新v13在严格schema、真实current accepted-input、唯一goal、本人可见非终态goal、来源唯一且获授权都通过后，比较summary/status/endReason/默认空resultIds及原sourceIds集合。完全一致的回显不生成goal更新，原状态及其来源不变，也不人为附加本轮来源。

真实summary/status/endReason改变，或来源增加、删除，均不能用此规则省略；继续原v12/v11的来源附加与全部quiet/update_plan、来源历史和内核校验。旧v12仍用原解释，测试明确同一旧echo继续抛原QUIET_CHANGED；不让新版本规则洗白旧付费结果。

## 必要验证

34项聚焦协议测试、tsc通过。新增回归覆盖无变化echo/source集合顺序/nullable transport、真语义改变/来源增加或删除、重复引用、hidden goal、原raw/state不变及旧v12严格行为；provider当前版本断言更新到v13。未改root模型及其测试，无模型、数据库或生产操作。
