# 44-154 P / N6 · 原引擎计划与持续自主议程

root-unified137为唯一公共集成人；P1/P2负责独立计划模块与v6协议，N5负责原表原子预算，N7负责只读锚/安静证据。基线dfcc614d；使用unified-engine137工作树，主登记目录仍为Desktop/projects/demo/人生剧本。禁止从执行分支部署。

## 实际接线

原手机首次进入/真实返回/在线轻量检查
→ 原advanceIfEnabled与world/epoch批租约
→ 优先恢复原protected raw、真实到达、事件参与请求
→ 原条件collector的可执行计划/责任/观察；合格作者opening仍优先
→ 对没有更高可执行事项、已有真实commit锚的人物，认证own_agenda review资格
→ 同一scheduleAgents注册的agenda_review候选
→ 原accept/claim/markRequestSentWithSources
→ 本人一次模型调用（对白、计划、判断）
→ 原kernel与world事件/状态/消息/回执/Outbox事务
→ 原手机消息投影。

不存在第二套消息插入、独立剧情进程或固定人物台词。初始revision0只走原F/作者事件，不能伪造review锚。当前时窗不是联系理由，人物仍可quiet。

## 计划协议

v6以planIntents显式选择new/existing目标；服务器仅生成机械ID并绑定已有目标，不能补一个没有声明的目标。新计划、替换、修改、关闭均走原canonical proposal与内核。关闭计划不是完成目标，更不是完成事件。现有执行通道仍至多一项，v1-v5旧raw/ID/解释语义保持；旧invalid或unknown不自动纠正/重购。

原模型语法的sourceIds共用当前授权source枚举，避免猜测“episode-request”等不存在的来源别名；原来源/知情校验不放宽。枚举共享$defs控制请求体，不泄露未授权来源。

## 议程身份和触发

N2 family绑定world/epoch/actor/definition及真实anchor attempt/event，不含tick、CAS版本、policy版本。N7只读认证原private state commit或带真实runtime及消息投影的private turn.resolved；合法group投递只更新最近呈现时间，不冒充private锚。安静次数依据实际五类状态及结果变化，不按事件类型猜测。

默认实际间隔20秒、故事间隔1分钟、安静退避2倍且最多5分钟；原手机35秒空闲检查为预留处理时间的机会，不是固定发消息倒计时。最近真实投递也限制间隔。三层持久预算分别owner 48/小时、world16/10分钟、actor4/5分钟，和批次模型/人物/耗时上限独立，均有服务端配置。没有到条件/预算/新工作可保持安静，不不断调用模型。

## 权威与预算

accept/claim认证原owner、world、epoch、definition、anchor、完整family历史、规范正文与command身份；send在原world/attempt锁下逐字段认证当前reserved holder和snapshot，重新核对条件、来源和优先事项。

N5在原request_sent同一事务对rate_limits按owner/world/actor固定次序预留，窗口不会倒退。任一桶耗尽用SAVEPOINT撤销本次全部预算，在原外事务把该确定零发送attempt标cancelled，再返回typed预算等待，runner不进入模型。protected response提交不重收预算、不再要求新的时间窗口；paid/unknown不因新policy/输入编号而逃逸。

## 明确的零发送恢复合同

原CAS不变时复用0082同attempt/token换代。CAS已改变时，只有完整同family历史均为已认证零sent/raw/event的终态（或原尚未claim的receipt）、不存在其他活跃/paid holder，才允许同family的新transport。新command由原family、上一个不可变receipt command和严格递增world版本机械派生；每个前驱都认证，不能任意随机后缀、删历史或重新发放grant。旧receipt/attempt/CAS保持原样。

恢复继续使用原N2结果和共享时间窗口；完整paid历史未被过滤成新的ready。commit仅接原response_received证据，不重复预算。已过期但仍reserved的崩溃接管、已付费raw跨版本重基不在本合同中，仍按原保护阻断，不假称恢复。

## 必要验证和剩余边界

P1/P2聚焦81、N5真实PG14、N7真实PG12已由执行者记录。root接线新增真实PG6项通过：F真实quiet→原advance两NPC v6独立计划/消息；一人unknown不阻他人；预算竞争零发送取消及跨CAS同family恢复；protected raw恢复一次模型一次预算；原CAS恢复和伪family/transport拒绝。root纯114及check3564/build通过。原作者事件/恢复回归26/26通过，含原Director→两份人物请求→两个NPC原生v6计划/消息/active事件，未知/旧协议/付费恢复负向保持；最终type通过。真实模型验收与部署待候选READY，尚未将本报告等同正式交付。

未完成/不冒称：未来policy升版需要显式历史兼容；reserved崩溃接管及已付费raw跨CAS重基仍受保护；own_agenda不重新开启已消费/拒绝的episode请求；既有paid-invalid保留，不能靠强行重发修复。可靠持续离线后台执行者仍是原154后续项，返回会沿原入口有界接续，不编造离线已发生事项。

## Real acceptance follow-up: missing public premise

Candidate cfdd1cec cold start used three text calls. The Director committed the authored opening and two addressed requests; both NPC outputs were valid quiet decisions without dangling plan references. This is not natural multi-actor acceptance. Consumed requests remain immutable. A subsequent elapsed-time browsing check made zero additional model calls and produced no messages.

Diagnosis: selected life modules dropped definition-bound publicSetting and protagonistPublicIdentity. The Director's actor refs also lacked explicit names and its per-actor tasks omitted shared discussion context. Root adds ref/name mapping without changing scoped IDs or ordering, and requires self-contained future interaction tasks. N8 separately restores only approved public premise fields beside life modules. No global manuscript, secrets, other actors' private plans, player location or expected outcomes are broadcast. Existing paid snapshots and source hashes remain unchanged.

Formal production remains dfcc614d. The candidate is not yet promoted or declared accepted.

Context follow-up integrated: N8 c43cd501 -> 945f63d5; Director identity fix20e927e8. New check3571 and build pass, addressed-intent PostgreSQL suite30/30 passes. That privacy test explicitly sets maxActors1 to retain its original two-invocation assertion; multi-actor default is independently covered by the earlier runtime6 and semantic26 journeys. The no-call own-review probe was a test-presence expiry (45s lease expired8.611s before check), not a runtime defect. Real phone renews every15s; subsequent acceptance will use that same activity API. No scheduling permission or quiet outcome was weakened.
