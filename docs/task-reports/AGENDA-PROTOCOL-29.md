# AGENDA-PROTOCOL-29：自主复盘协议精简

2026-11-03，root唯一集成。基于de3021f0，协议子任务65af6f45已集成为f2597811。仅本地运行，不部署生产。

## 修改与根因

旧agendaReview.decision要求quiet/update_plan/contact，分别与statements、planIntents等实际内容互相校验。无台词的合法即时自身行动无法进入任何分类；有行为数据又要求重复分类，制造不必要的无效输出。

当前npc-wire-v17删除decision，只保留reason、basisSourceIds。说话用statements，实际执行用executions，持续安排用planIntents。没有新增业务字段、表、调度旁路或付费重试。原来源/能力/依赖与内核执行仍生效；v16及更早保存响应按原协议解析，不修改历史付费结果。

root模型说明更新npc-agent-v85-single-agenda-intent。六处测试当前schema版本断言同步v17，历史v16兼容夹具保留。

## 实际证据

- 协议子任务25/25；root协议与模型聚焦75/75。
- 首轮check4177项中4171通过、6失败，均为当前schema期待v16；未放宽任何行为断言。
- npm run build通过。3218/3219重新启动，同一构建，health均ok；queue/proactive报告ready，连接原本地克隆，旧任务排除列表未改。
- 一次真实模型隔离评估：复用已成功完成的历史snapshot f489d4d0-9859-4d23-a95c-eb5240cf7273，不重试unknown。6287ms，v17解析通过，statements/plans/actions/responsibilities均为0，continuation=no_current_intent。0世界写入。
- 模型仍以旧出差/账目等问题等待玩家答复为由选择安静。不能宣称新协议已经带来持续推进；这次结果证明协议接受，不证明演绎成功。
- 启动后原2fb世界调度仍报告no_candidates。另一4953世界有actor_local候选被stale_projection拦截；需按原付费记录核对，不清记录或改身份重买。

## 接续

1. 核查未回答问题的真实有效性及与事件依赖，区分局部等待与全局冻结；交协作Agent只读审计，root整合。
2. 已参与事件无后续安排、导演已评估quiet后的合法重新考虑仍未完整解决。
3. 原档unknown无已保存结果的恢复不能通过自动重试完成；保留记录。
4. 原渣男体验无人输入下持续演绎未验收通过。历史消息、synthetic测试、健康检查都不作为替代证据。

最终npm run check：4177/4177通过，0失败/跳过/todo。build通过；运行PID34371/34372，queue34373，proactive34374。
