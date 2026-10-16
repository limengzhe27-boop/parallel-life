# SCENE-NPC-QUOTE-04B

2026-10-12；codex-npcquote04b-01a11a84-20261012。
工作树 `.local/worktrees/nar-03`，分支 `codex/scene-npc-quote-04b`，准确6bb418510bdd76c3c42d7fa5c148368d58c85b5f基线。

## 实际证据与独占范围

根04真实说明已保存repair_explained/Notes2/4；第一次交付failed复合Receiving门，诊断发布READY后原handover仅一次manual retry failed/7285ms，精确 `receiving_condition:execution_not_explicit`。world v8仍2/4、旧核对/说明来源完整，保守10/18；不知实际quote具体词，不猜模型原文。仅已知第一人称实际执行前缀不符合原规则，不能补“我”、对象或放宽regex。

根指定仅本人 `scene-planner.ts`、新 `tests/scene-npc-quote-index.test.ts`、本报告及主表本人行；domain/publiccontract/旧tests/repo/SQL禁止改，未修改。根负责原PGfixtures、旧提示测试必要兼容、全检/付费/发布；Q独立新audit。0模型/PG/生产/端口/浏览器，不使用旧03closed余额，不追加04剩余8。

## v16显式完整段引用

新actor marked wire `actionFormat:'indexed-npc-actions-v2'`：`text`为1..8非空完整段，每段最大1600字符，joined（包含段间newline）总计不超过1600；`actions`最多4，每项严格 `{actionIndex:int0..15,quoteIndex:int0..7}`，两个索引须实际存在，actionIndex还须本人实际slot，重复同slot拒。选中动作段完整长度3..500，不能截子串、猜唯一值或从不同角色借slot。新wire混quote/ID/kind、坏marker、string text、无marker数组、旧v1数组均严格失败，不fallback。

canonical text仅原段用newline join一次，quote直接取选中完整段。新段无trim或其它变换；特设保留型text/quote schema替换旧trim转换，前后空白、闲聊前缀、引用等均原样保留。canonical action IDs/kind仍由已获准slot+独立actor绑定，保存契约不变。v1/classic旧trim及严格quote来源检查保持，坏旧quote不被新数组纠错。

原owned/witnessed/actual quote、future/negation、claim需typed action、receive/inspection四门、handed对象/receiver/source、whole-goal判定全部不改。“好，我接过…”整段不截掉“好”；开头空白不去掉；缺钥匙/单据不补；一个段含接收和检查，不能剪出第二动作的前缀，原runtime会拒不符合动作的完整段。合法双动作须两独立完整段。允许slot只是许可，handover只算交出，received仍是人物本次实收，不发明此前未做步骤。

新固定安全诊断 `scene_npc_action:quote_index` 加入actor catch白名单；schema quoteIndex路径只固定字段/码，不含raw/value/人名/ID，旧action_index/duplicate_index保持。

人物system最前增加短身份/直接玩家语气：本人“我”对玩家“你”、说“给我”，不以自己名字第三人称任务播报；只知道获准事实，角色身份/许可不等于执行。开场仍原present/text严格协议，动作回合格式示例与v2一致。导演system仅增一句narration写环境、玩家此刻动作结果放observation，不写准备心理/不代人物行动。未堆提示段落、未让prompt决定成功；提示不能证明实际模型自然性。

## 验证与保留失败

- 初39测试准确6bb基线27pass/12fail；最终41基线28pass/13fail，保留缺新wire能力。修复后41全部通过。
- 第一次实现后38pass/1fail，测试factory显式undefined被默认参数自动置0，未测到缺值；仅修本新test显式赋undefined使JSON省略，缺值真实拒，源码不改来迁就断言。保留这次fixture错误。
- 正例：完整段+精确join，独立receive/inspect、已源handed后本人两动作，1..8段无动作回复，oldv1/classic兼容；当前两动作不补此前核对/说明完成。
- 反例：quoteIndex缺/type/fraction/-1/越界/实际不存在、坏/过量/空白text数组、join>1600、选中段<3/>500、混wire、未知marker、duplicate/no-slot/超过4动作、动作台词无typed action、blocked旧handover、引用/未来/否定/错R18/第三人称/非首人明确/缺物件仍原runtime拒。不误称所有语义错误都在adapter层拒。
- 9相关文件279项：277pass、2fail，仅旧prompt marker/示例断言（`scene-npc-action-index.test.ts:160`、`scene-step-planner.test.ts:639/652`）期待v1/string示例，与新v2数组有意不同；根已收到准确范围，本人不改旧tests，不放宽无动作/本人slots/调用数条件。
- 最终type0、332文件boundary通过，本人格式/diff通过；0paid/真实PG/生产/端口/额外进程，全量check/build由根统一，不冒称本人执行或整批全过。

## 接续

准确freeze后业务源释放根/Q。根actual PG新v2 adapter接收、原source回滚/旧2/4→4/4→机会及下一行动/私聊，再Q独立audit、fullcheck/build、迁移审计/READY/public后原handover有界复测。当前04保守10/18，root唯一剩8执行，原失败不自动重付。真实模型是否遵守完整段/第一人称、回复是否自然、完整目标链是否通过，均待实际证据。

原receiver 61及清单97已交付，不修改domain去解决语言输出；arrival只读方案未实施、不另领公共契约或部署。源/资源保持冻结，待root统一发布。
