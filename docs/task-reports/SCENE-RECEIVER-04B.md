# SCENE-RECEIVER-04B

2026-10-12；Agent codex-receiver04b-01a11a84-20261012。
工作树 `.local/worktrees/nar-03`；新分支 `codex/scene-receiver-04b`，准确基线e7bbd7b8a4973834429ca656ede72aeaf797a64b。旧交付全部保留，不reset他人改动。

## 证据与范围

前真实批次v14原说明failed/9035ms，安全复合错误 Receiver not actually addressed/present、world v6只保留核对；16/18已正常paused/closed，不沿用余2。本批不能猜旧供应商具体字段、缺ID或未点名子因，不能凭新格式宣称旧失败已修好。静态已确认v2 receiverId为optional，已有source guard检查原五条件（不存在、非关联、非在场、inputQuote未点名、observationQuote未点名）；ID不在allowedReceivers通常在adapter先拒，不能从复合错误猜错误ID。

用户授权继续修复/验收且两位协作；根冻结独占planner范围，仅本人 `src/modules/world/infrastructure/scene-planner.ts`、新 `tests/scene-receiver-wire.test.ts`、本报告和主表本人行。domain、公共contract、SQL、repo、原tests、根报告均未改。新真实模型授权由根询问，未到答前0付费；根唯一真实PG、全量验证及部署，Q独立新wire audit。

## v15最小显式接收者协议

新的director内部marked wire：`evidenceFormat: 'indexed-observations-v3'`，保留v2 `matterIndex/observationIndex`，说明与交付加必填 `receiverIndex`。每个 `structuredStepContexts` 的 `allowedReceivers` 输出 `{id,name,receiverIndex}`，编号只在该context内从0开始。schema整数0..7且必须实际存在；repair_explained/handed_over不可缺/null/string/fraction/越界，其他步骤必须省略。当前唯一候选也不自动补0，不从名字猜ID，不使用全局actor列表或另一context索引。

adapter只将所选本事项已有allowed receiver映射canonical receiverId，inputQuote与所选observation段原样保留，必须各自含该receiver.name，否则固定安全失败。没有名字不能补造quote；未实际输入或观察过的文本不能因此变合法。原五条领域边界、实际step原文、人物是否收到对象、ownership/presence/source、全目标完成和清单规则均不改。人物实际接收仍来自独立NPC indexed action及原runtime，不由导演接收者选项当作已执行。

新v3 strict拒receiverId/matterId/observationQuote/actorId混入、未知format、无marked格式的index、错误matter/observation/step、null数组与director NPC actions，不自动fallback或修坏proposal。classic/v1/v2按原schema严格兼容，原ID字段不给自动补人；缺ID仍交原runtime not_found拒，坏ID仍拒。公共SceneProposal/DB保存契约仍是canonical ID+exact quotes，不增加迁移或客户端格式。

新固定安全码 `scene_step_evidence:receiver_index`、`receiver_input_named`、`receiver_observation_named`，只固定条件码/stage proposal；schema字段receiverIndex加入既有白名单。不输出坏字段值、raw reply、姓名、人物/世界ID或私档。receiver名字缺失前置拒会节省失败回合的人物调用，但不修改提案或自动重新调模型。

提示只在已有指令/template中替换为唯一v3格式、context局部index与必填说明，不叠海量纠错段落。原旧test420要求“完全省略receiverId”，在新v3该字段本来应完全禁止，提示准确表述“v3必须完全省略receiverId字段”；保留旧JSONobject/调用数量/null禁用断言，不改旧tests。

## 验证证据与限制

- 新31测试先在准确e7bbd7b运行：18pass/13fail；补context局部索引后最终32基线18pass/14fail，原合法v3与精确诊断缺能力保留。修后32全部通过。
- 正例：说明只添加repair_explained、核对无接收索引、已存核对完整源保持并追加说明、实际交付+独立NPC接收只添加handed_over/received，不能凭此补此前核对/说明完成；classic/v1/v2仍可保存合法canonical原ID及quotes。
- 反例：缺/index非法型值/实际不存在/空候选、另一允许人物不匹配两quote、非在场/非关联、原文或观察未点名、混新旧字段、别事项局部index、未来/否定/引用、错误matter/observation/step/marker、旧坏ID及缺ID不自动修；director不能补NPC actions。
- 第一联合7文件201项200pass/1fail，唯一旧test420字面提示兼容，保留失败。改同义准确提示后最终7文件202pass、0fail/skip/TODO；包含旧scene planner、matter-index、output evidence+B/Q及NPC action index+B/Q，原tests未修改。
- 最终typecheck0，332文件模块边界通过，本人格式及diff通过。0真实模型/图片/生产/数据库/端口/浏览器，按根指定未跑fullcheck/build，不启额外进程。

没有真实供应商新v3与实际PG证据前，不能称说明→交付实收→机会→私聊整链完成。原完整姓名原样匹配条件保持；昵称/别称未获规则支持时不能自动同一人归并。新的输出格式只解决可证明的结构明确性，并在安全原规则前提供更具体条件诊断，不还原旧模型响应、不假称旧错误子因。

## 接续

准确freeze后源释放根/Q：根原PGfixture使用actual v3 planner的说明/交付，非法receiverIndex事务无效果、old sources和checklist保持；Q独立audit后完整check/build、生产迁移审计、READY/public，再由根有界新授权真实验收。B不追加模型次数，不自动领domain或公共契约，不重做已存核对，不实施已归档arrival计划。
