# 44-161-LIVENESS-AUDIT

日期：2026-10-19。负责人 codex-liveness161-audit，root 唯一集成。基线79bddd60，仅只读源代码审查；0生产查询/模型/源码变更/测试。本文不声称已定位本次用户运行的具体失败attempt。

## 已可复用

- 手机5秒轻检查，55秒目标投递窗口预留20秒生成，15秒最短重查；`time-experience-policy.ts`按真实运行期投影的incoming IDs记最后新消息，非作者历史。该部分不应再机械调整轮询来冒充解决。
- 原advance批次maxActors=3/maxModelCalls=6/maxSteps=8，45秒停止启动新工作；每次advanceOne重新读取世界，持久幂等和预算仍在原仓储。同批一次导演，NPC失败可按actor scope隔离。不是固定一次一人。
- own agenda已接原调度。正常成功quiet会成为新私聊anchor，20秒起的指数退避封顶300秒，并有owner/world/actor预算；不是所有quiet永久死亡。
- 事件follow-up已有来源认证、计划与责任条件收集、玩家决定及真实结果；不应新增旁路剧情系统。

## P0：注意力被误用为执行总闸

1. `infrastructure/agent-episode-attention.ts:8-14`：`episodeAttentionAllows`要求没有未知focus，并且没有focus或私聊focus恰好是此NPC。`agent-episode-dispatch-eligibility.ts:66`、`server/npc-agent-episode-dispatch.ts:95-110`在调用人物前使用。用户停留A微信阅读时，B/C的pending event consideration被全部排除；group/scene焦点则不能匹配任何private角色。
2. `infrastructure/narrative-wake-repository.ts:70`：任何有效focus直接返回deferred，连bootstrap/合格作者事件都不考虑。`agent-phone-entry-probe.ts:160`同样全局return deferred。该限制跟DOM打字无关，是业务会话持续存在，因此不输入不能解除。
3. `server/npc-agent-advance-services.ts:308-354`：已收到private响应先恢复；若attention令提交延期，则任何一个仍response_received的角色导致整个advance return quiet。真实到达在其后，其他NPC亦不能继续。这是有意避免旧全世界版本快照变旧的保护，却把单角色交付阻塞升级成全世界停滞。
4. `npc-agent-kernel.ts:145`在事件人物结果提交时再作同样attention检查。不能只删调度层判断；否则付费后仍延期，并触发上述全局堵塞。

建议：root统一将“考虑与合法状态提交”和“打断当前页面的通知”分开；演员可在当前世界内独立考虑/行动，非焦点消息成为未读而不强制弹窗。保留当前世界/角色修订、来源、位置、结果校验；若需要对已收到旧帧重验，应按真实读集整体重验，不直接改expectedVersion。注意力可以控制通知强度，不应阻止另一个人物的合法工作。旧received恢复必须明确范围，不能简单删除保护然后丢掉付费响应。

## P1：失败付费家族将人物议程锁死（不是quiet）

`own-agenda-review-repository.ts:414`取最后成功私聊commit作anchor；`own-agenda-review-authority.ts:351-367`遇同家族任意paid/invalid/unknown直接返回null；`evaluateOwnAgendaReview`同样paid_fence。若一次own agenda输出invalid，用户又不讲话，就没有新成功anchor，今后全部轻检查永远拿同一个已失败family。时间或冷却不能改变family，这保护了防重复付费，但缺少“已知失败可修复/新合法重评依据”的生命周期。unknown active actor blocker也持续阻塞本人。不能换family/窗口绕过，需由恢复任务处理原已保存响应与明确失败类别，或等待真正语义变化；状态要可观察，不把无候选算正常安静。

`npc-agent-advance-services.ts:456-473`正常plan/responsibility候选也按稳定command屏蔽旧invalid/stale，reconsiderOn=[]。同计划无新真实依据时永远不能再调，此处需与根恢复协议统一，而非反复重购。

## P1：defer/need_information有投影，不保证有可执行后续

`episode-participation-lifecycle.ts:110-184`只投影实际已有goal/plan/responsibility；允许followUp=none，且reassessment仅承认非空已满足triggers/nextCheck。
`agent-schedule-collectors.ts:196`责任nextCheck为空不ready；`domain/agent-plan-next-step.ts`只有missingConditions而无trigger属于waiting；没有action/trigger/缺失说明则missing_next_step。`planReconsiderations`仅按实际条件产生稳定候选。由此人物说“等待更多信息”但没有合法结构化触发时，不能依赖本事件再次自动唤醒，只能偶发own agenda；这是需查实际actor state的证据点，不能在没有生产证据时断言本档正处此状态。

建议：原NPC同轮输出必须在选择defer/need_information时表达本人真正等待对象和可关联的后续依据；非硬期限、非用户承诺。新信息原输入、已记录玩家决定/结果驱动计划修订。需要建立“本次已获所需信息”的语义判断与旧责任关联，不由关键词或代码补造。保留quiet/decline无催促。

## P2：作者事件重评不是持续创作循环

`narrative-wake-repository.ts:142-181`只给未occupied、eligible且contextToken未付费评估的事件机会。相同quiet/assessment且无新语义证据会被永久去重，此规则本身避免重购，不能直接删；当前可唤醒证据是已定义承诺/到达/开场speech等，而时间和沉默不成为新事实。整个开场只得到泛化邀请且之后无人行动时，导演不自动得到新的叙事推进理由。应优先补NPC计划与真实结果、下一阶段来源，再设计有预算的停滞重评契约，不能把tick重新包装成新事件。

## 前端入口事实

`world-phone-app.tsx:626`nativeOpening仍每轮读原continuation，并非openingFinished永久停止；下方idleDue路径仍存在。`markChecked`在发请求前更新lastCheck；失败后15秒后仍可轻检查，但相同native-work key已写localStorage，只有scheduler_busy释放。错误时无原请求查询/释放分类，需由恢复任务处理，不能一律释放然后重发。顶部generic catch无明确清除，已由恢复审查并行负责。

## 建议分工（避免公共文件重叠）

- root：advance服务、原事务恢复、HTTP/回执、公共协议/SQL、生产证据、最终部署。
- 可独立A：NEW纯domain注意力呈现策略与对应纯测，仅产出决定（可后台参与/通知延后），不接公共kernel；root接上述四处。
- 可独立B：原事件生命周期/schema的只读样本审计，列出缺失触发的真实state，不生产修补；待root分配单一协议作者后再改。
- 可独立C：必要连续旅程测试（A私聊+BC并发事件→只有通知受限；已收到响应不冻真实到达；quiet成功退避后可重评；invalid家族不重付且返回可诊断状态）。不跑已通过全套。

## 验收重点

首次入场无玩家首句有来源的来信；A会话保持打开且用户阅读不输入，B/C可处理自己的合法事件；无重复催问；一次known failure不永久冻结无关NPC/到达；任何quiet、waiting、failed、unknown有不同状态和下一依据；与作者开场具体事件有因果关联。需真实模型和原手机验证，纯检查不能替代。
