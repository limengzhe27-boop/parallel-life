# SCENE-RECEIVER-04Q — 接收者wire独立审计

2026-10-12；Agent `codex-receiver04q-01a0c7c8-20261012`，辅助会话 `01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b`。本人按主登记短锁确认根指定进行中，独立 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，新分支 `codex/scene-receiver-04q`，准确基线 `e7bbd7b8a4973834429ca656ede72aeaf797a64b`。原树clean，旧分支/提交保留，没有reset或覆盖。

仅新 `tests/scene-receiver-wire-audit.test.ts`、本报告和主表本人行；全部业务源码、旧tests、公共契约、SQL只读。B独占planner与自己的新测试，根独占domain若需、PG/全检/build/模型与发布。本Agent0模型、数据库、生产、端口、浏览器、部署，旧16/18 closed余量不复用。

## 已读与五条件诊断

读AGENTS、PROJECT_BRIEF、主DEVELOPMENT、ARCHITECTURE_REVIEW；按任务读当前planner/domain、旧接收诊断与证据/NPC测试及纯fixture。主表第一次尚无子行时先只读并通知I，未自行定义任务；I同步后再短锁确认范围，开始报告/独立测试。

原runtime对repair_explained/handed_over依次检查：

|固定条件|仍被拒的独立反例|安全处理|
|---|---|---|
|not_found|缺receiverId或无对应人物|显式有限receiverIndex绑定获准ID，缺索引拒，不默认唯一人|
|not_related|ID对应人物但不属于该事项|仅所选事项context.allowedReceivers可选，不借其他context槽|
|not_present|关联人物当下不在场|没有获准在场列表不授予槽，不把预约/旧对白当在场|
|input_not_named|原动作向老周说明，inputQuote截取仅“说明R17接头检修细节”|不拼补quote；选择含实际完整人物名且原句的片段，否则不提完成步骤|
|observation_not_named|input点名但被选观察段只有“你说明R17接头检修细节”|索引只能选择原始实际观察段，不能追加姓名造证据|

这些条件之前还存在owner/world/action/source/player/当前实际执行/否定引用未来/错误R号等边界。诊断顺序只说明首次命中的条件，不掩盖更早拒绝，不暴露ID/人物名/原文。

原v2 receiverId可省略，planner只在字段truthy时检查获准列表，因此缺ID候选可能到最后domain才not_found；新显式v3应把此结构错提早拒，但不改变原执行边界。已回传I/B：v3 receiverIndex映射只解决引用稳定性，不证明动作实际发生；旧classic/v1/v2保持严格原格式，不修旧坏ID。B已回复相同计划，独占planner改动中，Q不读WIP验收。

## 初始验证与进度

准确e7bbd7b上原 `tests/scene-receiver-diagnostics.test.ts` 6/6通过。另用纯合成领域输入只读运行四项：合法向老周说明得到单repair_explained且wholeCompleted=0；缺receiver→not_found；动作原句含老周但inputQuote剪掉姓名→input_not_named；观察段不含姓名→observation_not_named。均不是数据库/模型回合，不把合成动作当真实世界事实。

没有此前真实供应商完整原输出，不猜03真实失败属于哪一个子因。真实03批failed/16of18正常暂停closed依根证据保留，本轮新模型授权尚待用户；本Agent不调用。

下一步等B准确freeze再接源码，写独立wire负例（缺值/空列表/类型/越界/错context/混格式）、输入和观察姓名/引用未来否定、已存核对保留与独立NPC接收/旧坏ID边界；只改新测试，不反向改生产源使测试通过。执行有意义纯test/type/boundary/format/diff，提交精确freeze给I。交付待验收，最终真实PG/check/build/READY/public完成标记归I。

## 冻结后独立验收矩阵（初始计划，结果见下）

- 显式v3合法说明：matterIndex/observationIndex/receiverIndex均0时保留canonical世界matterId和actorId、原quote；只新增player repair_explained，不获得received或整体完成。核对步不带receiverIndex仍合法。
- 接收者缺值、null、字符串、负数、小数、越界、实际列表之外、空列表，及不需要接收者的步骤多带index，均不自动默认或修补。
- 选择以所选matter自己的allowedReceivers为准：另一matter的合法人不构成本matter授权，不能从全cast或另一列表借槽；有两候选时精确按索引绑定，不能忽略0或选唯一人。
- marked混receiverId/旧字段/错误marker/未知字段和unmarked新receiverIndex拒；旧classic/v1/v2坏receiverId继续拒，缺ID不会被新增默认。
- 输入原句未点名、观察段未点名、点名不同人物、错误R号、引用/未来/否定与自述旧结果不能变成新信用；不得拼补原文。有合法索引但action owner/world/source不匹配仍由原domain拒。
- 已保存核对后说明保留首次核对证据，不重复核对，不把说明当NPC接收；已交出但没有本人实际NPC动作无received，未来/否定/引用的接收对白仍拒。本人实际接收在受控索引/实际原句/对应交接证据下才累计。
- 独立测试使用可控纯TextModel返回合成JSON来检查真实ScenePlanner和领域边界；这不代表真实供应商回合、Repository、数据库或自然对白体验。
- 错误只暴露有限固定诊断，排除自定义字段名、原文、人物姓名和ID；失败时传入world/context不变。


