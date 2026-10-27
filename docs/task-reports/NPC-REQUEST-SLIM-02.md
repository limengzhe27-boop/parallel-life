# NPC-REQUEST-SLIM-02 · 项目侧请求准备精简

负责人 `npc-request-slim-20261027`；工作树 `/Users/limengzhe/.codex/worktrees/grok-image-20261023/人生剧本`，分支 `codex/npc-request-slim-20261027`，基线 `5ced5671`。用户最新要求先精简项目，模型及推理参数保持原样。

## 第一块：可独立集成的等价结构清理

1. `npc-agent-model.ts` 两个 WeakMap 收为一个，仅同一快照对象、一次准备/发送生命周期使用，发送时消费。预检查、上下文登记、普通及流式发送共用完整的 `{messages, output}`，输出schema不再在发送时重复生成。原代码只缓存messages，输出schema却重新读取snapshot；已登记的schema hash可能与后来实际发送的schema不一致。本次将两者绑定，不加跨请求缓存或失效管理。
2. 预算检查每轮只重新生成可能变化的payload；固定的system和末条说明提前组装一次。来源元数据直接在唯一wireCatalog序列化，不先递归映射整份sources后删除再组装。
3. `npc-model-protocol.ts` 删除空集合驱动、实际上不修改约束的全schema递归；删除后续requireAll必然覆盖的required临时构造。最终schema与原实现完全相同，解码器及内核不变。

**没有改写或删除人物说明、历史、事件、责任、来源内容。** 没有新表/业务字段、模型调用、SQL、services、UI或端口改动。未混入未通过速度验收的13f11214。当前schema剩余可通用去重的收益仅数百字节，不为此添加新的通用遍历器；保留项目已有且已实际使用的$defs。

## 证据

- 两条保存的李之之请求：完整messages（含所有说明）、output schema、maxTokens与冻结旧实现深比较完全相等；原请求hash保持604ced84…及ff5bcd3a…，输入字节仍为77,869及78,652。没有损失人物原文或记忆，没有改变模型要做的判断。
- 同一保存输入离线运行，交替旧/新顺序，各预热10轮后每版本60次。仅测validate→describe→decide本地准备，不含DB/网络/模型：第一条中位数5.967→4.320ms，第二条5.761→4.317ms；p95分别7.676→5.465ms及7.848→5.525ms。只是毫秒级重复计算减少，**不宣称解决几十秒模型等待**。
- 新增两项回归：预检查后不再读取snapshot重新构建协议；流式实际schema与已登记hash一致。将完整旧模型文件恢复后，两项均失败；当前实现通过。覆盖正常、流式真实入口，非新增付费调用。
- 聚焦63项通过；`npm run check`边界/类型/4,139项测试全部通过；`npm run build`通过。无SQL/权限/队列变更，不需要新增真实库fixture。

私有证据位于本树`.local/npc-request-slim-20261027/`，包括纯等价/计时脚本、旧回归失败记录及检查日志。0付费请求、0生图、0原世界写入。

## 集成及接续

本块应独立提交，由唯一集成人审查合main并更新3218/3219；未运行最新版本前不标交付完成。第二块如进行，只另一个提交删除与当前schema完全重复的纯JSON形状样例，逐项列映射；保留所有独有语义，不重写人物规则，也不把本块毫秒收益说成模型提速。

### 第一块主线集成与运行（root，2026-10-27）

已审查并集成为da0efcf3。主目录check通过4139项、build通过；按同一配置生成不可变build38，3218/3219及队列/主动调度两个worker已更新。两端健康200，原4953酒店现场读取200、已保存工作人员回复仍在，没有重发用户消息或新增付费探针。PID分别70483/70484/70485/70486，记录位于被忽略.local/local-play/processes-build38.json；日志request-slim-check38.log、request-slim-build38.log。没有改变模型或推理参数、没有生产部署。第二块WIRE样例精简仍为独立待审范围，不在本次交付中。原长期主动推进遗留项不因本次毫秒级构建优化而视为解决。
## 第二块：独立删除7处纯字段形状示例

本块不混入第一块提交，也不沿用13f人物说明改写。`SYSTEM`整个原文逐字不变；只在WIRE段删除下表重复字段罗列，并保留其中原有的语义说明。使用既有promptVersion标识本次文字变更为`npc-agent-v74-schema-guided-shapes`；wire协议、schema和解码器不变，不新增字段。

| 删除的重复样例 | 已由实际输出schema提供的字段 | 仍保留的独有语义 |
|---|---|---|
| 持续executions完整对象形状 | executions[].ref/goal/plan/action及其子字段 | 本人可见旧目标、同目标supersedesPlanId、可省略数组默认空、机械编号/来源追加不产生权限、不可重复建计划、成功台词依赖 |
| create对象字段罗列 | changes.planIntents create分支 | goal省略时由summary建目标；局部编号由schema提供，不能手编真实ID |
| replace对象字段罗列 | 同上replace分支 | 本人原planId、保留旧目标并记录替换 |
| update对象字段罗列 | 同上update分支 | 沿原计划；省略下一步保持原等待/状态 |
| close对象字段罗列 | 同上close分支 | 只关闭计划，不完成目标或外部行动 |
| responsibilities对象字段/枚举罗列 | changes.responsibilities项 | 旧来源完整保留、回答后转本人下一步、不伪造fulfilled/回执、拒绝/暂缓及来源规则完整保留 |
| statements对象字段罗列 | statements项 | 真正提问才创建问题、来源逐字要求、focus keep/clear/set与null语义完整保留 |

媒体准备/投递、inputInterpretation、focusChange、条件等样例中仍有独有语义，均保留，不为了缩短全部删除。没有裁切人物五维或历史。原两保存输入与schema离线比较：除promptVersion和7项映射后的system文字外，完整payload、末条原话、output schema、maxTokens相等。每条序列化消息减少829字节（约1%）：77,869→77,040、78,652→77,823；不宣称因此节省模型等待。

本块88项聚焦协议/模型/计划/执行/焦点测试通过，类型检查通过；无付费探针。由集成人独立审查是否纳入后续构建，不把第一块正在运行的版本说成已包含本块。

### 第二块主线集成与运行（root，2026-10-27）

逐项核对映射后独立集成为fd777f0c，未混入13f。主目录check4139/4139及build通过；build39已更新3218/3219、队列worker与主动worker（PID72650/72651/72652/72653）。两端health200，原4953酒店现场读取200且工作人员旧回复保留。日志request-slim-check39.log、request-slim-build39.log及processes-build39.json均在忽略目录。无UI/SQL/模型参数改动；无需重复购买真实探针来证明这829字节删除。仅完成此限定结构精简，不声明真实模型更快或长期主动链路全部完成。
