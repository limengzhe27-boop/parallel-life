# 44-162 开场信息纯边界验收与续行动条件接线建议

负责人codex-agent-continuation162；root唯一集成。基线603a9dca，独立分支codex/opening-context162-tests。仅新增测试与本报告；不修改公共实现、SQL、生产或模型。

## 验证

针对root集成树当时最新、尚未提交的narrative-opening-context.ts（kind=opening_information，receivedOpeningInformation返回report），只在独立树临时复制待测内容，跑完还原公共文件；提交不包含该模块。

4项纯测试通过，TypeScript通过：
- 必须同时命中授权事件原文与本人模块原文；跨人物私有模块、非参与者、错字段、重复premise、错reviewKey、物理动作kind拒绝。
- 无授权、源hash/nodehash/policy变动、非opening与未解析参与者拒绝。
- 旧无review保护；defer无premise合法，defer携带premise与空confirm拒绝。
- 信息包装明确assertion=report、executionEvidence=false；fact仅本人可见。apply只更新世界version/time，不增加世界事实、消息、约定或玩家行动；原state不变。跨world、乱版本、非法时刻、旧epoch拒绝。

这些测试只证明确定性边界，不证明开场自然表现，也不替代来源认证事务、一次性receipt及真实模型验收。

## continuation.conditions最小接线建议（只读）

现有own-agenda authority同basisHash gate正确阻止quiet重复付费，但纯时刻条件成熟不改变个人state，因此不能依靠own-agenda复盘接续。

建议在原agent-schedule-collectors.ts的actor_plan分支汇入个人continuation条件候选，继续使用authorizedActor、agentConditionsReady、evidence、sourceProofs及consumedCandidateIds。不要新建定时器或独立引擎。

1. 必须先确认continuation原状态与view一致、来源均经认证，并验证引用plan/question仍属于本人。
2. conditions为空不创建候选；仅有至少一组真正成立且有证据的条件时考虑。无依据deadline继续禁止。
3. 若相同条件已由plan.triggers或responsibility.nextCheck产生候选，不再添加重复continuation候选。
4. 候选业务身份由condition内容及实际证据确定。不要使用decidedAt、sourceInputId、actorRevision、worldVersion或basisHash，否则每次quiet自身生成新的授权身份。同一已满足条件即使在后续continuation重复出现，也不能再次收费。
5. 可沿用actor_plan候选通道、原NPC执行/事务和已提交candidate去重；不可直接放宽own-agenda authority。
6. 来源证明与业务身份分开：当前输入receipt可作为本次决策来源，但不能成为同一条件的新变化证据。旧条件重用时应沿用原权威条件源及结果source/hash；若直接复用candidate()全部sourceProofs，要排除仅由quiet自身产生的accepted_input身份差异，或为此候选提供稳定的条件证据投影。
7. 真实新增观察仍从原observation入口触发，不应等待条件复盘窗口；有新result则其resultId/hash改变，可以依法新评估。

待root完成接线、必要集成验证与部署；本包未宣称该条件触发已实现。
