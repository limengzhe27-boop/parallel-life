# 44-147 同一人物运行入口的完整执行提案

2026-10-18，codex-root-execution147唯一集成人，unified-engine137沿用d347763e/95a7c5c8。145六次付费范围已闭账，本任务0商业模型/0新档/0生产数据/0新增SQL。小安146只读报告已集成，无公共源并写。

## 已开发

npc-wire-v1增加可选executions数组：每项必须同时包含人物明确给出的goal(new或existing)、plan、action。代码仅绑定相同goalId、nextActionId、actionIds、提案proposed与新目标active/resultIds空；执行本身仍归原parser→validateAgentProposal→原kernel事务。动作参数、来源、对象、依赖与责任引用必须由模型显式提出，不从对白补造。模型v20优先输出这一完整对象，避免分别列出计划却忘了动作。

new目标必须明确summary与sourceIds，existing引用仍由原kernel验证；缺action整个包拒绝，未知能力/隐藏source/不存在goal、重复或冲突的原对象仍拒绝。新包不代表人物已经执行，也不代表玩家同意；成功对白必须依赖动作，由原内核决定能否呈现。原等待/blocked/撤回提案继续同一协议的原数组，不新建第二个Agent或执行器。旧已保存canonical/v1付费结果可按原流程校验；旧invalid不自动救活或重买。

TextModel公开端口当前仅支持format=json_object，未暴露受约束JSON Schema能力。本任务没有假称商业模型适配器已实现强制schema，也不全局更改provider参数、模型型号或收费重试策略。完整包减少关联字段遗漏，但模型仍可能不遵守格式；只有后续真实模型独立验收才能证明自然效果。

## 必要验证

- 单包纯测试：合法goal/plan/action关联且不改原raw；缺动作、未知能力、隐藏来源及不存在目标均拒绝。
- 原服务本地真实PG7通过：Director→人物明确选择→active episode→玩家消息→同次executions→原能力执行→真实日历proposed/行动succeeded/目标仍active，重放无额外调用；同时验证wait责任与已知invalid保护。
- 最终check/build与生产READY见本任务收口记录，未完成前不提前勾选。
- 第一轮新增单包负例预期CAPABILITY，实际共享kernel优先报PLAN_NEXT_STEP_REQUIRED，改为断言真实拒绝原因后通过，未放宽业务守卫。

## 仍未验证 / 未开发

145真实模型最后一次缺action被拒，不能以147受控适配器旅程改写该失败。本任务不再收费调用，完整自然演绎仍未验证。模型真正受约束schema适配（需核实生产provider支持）、旧unassessed恢复、6历史unknown旧档以及关系双方确认/整体目标完成资格仍按主表保留。

最终本地check3309/build通过、原服务PG7通过；生产沿用已核实91迁移，未改SQL/权限/任务队列。待业务提交READY与公网记录。

## 实际上线收口

业务31c873271d603641e7374922f604eb2249a1d0c7 / dpl_DMX6nqxxH9QTzNzFemNT4BqtEURa正式Nu别名精确READY。check3309/build/PG7通过；公网health/workbench/published200、匿名works401；原旧合成v7/2人物/9消息/paused保留。0新增模型；145六次已闭账、测试档暂停/0unknown，147真实模型表现仍未验证，不能宣称完整自然演绎已通过。
