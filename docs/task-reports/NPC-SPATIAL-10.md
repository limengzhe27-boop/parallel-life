# NPC-SPATIAL-10

基线82512596，独立codex/npc-spatial10。从只读诊断扩展为root批准的统一空间初始化候选实现。公共服务协调/模型/root原档验收由root负责。

## 原档只读证据

应用角色SET TRANSACTION READ ONLY，4953取证v517、2fb v209：两档6名NPC均unknown/placeId=null/sourceVersion0；npc_journeys=0，initialPositions/departures/arrival事件=0；当前scene只有玩家。两档不可变initial actors及world_builds.contacts均未声明initialPlaceId，不能把职业、办公室名称或未来事件scene当历史在场。

4953除刘胜男较早保存snapshot外，其余5名最近受保护snapshot均有initialPlacement、16个合法地点、position.establish能力；2fb六人也有。模型仍只quiet/await_response/no_current_intent、未提交位置动作。这不是通用allowedActions漏掉工具，而是未知空间没有明确独立工作，泛议程可以无限忽略该任务。

4953刘胜男旧unknown d522ffe4…源为player/private，sent2026-10-23T08:44:48.920Z，lease08:48:48.676Z过期；无response/hash，expectedActorRevision21=当前21，world基线99。不能伪称已有可恢复完整结果或当作自动wake清除。证据已交root，子任务未修改旧attempt/用户原消息。

## 本提交实现

agent-schedule-collectors在统一候选集合增加initial_position注册分支（仅已有initialPlacement时注册），实际candidate沿原actor_local/native own-condition通道，不增加source枚举、表或字段。

资格同时要求本人private渠道、实际unknown0来源、合法initialPlacement policy/places、原position.establish能力、本人definition/source均存在。已知/在途/缺policy/缺工具不生成。initialPlacement原reader只有无journey才提供，故不重置既有行程。

稳定candidateId只绑定world/actor/既有policy，与当前时间、世界版本、actor revision及definition改动无关。导出initialPositionWorkCandidateId给root廉价入口探测复用。既有原wake command/receipt/attempt就是评估去重凭据；quiet成功后不再购买同一空间工作，已付费失败/unknown仍沿原保护，不新建第二个重试源。所有活动与unknown调用保留actor blocker，root另行收敛已过期执行权，不由本任务绕过。

wakeCue明确让人物结合本人私有设定、已确认安排、当地时间，从合法地点选择此刻合理活动地点并position.establish。不倒写初始历史，不从未来scene推到场，不为了玩家当前位置把人硬塞进去。允许无消息；确无合理依据可quiet，原真实响应保留，未虚构理由或位置。priority45，requiresCoordination=false，不受普通社交suppressLocalInitiative压制。

## 原链路核对/未重复实现

- 作者initialPlaceKey→publication-genesis world.actors/opening.contacts.initialPlaceId→0087版本0位置：已有链路完整。未来新建应由作者或生成流程明确选择，但不可从未声明的旧稿回填历史。
- NPC travel.begin→npc_journeys→advance.commitDueAgentArrival→实际位置→joinCurrentAgentScene→world-awareness已接通；本两档无journey，并非到期arrival失效。
- 私聊只读selfPosition及有来源knowledge，Director可读全局actual-position；scenePresence依据真实位置/行程/已保存区间，不因地点名认定人物在场。新position.establish已有原kernel入场helper，不广播给无观察者。
- 通用旧档若完全缺version0位置行，原read fallback unknown没有版本/来源，不获initialPlacement；应由显式迁移/准入事务从不可变创世声明补齐（有真实>0位置不覆盖），不可在context读时写。本两档已有完整unknown0行，不是此次实际根因。

## root必须接续的服务入口

原服务generic wake已机械携带candidate.wakeCue；原通道PG实际验证此cue到模型并执行。还需root优先级协调：dispatchPendingAgentEpisode在collect之前多处直接return（原约516/791），不能让重复pending把空间工作永远压住；在actor snapshots组装后独立执行initial_position且未blocked候选，不再要求Director审批。

phone-entry-probe在pendingDirector分支仅认agenda/plans/media，通用fallback也可能因pendingDirector保持pending。root需使用稳定空间candidate身份给未评估空间工作廉价入口检查，不把检查等同模型授权。本提交不擅改服务/probe。

## 验证

54/54聚焦通过：含原collector回归、3项专属资格/稳定身份/unknown blocker unit，以及2项真实PG原npcAgentAdvanceServices.advanceIfEnabled→原native wake→原模型适配→原kernel。

- 确立地点：人物收到空间cue，调用一次position.establish，actual sourceVersion>0、0聊天消息、0他人位置认知；第二次advance不再执行空间工作。
- quiet：真实committed评估一次后，第二次advance不再购买此candidate，即使actual仍unknown。
- 单元证明普通版本/时间/definition变化不造新候选，known/in_transit/失效来源不生成，活动/unknown不重买。

typecheck0、boundaries通过。0商业模型/原档写/用户端口变化；真实PG仅独立55676测试库。未把受控测试等同原档6人真实体验。旧自然表达、长期移动意图与root服务入口最终联调仍需root如实验收。
