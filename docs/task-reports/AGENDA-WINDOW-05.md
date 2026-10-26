# AGENDA-WINDOW-05 · 完整 quiet 后的有界个人议程窗口

负责人 agenda-window-05-20261027 / 子任务 scene_input_experience，独立工作树 `.local/worktrees/agenda-window-05`，分支 `codex/agenda-window-05`，基线 main `fae826f5`。root 唯一集成和运行控制。仅本地，不部署。

## 只读实际证据

root 原本地克隆2fb…在本次只读采样v80，并非全世界永久停住：4d924…已有新anchor，尚处于真实退避窗口。另17c17…、ef6e…、ef93…三名人物 current continuation 是 no_current_intent/basis相符，paidContinuationBases命中，故在authority最前面的continuationReviewAdmission处直接return；其窗口已到、预算充足、actorBlockers为空。忽略basis的原policy判断为ready（不等于忽略后续priority校验或已允许执行）。6b87…还有独立unknown，51346…则是原own-agenda unknown，不能靠删标志绕过。

`paidContinuationBases` 原先把**完整成功提交的 quiet review**也永久写入语义基底封锁集合；下一次安静提交虽然已经有真实新anchor与family，但同一人格/目标/问题状态永远不再进入原时间窗口与预算判断。默认窗口其实已有20秒起、quietStreak指数2、最多300秒真实退避；全局导演正常review则是1小时世界时间，是另一层兜底，不能代替个人有界窗口。

证据仅用已忽略root本地脚本，`BEGIN READ ONLY`读取。0真实模型、0原档变更；没有读取输出密钥、人物原话或完整私密上下文。

## 最小共享修正

- `own-agenda-review-repository.ts`：完整committed review消费其原family，不再永久封住同basis后续窗口；非完整付费结果（unknown、invalid、paid stale等）仍进入原basis封锁集合。
- 认证完整anchor前增加原持久stream证据判断：服务端response kind为partial或既有segment ledger标记partial_interrupted/superseded时，不能作为完整后继anchor；此类付费结果继续保留basis封锁。不加载raw response、只查询标记/有界布尔证据。
- `continuation-review-admission.ts`、`own-agenda-review-authority.ts`仅明确注释语义，不取消函数或时间准入。
- 原family身份仍是 world/epoch/actor/definition/anchor attempt/event 的固定hash；同family原history、send/commit权限、未知执行、priority、世界暂停、预算与时间窗口校验原样。不以tick、policy升级或版本增长造新family，不增持久字段/SQL/提示词/模型常量。
- await_response允许考虑本人生活安排，不授权重发原问题或推断玩家同意；原question去重、责任与邀请内核保持。

## 专属真实PG

NEW `tests/integration/own-agenda-window05.test.ts`：真实本机 `parallel_life_test`、原初始化grant/receipt→当前NpcAgentModel v15→runNpcAgent→原kernel→原own-agenda authority，受控模型而非外部服务。测试配置仅缩短非零窗口，保留指数退避；生产默认值不变。

6/6通过（5子旅程+父）：

1. no_current_intent完整quiet后：未到窗0新调用，到窗有新anchor绑定family；只执行一次，紧邻再查无候选；重复原command复用receipt不再调用。
2. await_response保留原问题，后续quiet review不新增消息、邀约、责任或承诺；到窗仍可独立考虑本人安排。
3. 已到窗口仍受actor预算拦截。
4. unknown/invalid付费结果过窗不重购，原basis封锁仍存在。
5. 原失败ledger适配器记录partial后，完整committed标志不能冒充完整后继anchor；不更新/绕过immutable response/event，不增加调用。

fixture前两次失败均是测试接线问题：初始化inputHash缺原candidate family，随后await_response未引用已有问题。已按当前协议修fixture，没有修改生产校验。最初尝试直接改已存response被原IMMUTABLE_AGENT_RESPONSE挡住，已撤销该做法，改用原失败ledger适配器；未关闭trigger或删除历史。

类型/边界/原policy与admission聚焦结果见最终冻结追加。不重跑无关全量build，root集成统一check/build后加载。

## 尚未证明

此修复只恢复“有界评估机会”，并不保证每次人物一定发消息或替它编造目标；模型可以合法quiet。测试没有把quiet说成剧情进展，实际原档长期自主来信、锁屏与人物演绎仍由root最终真实验收。0原档写/真实模型/端口/部署。

最终限定门禁：专属真实PG6/6、原policy/admission单元40/40、typecheck0、boundary762、diff-check通过。生产退避常量没有改；same family paid fence仍由原单元覆盖。源码范围已冻结交root，不重复全量构建。
