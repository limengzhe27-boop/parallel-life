# SPACE-MATTER-AI-QA-03B

负责人 codex-scene-evidence03b-01a11a84-20261012；nar-03；codex/scene-output-evidence-03b，基线b539948。状态待验收，源码冻结交I；I唯一执行新正式账本，B 0付费模型/图片/数据库/生产写/端口/浏览器/部署。

## 新实际证据与诊断修复

### v12 NPC已存与本轮候选分离

I实际v11原核对成功保存v5，SQL验证order_reviewed performer=player、eventVersion5、原input/action/resolution来源匹配；父事项仍in_progress。但同轮NPC说“单号先核对清楚”，重复已做核对，属于真实质量缺陷。新账本保守8/18，仅I使用。本次不重做/重付已保存核对。

限定NPC内部stepExecution payload改为savedCompletedSteps/savedRemainingSteps/currentTurnStepCandidates，剔除旧completedSteps/missingSteps/candidatePlayerSteps同义别名避免歧义；director/domain sceneStepContext原字段与公开契约不变。saved只依据人物获准见证、未blocked的持久证据；steps.done不看本轮候选。current只取本轮已有p.stepProposals且当前人物合法context/receiver过滤，不扩可见范围。NPC claim校验同步使用savedCompletedSteps，来源门槛不变。

提示明确savedRemaining是提交前快照，包含本轮已有核对候选并不要求玩家重做；应回应当前具体观察，并仅讨论本轮候选未覆盖且此前未完成的下一步，不提前markdone/宣布父事项完成/新阶段或机会。旧无actions JSON示例恰是“单号先核对清楚”，与实际失败台词相同；改中性结构并明示绝非默认台词，不注入成功回复。此仅是提示诱因，不断言模型内部复制因果。

新22pure全过；联合57=56过/1旧scene-step-planner:291仍读已移除missingSteps导致TypeError（I负责仅内部命名引用适配，B不改旧test、不记全绿）。type/332边界/diff通过。新反例验证saved仍缺order_reviewed/done=false、current已有精确本轮核对候选、world无预写stepProgress、无NPC动作以及旧别名不存在。0模型/SQL/生产/端口/全check/build；冻结交I/Q，实际后续质量仍待复测，不把上下文清晰等于生成稳定。

### v11 显式分段索引 wire 接续

I实际v10同动作复测失败：scene_step_evidence:observation_quote，77519ms。原world仍v4（retry没有新增input，不能写v5），没有stepProgress；新独立账本保守6/18，I唯一执行者。失败保留，不归因到任意不可见原文。

根重新释放同3文件实现显式 evidenceFormat="indexed-observations-v1" 的内部strict wire。observation为1..8个非空段数组或null，每段现有text上限1600，步骤引用段仍经canonical quote的3..500上限；join换行后的canonical observation总上限1600。observationIndex必须整数0..7且实际段存在；缺失/非法/越界或null+steps为固定scene_step_evidence:observation_index，不输出值或文本。strict step不允许旧observationQuote/未知字段。只精确format进新schema；缺format的classic原规则不变，坏classic observationQuote仍拒，不回退、补写、推测引用或重付模型。

合法新wire仅把索引选到的原段映射到canonical observationQuote，观察join换行后过原SceneProposalSchema。公开SceneProposal/DB/domain不变，inputQuote仍本轮原文；角色、来源、实际动作/观察模式、receiver、否定/未来和完成规则仍由原runtime验证。索引绑定不证明执行发生或任务完成。导演模板/步骤例改为新wire及中文“你”段，NPC独立actions结构不变；action NPC也加匿名player addressee和旧错称非身份来源，仍不读owner私档/全cast。

最终新21+旧35=56/56纯测，typecheck/332边界/diff通过。涵盖合法分段精确映射及domain源绑定、不完成parent；负数/小数/8/数组长度以外/字符串/null index、null+step、未知format/混旧quote/空或9段/字符串观察/空段/总1801字/unknown字段、坏classic、无原文input/director NPC step。错误人物观察在planner可成候选但仍被原domain拒（初test误期待planner拒，首56=55/1，改为验证真实职责后全过，未改规则）。opening/action匿名player且owner身份不泄。没有全check/build、DB、端口或模型；源码冻结交I/Q精确复验，真实首步/整链尚未治愈。

I提供新独立真实开场成功保存老周到场v3、父事项in_progress。老周叫玩家“刘航”并向错误对象索350元；350实际有官方persona和老周可见repair_record事实来源，不记为无来源新价格。正确问题是错认对话对象和索款对象，未证明实际收费。随后首步核对仅导演6575ms失败 Unsupported current player step evidence，事务未保存进展，I保守4/18；该复合错误不能推出具体哪项失败，不猜根因、不自动重付unknown。

将原复合拒绝拆成固定白名单条件码。code仍INVALID_PROPOSAL，stage=proposal，message与diagnosticMessage只为 `scene_step_evidence:CODE`。CODE依原判断顺序：context（本轮没有结构化执行上下文）、matter_id（有上下文但world matterId不匹配）、step_id、forbidden_npc_step、failed_outcome、input_quote、observation_quote、receiver。不记录raw、引用、正文、人物姓名、任何ID、未知字段或实际值。保留拒绝规则和次序，没有缺字段补成功或导演代NPC动作。

## 提示与身份

版本 scene-text-v10-evidence-diagnostics-player-addressee。导演结构示例观察改中文“你本次…”占位，明确占位不可照抄；区分matterUpdates.id取现场投影worldMatterConditions.id，stepProposals.matterId/NPC actions.matterId取WORLD的stepExecution.matterId，不做错误ID归一化。

开场独立NPC仅补固定addressee={kind:player,name:null}。当前对话对象为玩家，不把可见事实提到的车主/其他联系人当玩家；只依据现有经过actorContext裁剪的可见虚构事实理解身份，未给姓名称“你”。不读真实档案/全cast/隐藏setting，不新增playerIdentity事实，不把金额从谈及维修记录变成向玩家收费，更不编没有给出的价格。official-life-repository原约定身份/setting不自动共享NPC保持不变。

## 验证与接续

新增10专项：八固定条件码、安全消息无ID/quote/姓名泄漏、合法WORLD ID与中文示例不变、开场固定无名玩家且允许已有可见genesis身份事实、不读取owner私有身份。与既有scene-step-planner共45/45通过；typecheck通过、模块边界332文件通过、diff检查通过。没有改旧测试、公共契约、domain或repository。

此为纯stub证据，不证明新实际模型已能核对/交接/收到/完成或自然承接；现有可见来源、第一人称引用、动作枚举和事务仍须实际验收。I新18额度不归B，本人不执行任何调用，也不多建world。I/Q接精确冻结commit独立审查，I统一全check/build/READY/public后才勾完成。若新诊断显示input_quote等具体失败，再由I确定修复范围，不能为让首步成功放宽原文/来源门槛。
