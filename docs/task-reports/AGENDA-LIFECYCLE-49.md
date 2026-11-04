# AGENDA-LIFECYCLE-49：长期无候选与已承接任务丢失

root-agenda49 为唯一集成人。延续 PROGRESSION-48；政策/历史位置验证由 proactive43 专属分工完成。状态：核心接线完成并更新本地，原档持续主动演绎验收仍进行中，不能宣称整体完成。

## 实际断点与处理

| 原实现 | 原档证据 | 本轮修改 |
|---|---|---|
| 自主审视 grant 只绑定上次成功 anchor，一次 unknown/failed 可以永久消费该 family | 青青、林白语、舒雅婷、欣欣旧失败 family 与成功 anchor 长期不变；actor-wide lease 放开仍没有新 family | 同一入口采用有预算的周期 grant；原 v1 receipt 仍按原身份恢复，v2 原 receipt 冻结窗口。原未知请求不重买，晚到结果仍走租约、人物修订和依赖检查 |
| 已付费失败不更新 anchor，新周期可能过密 | 独立审查发现未知/无效结果不增加 quiet 退避 | 现有查询派生最近付费时间与成功 anchor 后付费失败计数，沿用 quiet/backoff 与预算，不新增持久状态；未发送不计费失败退避，已提交有意义变更重置 |
| 只认证当前 self-position，旧位置来源被裁剪时连带删掉有效参与与计划 | 刘胜男已 engage 的请求依赖 v223 position.establish，移动后该历史来源缺失；新快照 episodeFollowUps 为空 | 按精确引用读取已成功命令对应的不可变事件，复用 committedAwarenessDelta 认证本人历史位置；仅作 private_strategy 来源，不修改当前位置、presence 或历史 |
| 已 engage 但 followUp=none 且没有工作对象时缺少具体接续候选 | 原档工作危机出差请求已参与，无 goal/plan/responsibility，未进入本人下一步 | 在现有 observation source 收集器提供一次稳定候选，绑定原 request/intent；消费后不因时间、revision 或心跳重建，不重新询问是否参与 |
| 历史 quiet 和旧 continuation 进入当前工作，重复 focus/question | 原档旧“不追问、等他醒了”等决定持续作为当前材料 | quiet 参与历史不放当前工作；只保留 await_condition continuation；wake 复用 conversationProgress，完整问题不重复下发，截断或超窗口问题保留原文；历史不改写 |
| “晚点、休息”一律直到玩家重提才恢复 | SYSTEM.conversationRules 原文可直接确认 | 仅约束玩家实际暂缓范围，依赖答复的步骤等待，独立安排不被冻结；不编造恢复期限 |

## 边界与成本

- 无新增数据库表、列、队列或第二套引擎；reviewAt、lastReviewRealAt 为既有入口的内存计算/读取投影，不是新事实状态。
- 保留 quiet、拒绝、未决与真实执行边界；没有硬编码消息、补消息、清空付费账本、修改玩家选择或人为移动人物。
- 当前 quiet 退避上限 5 分钟，owner/world/actor 预算沿用原配置。窗口身份粒度不是每分钟调用承诺；历史离线窗口不补跑。
- 独立审查确认：一次承接候选身份稳定；历史位置读取保持本人权限、遗忘与当前状态分离。

## 验证

最终 scoped 构建：`.local/build-agenda49-scoped`，模型提示版本 `npc-agent-v94-scoped-review`。

- `npm run check`：4229/4229，含 boundaries/typecheck。
- `npm run build`：通过。
- 原真实 PG own-agenda evidence：16/16；包括旧 unknown 不成为新 anchor、同请求不重新调用、v2 新评估可走原 runner/kernel，以及无效/未知付费结果增加原退避。
- 原真实 PG own-agenda runtime：8/8；预算竞争、CAS、原 raw 恢复零新模型、同窗口 unknown 防重复保留。
- 原真实 PG initial position：5/5；当前 v19 travel.begin 真正出发后，历史位置来源及独立计划仍在，当前位置仍 in_transit；越权、非位置事件、遗忘被拒绝。
- model/progress/collector 聚焦 112 项及 collector 50 项通过。无关旧 semantic-wake 夹具失败仍沿用48报告记录，未宣称整个历史DB套件全绿。

## 原档实际结果与尚未完成

原档为 `2fb97a4a-7282-4d75-8a5c-67faf44a3188`，不是复制世界。

1. 新评估资格已实际恢复，原来长期被失败 family 挡住的人物通过常驻 worker 进入真实模型。
2. v795 只读新快照已重新包含刘胜男原 engage 与原任务说明；v812 自动处理了原任务的唯一下一步候选，但当时模型输出仍为空消息、空计划。不能将 committed 或候选存在当作主动演绎通过。
3. v94 前本小时原档 v2 已提交47次评估，未观察到新主动来信；这是实际空转，应明确记录，不能掩盖。owner48/h预算已到边界，未提高额度、清计数或重跑旧请求。最终版本等待正常新窗口观察。
4. 一次明确授权的只读模型诊断已使用并闭账，结果将“无后续安排/可以安静/不要复述”解读为应安静；它只是模型自报，不是因果定论。后续改写原 agendaReview 为主动判断自己的下一步，仍允许 quiet，不额外串行调用诊断。
5. 3218、队列 worker、主动 worker 已切最终本地运行；3219/Vercel/生产数据库未动。Ego 原任务空间失效；计算机 UI 检查提示 Mac 已锁，当前不能完成原页面通知目视验收，不能用 health200 代替。

后续验收接续点：正常预算窗口下，原档无玩家输入，检查新原始响应、实际消息/计划、真实事件来源和后续条件；如仍 quiet，继续查具体任务/导演阶段反馈，不重买已消费请求。长期连续推进、重复问话质量与手机通知实际呈现仍未全部完成。
