# 44-146-EPISODE-WAIT-REVIEW-Q

负责人codex-ma44-146-wait-q；root限定只读，待验收。独立episode-wait146-q/codex/episode-wait146-q自8c979f98；仅本报告与主表本人行/镜像。144及所有公共源冻结，0模型/生产/测试/SQL/部署。145真实need_information但空状态来自root报告，本线程未查生产原文，不另称独立实模证据。

## 当前语义与可复用接点

1. domain/episode-participation-lifecycle.ts（94）已经从原request+真实decision+已授权state投影，不新建另一生命周期。约110起通过episode-intent:requestId来源、关联goal/plan，或responsibility.subject={kind:request,id:requestId}/{kind:episode,id:episodeId}关联本人后续。约169起只把非空、实际满足的plan.triggers/responsibility.nextCheck算重评依据；约180起有active/deferred goal或active/waiting/blocked plan或open/waiting/deferred责任→followUp=open，无条目→none；terminal只指已有本人条目，不是shared episode完成。
2. infrastructure/episode-lifecycle-repository.ts读取consumed request及真实receipt/committed attempt/world event/command，校验state.episodeParticipations与原choice/reason/source逐值对应；在已授权来源下读真实结果，再用原agentConditionsReady生成readyPlanIds/readyResponsibilityIds。它不是通过receipt.choice单独猜未来义务。
3. application/agent-schedule-collectors.ts现有planReconsiderations及responsibilities/episodeResults路径可用：已绑定本人条目、实际条件/真实邀请答复才产生稳定重考候选；空条件不因时钟/阅读自动付费。140普通有来源trigger接线已存在；无条目则没有凭空的待办。
4. 原agent-questions/statement.requestsPlayerReply与questionForResponsibilityId可以把实际发出的问题绑定本人责任；replyAssessments区分answer/拒答/暂缓/无关/不确定，不是邀约接受。原玩家私聊本来就调用同一NPC，可在明确回答时更新既有责任，不必再先付一次独立催问。

因此need_information receipt成功保存但六数组空，当前只证明“本人考虑后需要信息”，没有可追踪等待对象和条件；consumed不是完成，但followUp=none后没有执行接点。这与94规则一致，是缺同次本人后续提案，不宜把94全部重写或把receipt强改成active/fulfilled。

## 具体最小方案（root统一实现）

A. 在当前同一次NPC传输/输入协议区分choice和follow-up：need_information/defer可明确waitTarget=player/self/world/undetermined，缺什么信息、可引用的既有责任/计划/问题；这些由NPC依据授权材料决定，不能从reason关键词自动解析。服务器仅校验/绑定真实requestId、本人actor、source，与现有canonical proposal合并，不能自行发明玩家承诺或下一步。

B. 确实等玩家澄清时，同次提出本人责任subject={kind:request,id:当前真实requestId}、status=waiting、waitingOn=player、summary说明待确认事项、sourceIds含当前input及实际可读episode-intent依据（若该提示未获授权，不伪造source）。如果确实向玩家发问，用该次statement.requestsPlayerReply=true并questionForResponsibilityId=该责任id，原内核绑定实际成功消息；没有实际发问不得伪造question/messageId。这不是强制所有need_information都说话，已有真实待回应问题可引用复用，无适当表达可以选择无对白并如实暴露“等待对象未明确/未提出问题”，不能UI写“已向玩家询问”。

C. 不知道未来source时，不填未来observation source或假questionId，不用本轮input作永远已满足的nextCheck触发无限重考。可先waiting且nextCheck=[]，其意义是仅等待玩家原正常输入，不主动定时催问；收到玩家真实相关回复后，原NPC回合结合既有问题/责任判断answer/拒答/暂缓/不相关并提出更新，沿原source/quote/request revision验证。真实answer不自动等于同意/赴约/任务完成；无关消息保留等待不买额外协调回合。

D. defer有明确已授权条件时沿现有plan.triggers/responsibility.nextCheck，原条件解释器验证源与时间/结果/本人位置；没有明确条件就blocked/waiting+具体missing或本人暂缓责任，诚实无自动唤醒，不补统一5分钟、假deadline或“明天再问”。self/world等待须明确对应本人可用行动或真实可观察证据；缺能力只说明受阻，不从台词制造动作。

E. quiet没有待办/明确不参与时允许followUp=none，不要求造goal/plan/问题，不一律解释为等待玩家。quiet若本人保留既有安排，继续读取原条目即可，不复制新责任。defer/need_information在模型声明仍有后续义务时，协议与原kernel应确保有效关联条目或明确无法决定等待对象的状态；不要把choice分类本身当强制创建责任的许可。

F. 原consumed receipt和初次choice保留，禁止把同一请求改回pending自动重买或把quiet改为engage。后续通过原plan/responsibility/questions更新继续，原kernel当前禁止同一episodeParticipation id再次输出episodeDecision；不要用重复同request决策绕它。若确需改人物参与立场，要root明确设计revision/新来源与原receipt历史，不在本批静默重写既有choice。open/terminal只表示本人安排，不变成shared事件成功。

G. 后台/状态投影区分“已考虑、等待玩家实际问题、条件待满足、等待对象未明确、暂不参与”；当前没有条目或消息证据时不能显示“正在等玩家回答/已发邀约”。这是root既有runtime-status投影的局部补充，不新建后台队列或第二状态源。未获作者本人意图时可need_information，但不能向NPC广播导演description/audit/其他人秘密来填补；沿原readActorEpisodeIntents有限未来提示权限链。

## 必要负例与聚焦验证建议

- need_information+真实waiting责任但无statement：不得伪造已发送问题；无时钟自动call，无原问题时UI如实未问。
- 明确对玩家发问→原消息/question/责任同事务；玩家无关回复、换话题、拒答或暂缓不能自动变accepted/fulfilled；真正回答依原source/quote更新，仍不证明赴约。
- quiet无安排合法；defer无明确日期不生成deadline；同一receipt/重复推进/普通阅读0额外调用；unknown保持不能自动重付。
- world/self等待不得假造外部结果或偷读位置；他人私聊/无权限作者hint不能被用作source；跨owner/actor/request关联拒绝。
- 旧已consume但无条目的need_information不在GET/刷新时自动补责任或重新付费，保历史诚实；后续真实相关输入才可完善本人安排。
- 新传输refs与canonical责任/问题必须一致，错误绑定整轮回滚；旧未修改条目/原player manifest unrelated optional继续兼容。

这些可沿原94纯projection+原NPC服务/真实PG做一条短旅程，不需另引擎、定时模型或第二次抽取。报告未执行测试，不宣称实现、上线或人物实模演绎已通过；root继续开发部署与授权内验收，不需等待本报告才开工。