## 冻结源码与最终独立结果

准确接B `61bfdabdf878642d1f5cf51715c4d586ccc4942e`，本地等价cherry `fac233334165269ebe175cb181a1a6bc826f75be`；B的planner/newtest/报告均没有二次改动，未导入或改写其测试。只新增本人audit文件和本报告。

新审计42项全部通过。接受显式v3 receiverIndex=0/1时，仅所选context真实名单映射canonical actorId，原quote不改；检查规则/事项ID/来源inputEventId/resultEventId、仅player说明信用、无whole credit。覆盖7种缺值/错类型/越界、空在场列表、无关在场人、5种混入/未知字段、4种错误或未标记格式、核对无需接收者及多带index拒、4类输入/观察缺姓名或错人、5类未来/否定/引用/错R号/过去执行、classic/v1/v2合法ID及坏/缺ID仍拒；错误有限且不泄漏sentinel、原文、人物姓名和ID，输入world/context不变。

累计链覆盖：已存核对→当前说明，NPC上下文区分savedCompletedSteps与currentTurnStepCandidates；保留首次核对来源，不授予接收slot或received。仅交出与独立实际NPC接收分别累计；已有核对+说明后交出仍未全完成，本人实际receive才满足四必需。未来/否定/引用接收不能转成保存信用，正确索引也不能绕过原owner/source拒绝。两在场授权人显式第1槽、所选matter局部第0槽和借另一个matter第1槽的反例均覆盖；姓名和编号不互相猜补。

### 失败基线与修正

- 同42项测试以Node只读load hook载入准确e7bbd7b的旧planner，其他业务文件不变：20通过/22失败。临时旧源码和loader仅/private/tmp，未改生产文件；表示新格式相对于基线的能力变化，不是新真实模型调用。
- 首次新audit38项37通过/1失败：测试要求planner直接拒绝“你说‘我接过…’”引文，实际planner允许提案，原domain对完整引用句拒执行。本测试修正为完整planner→domain链必须拒且world不变，保留反例。不是把提案通过当信用，也未放宽源或删除反例。
- 增加4项后42项40通过/2失败：两个测试误假定fixture中老周/另一个人物的列表顺序，实际allowedReceivers按当前world.actors顺序。修改独立fixture断言/选择逻辑为按当前实际列表验证显式第1槽和另一个人物的实际槽，未重排生产数据或改源。最终42/42通过。

首次类型检查退出2：本测试观察数组被推断为三种fixture字面量联合，四个反例/长姓名赋值不兼容；明确为string[]后重查。此为新测试类型问题，未修改业务源码。

6个相关文件 `scene-receiver-wire-audit`、`scene-receiver-wire`、`scene-receiver-diagnostics`、`scene-npc-action-index-audit`、`scene-step-progress`、`scene-output-evidence-audit` 共186通过、0失败/取消/跳过/TODO。类型检查 `tsc --noEmit --incremental false`、332文件边界、本人新测试Prettier、git diff --check均退出0。没有运行全check/build、HTTP/浏览器、数据库或供应商模型。

## 交付与接续

只改新 `tests/scene-receiver-wire-audit.test.ts` 和本报告；主表只更新本人行待验收。所有其他src/旧tests/契约/SQL冻结，原分支保留，未新建会话或夺取集成职责，没有资源需停。本Agent0 PostgreSQL验证、0 API接线、0真实模型/生产/端口/部署；可控TextModel只是领域/适配器合成测试，不是生产Repository或自然对白验收。

I回传本批实际本地PG251通过及5明确模型skip、新专项10项（v3说明、wrong index零副作用、实际WorldTurnPlanner私聊context读取保存结果/机会、独立角色隔离及幂等）和完整检查/build通过；此仅I证据回传，不冒称Q亲自PG验证。Q也未独立验证公开完整模型链、后续机会实际执行和自然私聊，需要根有限授权模型+Repository/任务/事务与READY/public继续。旧16/18 closed不能复用；新模型授权仍由根等待，不因纯测试通过自行支付。

准确新审计提交交I后仅待验收；I集成最终check/数据库/build/READY及公网再决定限定技术完成。旧真实复合失败原因仍未知，不能把显式索引修复当已治愈说明或全链通过。本范围source冻结，不自动领取其他任务。
