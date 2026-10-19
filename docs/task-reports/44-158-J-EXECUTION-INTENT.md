# 44-158-J — 非媒体紧凑执行意图编译器

负责人 codex-opening-fix-intent158j；基线 bff2f834；独立 execution-intent158-j 工作树。root 唯一集成人，负责 wire v3 schema/prompt/decoder 公共接线。本提交仅三个 NEW 文件，不改变数据库、模型协议、公共源或部署。

## 导出与职责

- NativeExecutionIntentSchema / NativeExecutionIntentsSchema：严格单项/最多16项。ref局部字符串；goal仅new summary/sourceIds或existing id；plan summary/sourceIds/可选supersedesPlanId；action保留显式能力、对象、参数数组、原AgentProposalSchema条件和依赖。
- nativeExecutionIntentIds(context,ref)：基于worldId/actorId/input.sourceId/ref的SHA256，生成execution-goal/plan/action稳定ID；与时钟/版本推进无关，不按数组顺序重命名。
- compileNpcExecutionIntents(context,raw)：返回 `{executions, actionIdsByRef}`。参数数组仅机械转换为原对象，参数重复拒绝。仅绑定原Execution标识，不执行、不写state、不判断人物意愿、不填时间地点、不产生result或完成状态。

## 约束

来源组全部合法且唯一，均含当前input；condition带来源的成员也须合法。existing goal只能来自viewState；新goal/plan/action保留ID不得碰撞真实state中的隐藏ID；重复ref拒绝。supersedes仅同goal可见旧plan，不能self。dependsOn和result条件只可引用已有可见action，不支持局部ref猜测或临时动作依赖；责任引用只可见既有responsibility。能力必须advertised且非media。支持动作最终内核资格、对象权限、状态转换仍由原kernel验证，不扩展授权。

## 接线注意

root需在v3 decoder调用本编译器，再将actionIdsByRef用于明确的statement局部引用绑定。已有Execution schema的plan需允许supersedesPlanId并沿原plan逻辑传递，不能吞掉。旧v1/v2回执保持原解码路径，不改写保护响应或重试unknown。

## 必要验证

`node --experimental-strip-types --test tests/npc-execution-intent.test.ts`：10/10通过。覆盖原ProposalSchema兼容/无突变、稳定身份、重复ref/伪result拒绝、合法当前来源、能力/参数、可见goal与同goal替换、隐藏ID冲突、真实既有依赖和条件/责任隔离。

npx tsc --noEmit通过；git diff --check通过。无SQL/权限/队列变更，不重复跑全套或数据库测试。本模块尚未公共接线，不宣称真实模型动作已成功；由root集成部署与必要真实验收。

严格provider的supersedesPlanId:null仅在编译前移除，导出schema保持普通optional并可转JSON schema；不解释其他null或缺失内容。局部ref不可使用execution:/media:保留依赖命名空间，statement通过execution:<ref>由root明确绑定。
