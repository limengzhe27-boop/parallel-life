# DIRECTOR-OBSERVATION-32

## 范围与事实

负责人 agenda-gap-review；独占 npc-agent-advance-services.ts 的单个进入条件、新增 director-observation32.test.ts。本次不改模型、协议、事件资格、付费身份或世界内容。

原2fb经root只读：observedThrough=371、evaluatedThrough=283，但pendingReasons=0。因此本问题不是该存档当前沉默的直接原因；不能以修复本问题宣称原档主动体验已恢复。

## 根因及最小修改

advance 的全局观察变化入口要求 `scheduled.selected.length > 0 && observed.needsEvaluation`。真实变化已记录、没有人物候选、导演常规窗口未到时，观察变化被候选数量短路。

只删除候选数量条件，保留 observed.needsEvaluation；沿原 coordinate、原请求身份、恢复、事务消费 cursor、预算路径执行，不增加周期调用或nonce。

## 本地真实PG证明

合成世界无人物，用于隔离全局调度，不以NPC异常制造无候选：
1. 初次导演quiet后窗口仍未到，无变化重复advance不调用。
2. 原 PostgresWorldSpace.travel 提交真实移动，原观察投影生成pending reason（未直接插入假reason）。
3. 旧代码红灯：调用数1而预期2；新代码绿灯：无候选且窗口未到也处理一次，evaluated cursor=observed，needsEvaluation=false。
4. 刷新不重复调用。
5. 第二次真实travel产生变化，模拟导演调用结果未知；后续advance不重买，状态unknown_after_send，reason仍未消费。

`node --experimental-strip-types --test tests/integration/director-observation32.test.ts`：1/1通过。`npm run typecheck`通过。

0真实模型、0用户档修改、0部署；root负责集成、完整构建及真实体验。该测试验证调度与恢复，不声称验证NPC叙事质量。

## 32 付费身份补充

首版补充测试发现：同一 pending reason 评估 invalid 后，普通 saveNote 原命令增加世界版本，frame hash 改变导致再次调用（4 次而非预期 3 次）。单纯 clock.write 推进在本夹具未复现；报告不把它说成必然重买。

当前修复只适用于无 evaluationCause、无候选、changes 非空的观察入口：以 worldId、engineEpoch、排序后的已认证 changes（含 reason id、eventId、worldVersion、kind、ref）构造稳定 command。不追加fresh/stale nonce，不改周期invalid门禁，不新增表或状态。新增真实 travel reason 后可形成新的独立评估。

更新PG 2/2通过（unknown与invalid分别完整旅程），typecheck通过。均验证原成功cursor消费、无变化不调用、同原因跨时钟及saveNote版本不重买，unknown保留；invalid后新增真实travel调用一次并消费cursor。

范围限制：身份仅绑定snapshot实际提供的changes窗口，沿用原分页/消费机制，不声称后续积压已全部处理。旧部署已经用frameHash购买的历史请求不被改写；新的身份算法本身不能反查旧command是否处理过相同原因，跨旧身份保护尚需集成人决定处理方式。
