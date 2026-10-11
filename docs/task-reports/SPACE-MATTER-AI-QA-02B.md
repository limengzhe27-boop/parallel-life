# SPACE-MATTER-AI-QA-02B · 现场规划器结构化执行

2026-10-11；唯一Agent codex-matter-aiqa-02b-01a11a84-20261011；会话01a11a84-9572-7ab0-92fb-967f963dfc20。根按用户授权指定。独立工作树 /Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/nar-03，新分支 codex/matter-ai-qa-02b 从6e39217；旧codex/matter-ai-qa-b/ad5c66f保留，无reset。主目录在途修改全部保留。

状态：进行中，第一阶段只读方案。候选编码范围仅 src/modules/world/infrastructure/scene-planner.ts、新 tests/scene-execution-planner.test.ts、本报告。公共契约、domain、repository、actor-context、turn-planner、SQL/配置和旧测试保持只读；根冻结类型并通知后才改源码。资源模型/生产写/部署/DB/HTTP/浏览器均0，未运行check/build。

## 已确认的接线与缺口

- 当前一次任务先导演complete(max4096)，再 candidates.filter(p.presentActorIds).slice(0,2) 串行人物complete(max1024)，最多3次文字调用；零在场则只有导演，开场候选来自预约参与者、随后由导演选择实际在场，行动候选来自scenePresent。人物是前两位实际在场者，不是按当次事项接收人优先，超过2人时可能遗漏真正获准接收人。调度如需改变须根冻结边界，不添加第三次人物或重裁决调用。
- 导演现先确定outcome/observation/matterUpdates。人物strict schema只有{text}，只能追加dialogues。执行通道必须增加结构化自身行动提案，不把“准备/会/等来了”肯定台词当已执行证据，运行时最终聚合由根实现。
- actorContext已返回通过权限/blockedSources/来源裁剪及预算的matters，但ScenePlanner NPC payload仅取facts、retrievedMemories，没有传remembered.matters。NPC目前不能直接看到获准的事项描述/status，因此不能准确区分固定endpoint、具体剩余步骤和允许接收人。只应接已裁剪列表再与当前相关事项关联，不直接把c.world.matters或导演条件全量发人物。
- memory确实存在：repository实际观察者episode的正文取observation或narration前400字，sourceIds包含result/input；input全文作为deriveMemory证据但不嵌入episode正文。NPC也收到当前boundary.now和自身可见entries，不能误报没有记忆/没有当前输入。新增ledger需根提供经人物可见性过滤的结构化来源，不靠旧自由文本猜补credit。
- currentStep目前对每位speaker直接提供boundary.now；旧entries按人物可见性与blockedSources过滤，事实和memory复用actorContext。新的action target/step context应沿用实际在场、当前已保存attempt、已授权matter/actor规则，plan/hypothesis/opening不能产生执行提案。deferredUntilPlayerDecision仍禁止执行玩家下一步。

## 冻结类型后最小实现方案

1. 导演解析受控分步提案数组：每项只引用根提供的当前规则step key、相关local/world matter对应及本次玩家动作证据，不自行生成source event/version。保留旧字段的兼容策略由根定义；普通无结构化规则的事项和旧存档走原合法路径，不从历史文本回填。
2. NPC接收remembered.matters中获准且相关的少量事项；新的规则/已验证累计步骤使用根提供的actor-safe projection，blocked parent/evidence/opportunity仍过滤。只将尚未提交导演步骤标候选，不标完成/新解锁。
3. 人物输出{text, actions:[受控自身行动提案]}；身份由本次独立调用外层绑定actorId，模型不可指定他人/玩家。仅当前实际在场者、已保存attempt的明确对象与有限行动种类；意向、承诺、未来/离场检查不能填executed。运行时（根）验证并赋source、持久和聚合，不依赖对白关键词。schema上限和动作字段由根冻结后精确实现。
4. 保持调用上限1+2，不追加第三次裁决；最终事项/阶段/机会以根runtime聚合为准。导演outcome表达本次玩家动作，不再强行要求整个事项成功才有已完成步骤；具体兼容语义由根类型确定。
5. 新mock capture与反例专项验证：演员实际动作能携带且actor绑定，承诺仅文本无credit，离场/未知actor/其他事项或step拒绝；plan/opening/deferred不执行，blocked/source权限不泄漏；已验证旧步骤连续输入、不把未提交候选当已存；无规则旧路径和最大3调用。纯capture不冒称真实模型或事务通过。

