# 44-154-H — pending Director 下原手机入口的独立调度检查

负责人 codex-opening-fix-phone154h；唯一集成人root。独立phone-pending154-h/codex/phone-pending154-h；基线F+G 2b11af07。仅改agent-phone-entry-probe.ts，新增专属PG测试和本文；未改advance/资格解释/公共契约/SQL/模型/生产配置。待集成。

## 变更

原probe在任一pendingDirector存在时直接pending，导致B已允许的“全局协调未知但独立NPC合法工作可运行”无法从真实手机入口获得检查机会。

保留原raw NPC、episode、attention、手动暂停和权限边界。pending Director中当前版本、有效lease的response_received仍优先返回原director_raw。其他reserved/request_sent/unknown情况下：

- 调用F同一个source-backed grant读取器确认本人未消费agenda资格，不复制消费/付费判断。
- 对已有计划只发一次稳定便宜scheduler检查信号，既不认定计划可执行，也不解释其条件和来源；最终仍由原collector/scheduleAgents/runNpcAgent判断。本人已有active/unknown尝试不提供此意图cue。
- key使用pending Director身份/状态、稳定grant IDs、计划/目标/动作的实际语义，不含普通tick、worldVersion、actor_revision或随机数。成功quiet带来普通版本变化不会产生新key。
- 无grant/计划意图仍pending。probe不调用模型、不写状态、不清除或重试Director。每次advance仍遵守原最多一人物。

## 必要真实PG证据

独占本地55631，原Director runner制造明确合成unknown；原phone probe → 原advance → 原NPC runner/kernel真实提交。模型都是受控测试适配器，无商业调用。

5个子场景+父测试，6/6通过：

1. unknown Director保持原attempt/responseHash/付费请求次数不变，其他NPC合法初始化可quiet提交；无消息、消费后probe回pending，刷新不重买。
2. 合法既有plan只有稳定cheap cue，quiet提交后的普通revision/worldVersion变化不改变key；原候选已消费不再购买。
3. 无独立意图返回pending，原advance即使被检查也不调用NPC或Director替代模型。
4. director_raw优先；reserved/sent只产生cheap检查，不改其状态。
5. 原真实可见联系人来源下conversation focus仍deferred；正常退出交谈再手动暂停仍deferred。

npx tsc --noEmit、check:boundaries（641文件）、git diff --check通过。未全量重复check/build。PG完成后停止。

## 明确限制与独立发现

- H不是分钟due执行器。若时间由未满足变成满足，而计划实际语义完全没变，稳定key不会仅因tick变化再次触发；这应由154后续due条件索引解决，未用时间随机key绕过。
- plan cue是有界cheap机会，不是资格认证。无实际可执行候选时可能仍保持pending/原unknown提示，但零模型；不能宣称此cue本身已经执行行动或解决全部后台调度。
- 测试发现原clock-repository.ts setClock(paused:true)在现存conversation focus下更新activity.mode为away却不清focus，触发clock_activity_focus_shape约束。已明确交root另行修复；H未改clock源码。测试通过原activity接口先结束交谈，再独立验证暂停guard，没有假装该原缺陷已解决。
- 尚未部署/公网/真实模型验收；root统一集成后才能最终完成。
