# PROACTIVE-CONTINUITY-24：持续事项与唤醒边界

root-proactive24唯一集成，wake_identity24独立复现/PG测试；基线3a3e7567。仅本地克隆，保留原世界和进度，不部署生产。

## 确认的断点与修改

1. **过期unknown重新进入原候选。** 4953世界command 5e4170b7-d584-84f1-a36a-65caba607758已发送、无response、unknown_after_send，原版本533。租约过期后解除人物级锁是正确的，但候选级wrap漏了unknown，导致用535再次accept原command并COMMAND_CONFLICT。现在只封住同wake资源；原receipt/attempt不变，其它人物可继续。不放宽hash、不重新购买。
2. **本人已接受事件在后续丢失说明。** 原2fb刘胜男的episodeFollowUps为engage、followUp=none、无goal/plan，episode-intent观察却只有32字通用占位。恢复本人未结束engage/defer/need_information的已认证原说明，沿用plan观察和private_strategy来源；当前示例737字。私聊可读，群/现场仍隐藏；quiet/decline/terminal不作为当前任务。生命周期读取同步使用共享事件真实终态，避免已结束事件恢复成当前任务。
3. **参与请求消费与事件结束混淆。** 替换自主复盘规则中“不能重新参与已消费请求”的模糊句：已接手未结束事件承接下一步，不重新做参与选择；拒绝不重开，等待只限制依赖答复的步骤。prompt v84，不增加调用阶段/业务字段，也不要求必须发言。

## 验证

- unknown-wake-scope24真实PG：原代码复现COMMAND_CONFLICT，新代码1/1；原租约自然到期，B独立工作继续，A模型次数不增、原回执不变。测试5156b5b4集成自304a559a。
- 原2fb当前私聊快照恢复说明并通过原来源认证；篡改正文、群聊、decline、terminal四项拒绝，0模型/数据写。
- check4166/4166；最终模型及brief聚焦61/61；build通过。
- 本地最终端口3218/3219 PID19795/19796、queue19797、proactive19798。排除410旧任务/251旧outbox保留。
- 实际常驻调度，无玩家输入/force/手工补消息：12:25:53请求f8235670…携带737字说明，完整提交quiet；12:31:35请求f489d4d0…使用v84，再次完整quiet，无新计划/消息。因此**持续主动推进体验未通过**。保留真实判断，不以“worker ready”或模型成功冒充剧情完成。
- 4953后续日志为同candidate资源blocked，不再COMMAND_CONFLICT；未知原调用未重买。

## 仍未完成

- 四个人物受到历史paidContinuationBases围栏：其中有unknown，不能统一清空或重买。正在核对失败之后完整新玩家对话应产生独立上下文、而不改任务字段时的边界。
- 人物当前都无有效计划，刘胜男收到原说明仍quiet；复盘空转和重复问题仍需按实际原因处理，未强制建立计划/发消息。
- 尚未证明事件库连续下一阶段、多人物长时间自主推进和真实手机通知体验。
- 本批修复增加对仍有效本人事件说明的定向读取；没有宣称请求更少或聊天耗时改善。

## 本轮继续集成（2026-11-02）

- 集成8e9672a0（来源ea4d08d1）：paidContinuationBases不再跨后续认证完整玩家私聊永久生效；用现有输入接受时间/模型发送时间/版本/人物revision判定，不新增字段。只允许独立新窗口，原unknown不重买。
- root复跑新旅程及own-agenda-window05真实PG13/13，check4166/4166。
- 四名旧阻断人物目前没有满足此条件的新玩家输入，不能用本修复宣称已解封。持续自主推进仍未通过；另查导演全局pending_player_work对独立机会的影响。
