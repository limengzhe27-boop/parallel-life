# SPACE-MATTER-AI-QA-03Q — 场景输出证据独立复核

2026-10-12；Agent codex-f-scene-evidence-03q-01a0c7c8-20261012；独立工作树 /Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本；codex/scene-output-evidence-03q，基线 b539948。主登记短锁已确认指定领取；上项由 I 完成释放，旧分支/提交保留。

## 范围与当前进展

仅新增 tests/scene-output-evidence-audit.test.ts、本报告及主表本人行。业务源、旧 tests、manual 工具、配置、SQL 只读。依赖 B 的准确冻结提交；冻结前只读旧规则和 fixture，不把其未提交修改作验收依据。无端口/浏览器/PG/生产写/部署/真实模型，不使用已关闭旧预算。不跑全量 check/build；类型/边界及独立纯测试按任务范围执行，I 负责完整检查、真实数据库和上线。

已只读审核 b539948 的手工验收脚本并回根：保守预算必须使用新账本且串行；任务 succeeded 不证明累计步骤/接收/完成；多接口快照须同版本；私聊提交后读取失败不能误写 unknown；未知结果复试先查原回执；失败和 unknown 不退预算。没有运行该 HTTP 脚本。

根提供的脱敏摘要：新一世界开场 2 调用成功 v3，有老周独立 presence，但称玩家刘航并向玩家索款；第一步核对失败，安全类别 Unsupported current player step evidence，0 步骤，保守 4/18。根随后纠正：350 在 persona/授权 repair_record 有来源，不能称编价或无来源，问题为把玩家误认成车主并索款。原第一摘要判断已纠正，不能继续传播。正式只读 v4 R17 in_progress、stepProgress=null，失败耗时 6575ms，模型 gpt-4o-mini。以上为 I/B 报告，本 Q 尚未独立读取实际保存证据；不得称本 Q 已完成真实模型或数据库验收，也不把失败推断为某个具体字段。

## 验证计划与接续点

收到 B 冻结后，仅接该准确提交，新增独立合成反例：WORLD/local matter ID 混淆、unknown step/receiver、非当前输入/观察的引文、错误观察视角不得通过；安全诊断不能带 raw、ID、引文、人名；玩家身份缺失不得从其他人物或历史推断姓名。保留正例，证明合法当前核对仍可提案；不放宽生产校验。真实现场累计、NPC 接收、整体完成、阶段/机会、下一行动、私聊语义必须以持久来源与版本另验。

初始登记为进行中，依赖 SPACE-MATTER-AI-QA-03B 精确冻结；后续结果如下。不抢其业务文件，不自动追加其他任务。

## 独立反例与冻结复验

收到 B 精确 84756913b8db9caf8255bfd6dbee1ef13ebc5b67 后新增本人 13 项测试，先在 b539948 跑原断言：实际 3pass/10fail/0skip/TODO。八种 evidence 条件、多个错误同时出现的优先顺序、opening 匿名 addressee 失败；原实现仍拒坏证据，但没有本次固定诊断，不能把测试失败说成原实现接受了全部坏证据。

接准确 B 提交成本树 d6c12f7，没有手改其业务源/测试；本人原 13 项全部通过。再与 B 新 10 项及旧 scene-step-planner 35 项合跑，实际 58pass/0fail/0cancelled/0skip/TODO。typecheck exit0、边界332通过；本人测试 Prettier 与 git diff --check 均 exit0。不跑 full check/build/数据库/HTTP 工具。

覆盖八固定码 context/matter_id/step_id/forbidden_npc_step/failed_outcome/input_quote/observation_quote/receiver，错误 WORLD/local ID、非法步骤/receiver 和不属于当前输入/观察的引文仍拒，拒绝发生在额外 NPC 调用前；message/stack/错误序列化不含合成人名、ID或引文，输入世界不被修改。多缺陷仍先报原优先条件。未知 schema 字段名和值被安全诊断遮蔽。

正例合法当前核对保留 WORLD ID，领域纯函数只产生 order_reviewed 的 player 来源，绑定本次 action/inputEvent/resultEvent/version，没有整体完成信用；不是数据库保存。子串命中但观察未以“你”开头可到提案层，但最终领域规则仍拒绝；这项测试明确验证最终运行时边界，不宣称 planner 自身拒所有语义错误。

开场可见车主刘航与350记录，同时合成 owner-only identity 不进入 NPC payload；固定 addressee={kind:player,name:null}，不额外补 playerIdentity，提示明确不可把车主姓名当玩家或向错误对象索款。验证的是 payload/提示，不是模型一定遵守或真实开场质量已通过。固定诊断只能缩小错误条件，不能从旧 Unsupported 文案推断首步具体坏字段。

## 交付与下一位 Agent

本人仅新增 tests/scene-output-evidence-audit.test.ts 与本报告，主表本人行按短锁更新待验收；B 源提交为准确依赖，集成时只接本人交付提交，不重复合本树 d6c12f7。范围冻结，无外部资源，不自动另领。

真实 PostgreSQL验证：本 Q 0 项；真实模型/生产写/图片/部署：0。上述全为合成 TextModel 和领域纯函数，没有 Repository/API/Task Queue真实接线证据；不冒充真实数据库或线上完整体验。下一位 I 统一完整 check/build、真实数据库、迁移一致/READY/公网，并按新独立账本单次核对失败原回执与安全诊断，再逐轮确认累计→NPC实际接收→完成→后续机会/行动→私聊。Q 等待脱敏持久证据另行只读核对，不沿用旧15/18预算，不绕过队列/事务/RLS。
