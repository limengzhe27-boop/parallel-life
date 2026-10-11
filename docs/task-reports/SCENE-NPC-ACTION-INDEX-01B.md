# SCENE-NPC-ACTION-INDEX-01B

2026-10-12；codex-npc-action-index01b-01a11a84-20261012。
工作树 `.local/worktrees/nar-03`，分支 `codex/scene-npc-action-index-01b`，基线74fee47。

## 实际阻断与范围

根真实v13说明：导演证据阶段已过，但人物输出 `actions.[0].kind:invalid_value`，整轮failed/7045ms，说明未保存，核对旧证据保持；保守预算14/18。未知实际kind，不猜测别名，不把失败改成成功。本批仅内部模型动作格式可靠性，不处理供应商慢响应，也不重做已保存核对。

独占 `scene-planner.ts`、新 `tests/scene-npc-action-index.test.ts` 与本报告。原projection已冻结，公共contract/domain/repo/旧tests/SQL/UI只读。根负责旧格式示例测试适配、PG接线验收、全量check/build及发布；Q独立新增audit测试。

## v14 私有协议

每人物 payload 新增 `allowedActions: {actionIndex:number,matterId:string,kind:'receive_r17'|'inspect_r17'}[]`，本人独享且从0顺序编号，先receive后inspect，仅本轮可选择的有限动作，不表示执行或保存。新增显式 `actionFormat:'indexed-npc-actions-v1'`，严格返回 `{actionFormat,text,actions:[{actionIndex,quote}]}`；索引必须整数0..15且实际槽存在，最多4动作，重复索引拒绝。无槽只可actions=[]；新协议中matterId/kind/actorId混字段、未知format、坏quote/类型均拒绝；不自动回退。无format仍用旧classic严格schema且动作须在本人物实际槽内，旧坏kind/别名仍失败。槽总数超过16也拒绝，不裁剪权限候选。

生成槽位需要attempt、非failed、本人当前实际在场、actorSteps可见且关联同一事项；本轮input/action来源blocked不提供槽。receive仅已验证本轮handed_over候选明确指向本人，或本人获准目击、无blocked input/result/action的已存handed_over指向本人；canonical已received时不再提供。当前handover候选复用原 `resolveSceneStepProgress` 在纯候选世界验证原文、实际观察、接收者与源；此候选不保存、不调用模型、不提前markdone。验证不通过只不给动作许可，原提案仍由最终runtime拒绝；不删坏steps或invalid actions伪成功。

inspect仅同一合法handover或当前完整句明确向本人请求检查R17/接头；否定/未来/引用/其他对象及仅顺便提及本人不授予许可，canonical已有receiver_inspected不重复。canonical已完成仅用于关闭槽，不向人物额外披露隐藏证据。无handover/明确检查请求的普通核对或说明槽为空，提示不提供可照抄的动作示例。

新wire只绑定原有世界matterId/kind与本次独立人物actorId；quote仍是同次text精确原文。旧 `isUnexecutedQuote`、实际动作语句/接收regex、源/receiver/whole-completion运行时保持不变。两个新增安全诊断固定为 `scene_npc_action:action_index` / `duplicate_index`；schema诊断只显示白名单字段和错误码，不输出返回原文/坏值/人名。

## 验证与限制

- 新30测试在基线14pass/16fail；补三要害与真正聚合终点后最终34基线14pass/20fail，修复34全部通过，0skip/TODO。
- 正例：普通说明无动作成功返回、实际handover索引接收、明确请求只检查、已存handed_over后续接收、全实际玩家步骤+独立接收经原领域得到整体完成且玩家outcome仍partial，输入世界不变。
- 反例：非法/不存在index、混legacy字段、未知format/旧坏kind/无format索引、duplicate、无槽伪收件、未附动作的已完成台词、未来/否定/错对象/非原文、blocked来源与未获准目击、错receiver、多接收者不能借索引、已完成不重做。
- 最终相关4文件102项：101pass、1fail；唯一失败旧 `scene-step-planner.test.ts:637` 强制要求旧kind/matterId双示例，与新格式有意不兼容，由根适配，不改原断言范围冒称全过。旧current/saved提示原语义及原runtime拒绝点保留。
- 类型通过，332文件边界通过，格式及diff检查通过。0真实模型/图片/PG/生产/端口/浏览器；按根要求未跑全量check/build。

私有协议兼容不证明真实供应商会遵守新格式、对白自然或完整体验已通过。真实新批预算由根唯一维护，当前最多剩4调用，不追加、不重试unknown、不沿用旧预算；next/private可能本批未覆盖。

待根/Q精确冻结复验、真实本地PG适配器保存、全量check/build、READY/public；保持源码冻结后释放根。人类旧PEOPLE-02授权已有交付，不重复领。
