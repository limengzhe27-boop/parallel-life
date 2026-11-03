# EPISODE-LIFECYCLE-AUDIT-26

负责人 wake_identity24；集成人 root。2026-11-03，只读原本地 2fb97a4a-7282-4d75-8a5c-67faf44a3188 存档 v351。仅报告，无业务代码修改、模型调用、原档写入或进程操作。

## 已核实分类

| 已存状态 | 数量 | 请求/回执/尝试核对 | 调度含义 |
|---|---:|---|---|
| proposed，全部 quiet | 18 | consumed，quiet，presented_message_ids 空；committed attempt；现有 readSettledUnpresentedHandoffs 全部认证通过 | 没有本交接的持续工作；不等于故事已经发生或完成 |
| proposed，已付费失败 | 4 | pending；2 stale_discarded + 2 invalid_output，sent/response 已付费；episodeRequestWorkState=paid_terminal | 没有可自动再次购买的旧请求，也不是等待玩家 |
| active，真实等待玩家 | 1 | 舒雅婷 006d84f3…；consumed/engage、2条呈现消息；waiting责任 waitingOn=player，subject 明确指向同 request | 保留该责任，不能通过定时强制结束 |
| active，无已存关联计划责任 | 1 | 刘胜男 ebc976e9…；consumed/engage、2条呈现消息；hasHandoffFollowup=false；plans/responsibilities空 | 已参与不等于已有下一步，需本人任务续接链路 |

合计24 episodes；22 proposed；2 active。0 decline，0绑定请求的 unknown，0 available/in_flight pending。18 quiet 中1条同时被 readInvalidAuthoredEpisodeIds 判为旧错误分配，不能重复计数。四名人物的历史 unknown/basis 围栏与这4条 episode 请求失败属于不同身份，不应混为同一批重试。

4条 paid_terminal episode：26d10ea0…（刘胜男，stale）、3d3055d9…（舒雅婷，stale）、85e8b659…（舒雅婷，invalid）、8c840919…（舒雅婷，invalid）。

两个 active 的当前 open questions 均不能按 sourceId 直接绑定到原交接 inputReceipt/episode-intent；因此不能用“这个人物有open问题”推断该事件整体正在等玩家。舒雅婷有明确 request subject 的责任，证据独立成立。

## 实际消费者与不一致

- `agent-episode-dispatch-eligibility.ts:episodeRequestWorkState` 区分 available/in_flight/paid_terminal；unknown保留in_flight，禁止自动重买。
- `episode-pending-work-repository.ts:hasPendingEpisodeWork` 过滤invalid分配，paid_terminal不算可执行pending。本档此入口没有待派发工作。
- `settled-episode-handoff-read.ts:readSettledUnpresentedHandoffs` 验证回执、实际事件、command、参与者完整性及关联状态；本档18 quiet符合已安静处理且无后续。
- `narrative-wake-repository.ts:outstanding` 另用所有active/proposed状态直接计工作；虽排除invalid，却没扣除上述17合法settled quiet和4 paid_terminal。状态proposed在这里被解释为尚有工作，与dispatch分类不一致。
- 同一文件pending_player_work查询把所有人物open问题和open/waiting责任计入，没按候选或waitingOn限定。
- `director-opportunity-admission.ts` 已有独立新事实、资格变化、释放、settled handoff准入；因此上述不一致不等于所有新机会都被挡。已有settled handoff还提供有限库存机会，paidReviewContexts继续防同上下文重买。
- `authored-event-eligibility-repository.ts:occupiedEventKeys` 保留proposed/active/withdrawn作者身份去重。这是防重复创作身份，不能直接套用“无可执行工作”去释放同事件重新购买。

## 最小统一修复建议

统一“调度工作是否仍存在”的读取语义，复用现有分类，不新增表或持久状态：

1. proposed仅在存在合法available/in_flight请求，或已认证的关联持续责任/计划时占工作负载。
2. 全员quiet且无关联后续、所有请求paid_terminal不计执行负载；原episode/request/receipt/status保持历史原样，原付费身份依然阻止重买。
3. active不可仅凭无计划直接判完成；对明确waitingOn=player责任保留等待。已engage但没有下一步的本人应进入既有事件计划续接流程，由本人提出计划，root负责。
4. 作者事件身份去重与运行负载分开：不能从occupiedEventKeys删除quiet/失败身份，让同事件伪装成新事件。
5. 相关新事实/新资格可启新合法窗口，原unknown仍不可自动重买；仅时钟、安静和世界版本增长不构成新授权。

本报告只证明分类不一致与一个active缺后续；未验证该修复单独能让本档产生新消息。存档六人均有open问题且有真实玩家等待责任，改proposed负载后仍需按具体候选关联审查，不能承诺全盘解锁。

## 必要回归建议

一个真实PG夹具覆盖quiet无后续、quiet有等待责任、paid_terminal、unknown、active等待玩家、active无计划六态；证明负载变化不重买旧请求，不改作者身份去重，不把quiet当剧情完成。不要重复已通过全量测试。现阶段报告待root审阅，不宣称已实施。