待根提供：正式类型/导入路径、规则/ledger actor-safe projection字段、step与NPC action引用/证据要求、旧schema默认字段兼容、director matterUpdates和runtime聚合分工、必要接收人优先调度是否本轮释放。本人不占公共类型且不提前编码；模型与生产写仍0。


## 类型冻结后的实现与验证

已接根契约8c6214f及运行时708616e/1f900dd（本树a7819f3/f63dd6c/d9c4e43），公共文件仅cherry-pick，未自行修改。根释放编码范围修正为src/modules/world/infrastructure/scene-planner.ts、新tests/scene-step-planner.test.ts、本报告；其他源仍只读。

ScenePlanner版本scene-text-v5-structured-steps。director strict stepProposals默认[]、max8，禁止director npcActions；仅当前相关、根sceneStepContext认可的官方v3目标有结构化规则。玩家证据只取当前boundary.now和本次observation原文，允许receiver必须实际在场，导演不能提此目标completed；其他目标旧规则保持。NPC strict {text,actions}默认[]，单人及总候选max4，actions无actorId字段，adapter绑定独立调用身份。只给remembered.matters交集的授权规则，ledger额外过滤本人witness和blocked result/input/action来源；不嵌入旧完整inputQuote。其可见steps重算done/missing，候选新player steps明确未提交。允许当前NPC真实接收，不把玩家partial一律变成未来承诺，不强迫人物成功；承诺/否定等源句不能通过裁短quote冒充执行。当前明确receiver优先调度，仍1导演+最多2NPC，没有新增第三次裁决。

新增14项纯专项覆盖schema旧JSON、director不能伪NPC、actor绑定及foreign actor拒绝、quote来源/无关目标、plan不执行、当前input/result来源、director不能越runtime完成、未来/否定裁短quote反例、三人现场receiver优先且总3次、blocked/未见ledger裁剪、已见步骤连续和旧v2无新权限。另新增planner提案→实际resolveSceneStepProgress纯规则验证，partial玩家动作+3必要玩家步骤+实际received即可整体完成，不要求optional记录/复检/签名。所有TextModel都是mock，无真实供应商请求或生产写。

新旧24项专项曾通过，随后新增runtime串联项，新专项14/14通过；typecheck通过。首次prompt接线改变了JSON后分隔，capture发现解析失败，已将新instructions放回payload；旧提示断言随后补了“无受控actions时不以对白冒充结果”的限定，24/24复验通过。未来裁短反例首轮揭示adapter未检查源句，已修复并重验14/14。完整npm run check已实际运行：边界/类型通过，764项中760通过、4失败，全为旧测试连接本轮未启动的127.0.0.1:55471 ECONNREFUSED；按根0DB指令未自行启动。未把完整check记绿，日志.local/matter-aiqa-02b-check.log。build仍在进行，日志.local/matter-aiqa-02b-build.log。根集成需实际DB完整check/DB事务/重放/独立审查/正式模型及上线验收，不用此纯测试证明真实体验。

只读发现根actual(quote,source)按句号split后includes完整quote会拒绝带“。”的自然完整句quote，已回根请求runtime修正；本人不改domain。当前runtime串联使用不带末尾标点quote以验证现有接口，不能称标点边界已通过。业务冻结后仅报告和经根授权必要修复，不调用模型/DB/生产部署。

## 最终交接

业务2180a38已冻结释放根。25/25新旧专项、typecheck通过，冻结源码final build exit0（.local/matter-aiqa-02b-build-final.log）；完整check仍为本轮未启DB导致4项连接失败，不能记绿。根随后修复f14e3e2（本树b00d64d），本人只接该提交，没有修改domain/repository。串联测试现在直接使用完整input/observation/NPC句子且保留末尾句号，不strip符号；assert所有保存observationQuote以句号结尾，新旧25/25复验通过（.local/matter-aiqa-02b-pure-final.log）。该引用边界原失败已由根修正并实际纯规则复验，不冒称DB事务或真实模型通过。最终小补丁仅本人新专项与报告，所有业务planner继续停写、无模型/DB/HTTP/浏览器/生产写/部署；主报告与待验收行同步，根统一完整check/PG/语义/READY公网。

