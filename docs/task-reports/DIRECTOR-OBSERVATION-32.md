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
