# 44-145 真实人物选择与邀约验收：部分通过，6/6已闭账

2026-10-18，codex-root-live145。用户独立授权6次文字模型、1合成草稿、1独立试演，不发布/个人资料/图片。实际创建1草稿/1试演；所有调用经正式Nu原后台试演代理、同一人物runner/kernel，没有手改状态、补日程或预制回复。结束paused=true、0unknown，额度关闭。

## 实际结果

- 2次导演：首已知invalid（空候选却选择actor引用）；确定性限定修复并READY后一次明确retry，作者机会合法committed、shared episode仅proposed，不是假完成。重试HTTP503但数据库证明导演committed、人物未发送；之后原advance仅交付未处理人物，没有重买导演。
- 4次人物：首次coordination明确need_information，真实receipt、actor participation/revision1保存；没有发消息、没有参与active、没有等待项，不能算完整演绎。后3个有明确输入的私聊均invalid_output，未生成成功对白或邀约。第1个重复旧consideration/缺goal/时间错；第2个目标/动作/时间齐全仅漏wire标记；第3个漏传输字段且plan指向动作而actions空，即使补格式也仍INVALID_PLAN_ACTION。
- 本批连续旅程**未通过**：最终world version1、2人物、0投影消息、0实际邀约，机会proposed。不能用代码测试、HTTP读200或人物choice存在声称真实演绎完成。原失败结果不改判、未清空、未自动重买。

## 已由本轮修复并上线

143/144的明确choice与空active计划内核限制、单nextStep传输。cd1f05fa又补人物明确followUp绑定原request等待责任、代码当地整点对照与旧considerationAllowed范围；d347763e允许仅缺wire tag且有独占consideration字段的完整严格wire正文，错protocol/额外字段/缺语义仍拒绝。没有为第3个缺动作的结果补写动作，也未以对白冒充执行。

最终业务d347763e86213491ee25835f5bd3522be9e9b6b8 / dpl_5H6GMBo8EMcCtrWLNLsgBdJc1ahC精确READY/正式别名核实。check3308/build、原服务PG7通过；新增wait责任保存/无假期限/无重复人物调用、无tag合法参与与真实邀约均为受控适配器证据，不代替模型验收。91生产迁移checksum只读一致、107世界保留。公网health/workbench/published200，原旧合成v7/2人物/9消息/paused保持。

## 剩余核心工作

147待开发：将模型本人明确的目标、动作参数与计划下一步收拢为不易分离遗漏的单一执行提案协议，保留原kernel/来源/能力/版本/事务；研究结构化输出适配能力，不再靠不断加提示和付费重试。不得根据“会发邀请”补造动作。实现后新独立授权才能再做真实模型验收。

旧consumed/unassessed和本轮旧need_information无责任状态不追溯补造。6个历史unknown旧世界迁移、关系双方确认与整体目标完成资格仍在既有清单，本轮未完成。146报告已集成，原生命周期可复用，不另建旁路。

## 2026-10-23 真实 NPC 正式邀约生成与接受

用户新授权 6 次文字单窗口，指定先验正式邀约。使用正式域名合成验收世界 `县城黄毛`（`5f296b6e...`），不新建/不发布世界，不手改状态：

1. 先暂停世界，正常手机进入、解锁、微信 → 林悦。
2. 玩家真实输入：“今晚的饭局我会到。你能再发一个明天中午的正式邀约吗？地点你定。”
3. **1 次 `/messages` 模型调用**后，林悦真实回复：“我给你发个明天中午的正式邀约，地点就定我家吧。”
4. 世界 version 206→208，新邀约 `5260bf8a-f82e-41d7-9246-a31b3f8cdfbf`：标题“明天的中午聚餐”，`2026-10-21T04:00Z`（当地 12:00），participant 林悦，地点链接“林悦家”，状态 **proposed**。
5. 手机卡片显示“日程邀约 · 2026-10-21 12:00 / 待回复 / 接受 / 改期 / 拒绝”。
6. 玩家点击“接受”，世界 version→209，`status=confirmed`、`responseVersion=209`；卡片变为“已约好”，提供“前往林悦家 / 查看日程”。

证据：[生成邀约卡片](assets/44-145-formal-invite-proposed.png)、[接受后已约好](assets/44-145-formal-invite-accepted.png)。本轮 1 次文字调用、0 unknown；剩余 5 次不使用，窗口关闭。测试世界已重新暂停，避免确认日程触发后续自动模型调用。

结论：NPC 真实生成正式邀约 → 手机卡片 → 玩家接受 → confirmed 的最小闭环通过。该结果补上了本报告此前“0 实际邀约”的缺口；仍不等于完整剧情/到场/整体目标完成。