最后接f14e3e2后的typecheck真实发现根新tests/integration/scene-step-persistence.test.ts五处错误：246/249 context.matters可选；290/292 getWorldRecords返回包不能直接读取matters，292回调m隐式any。已回根，其公共PG测试本人只读未修；先前2180a38冻结时typecheck/build成功不等于f14整树当前类型通过。边界323文件通过、25纯专项通过。根修复后需统一再验证。

## R17对白肯定执行却漏typed action的有界护栏

根明确重新释放原planner与新专项，主表先重新进行中；已只读接根caf8030/103e805/1123c03/77812a5/3d5c36a及1d3ae2d的运行时和独立审查修复，没有并写domain/repository/公共测试。根前轮集成797check、242真实PG+5明确skip及build过为根证据，不称本人执行。

仅在本NPC获准actorSteps对应当前R17规则时，检查同次对白原句第一人称实际接收钥匙/维修单或检查R17/接头的肯定执行claim。若无对应当前typed action，也没有本人可见已保存performer=actor/actorId一致的received或receiver_inspected证据，拒INVALID_PROPOSAL；不从对白自动制造动作。未来、否定、条件、引述、其他人的动作与别的R18对象不强迫actions；已有本人获准执行证据可正常回顾而不重复推进。prompt明确同一一致性要求。

新增3组专项（每组多反例）覆盖遗漏typed receive/inspect，未来否定/引述/他人/别的对象不强迫，历史自身证据回顾与different actor/未目击/blocked来源拒绝。新旧planner28/28通过；日志.local/matter-aiqa-02b-claims-pure.log。没有模型/DB/HTTP/浏览器/生产写或部署；源码完成后再次冻结交根，根repository同护栏负责其他FakePlanner不能绕过。最终check/build接续证据另补，未以纯mock宣称真实模型成功。

32dad92再次冻结释放根，typecheck通过、新旧planner28/28过；本树shared planner+Q纯50项49过/1失败，失败确切为Q旧“old dialogue alone does not backfill...”把本轮肯定“我接过钥匙和维修单”无typed actions视为合法，根新护栏正确拒绝。已回根由原负责人调整旧fixture/期望，不修改他人测试，不为其旧断言放松规则。完整check801项796pass/5fail：4项旧DB未启ECONNREFUSED+这1旧断言；323边界/typecheck通过。日志.local/matter-aiqa-02b-claims-{check,runtime,pure,build}.log；冻结32dad92 final build exit0。根新授权max2world/18total文字/0image仅由根独占，本人仍0模型/DB/生产write。另只读提示root两边split句子后应trim再^我，避免第二句前空白绕claim；源码已释放，不并写根集成修复。

## 候选32df2e0真实opening失败：只读诊断

根告知新合成批≤18call已开始、opening failed且保守reserve2，本人仅只读根32df2e0，不使用预算或运行DB/真实模型。发现确定的保存路径缺陷：scene-repository.ts约910–916的!resultAction分支，在p.stepProposals!==undefined时对规则目标调用c.action!.relatedMatterIds。ScenePlannerSchema会给缺省字段填stepProposals=[]，开场没有c.action，但county官方v3存在deliver_r17规则，于是访问undefined.relatedMatterIds。开场actorSteps为空，新planner claim护栏不会执行，因此不能把此确定缺陷误归为新人物NL护栏。

用既有合成county progressionFixture+相同predicate纯内存复现（node strip-types，不调用ScenePlanner/model/仓储）：TypeError "Cannot read properties of undefined (reading 'relatedMatterIds')"，actionAbsent=true。已立即回根停止对同候选付费重试，建议非执行分支只拒非空step/npc候选，或显式保护c.action；实际attempt structured-mode仍需要空数组启用runtime检查，不能移除该保护或靠省略新字段回避。根需补真实仓储/HTTP开场回归；本人不改公共repository/source/test。

此处静态缺陷和predicate复现可证；尚未收到真实task安全error classification，因此尚不断言它就是该次failed的唯一原因。导演解析、本NPCschema或其他presence/observable拒绝仍须结合实际失败阶段确认。全程本人0模型/生产写/DB/HTTP/浏览器；只更新报告与本人登记，源码继续冻结。

根随后提供安全分类：task9869fbb4，opening errorCode=AI_FAILED/detail=TypeError，耗时19874ms，非INVALID_PROPOSAL。这与上述确定解引用缺陷吻合；已经再次回根具体位置与复现，真实任务栈/修后开场回归仍由根确认，不把耗时误称网络超时。无需更多本轮模型调用来复现静态错误。
