# 44-161 · 原请求查询与恢复链只读审查

负责人 codex-recovery161-audit；2026-10-19。基线 unified-engine137 `79bddd60`。仅本报告及 canonical 主登记行；未改源码、未访问生产、未调用模型、未重复测试。root 是唯一集成人。继承并复核 44-160-FAILURE-DIAGNOSTIC-REVIEW，不把报告当修复。

## 已确认的实际调用链

后台手机 `world-phone-app.tsx::checkForWorldNews` → `client.advanceWorld` → POST `/worlds/:id/advance` → `services.advanceWorld` → `npcAgentAdvanceServices.advanceIfEnabled` → 原批次租约/runAgentAdvanceBatch → Director/NPC 原 attempt/raw/kernel/receipt。epoch2 返回不会走旧剧情系统。

聊天 `deliverMessage` 先保存 immutable command（world/actor/text/expectedVersion）→ `/messages` → `npcAgentServices.sendMessageIfEnabled` → accept/claim/runNpcAgent。POST `/messages/receipt` 经相同 owner、inputHash、actor、text 核验，只读原事件/attempt。

## 根断点与精确影响

1. **后台 advance 没有可查询的本次请求身份。** 当前 POST 只有 automatic，AdvanceReceipt 无 command/attempt/batch token。浏览器185秒超时、服务端240秒上限；进程仍可能提交。不能把再次 POST advance 当作“查询原请求”，它会重新选择当前工作并可能付费。内部稳定 candidate command/租约去重是可靠底座，但客户端看不见实际哪次工作失败/完成。
2. **banner 是全局字符串，失败阶段完全丢失。** `world-phone-app.tsx:717` catch 不读错误，对 advancing 一律 setError。普通投影poll只setData，quiet或scheduler_busy返回不load，不清除旧error；load开头又无条件清error（查询未成功就可能消失）。所以“还在报错”与“原操作仍失败”没有一一对应关系。不能只在任何成功请求后setError('')，必须清相同operationId/世界对应的错误。
3. **frontend continuation token 在发送前就永久记入localStorage。** `claimCheck` 写key后才advance；除scheduler_busy外catch不会release。连接前失败也吃掉提示key，后续可能只能等idle fallback。反之简单catch release会对真实unknown反复执行。需要以原服务查询状态决定接续，而非客户端推断付费状态。
4. **聊天lookup将多种本质不同状态合并unconfirmed。** `lookupMessage`: reserved/request_sent/response_received/unknown/缺失事件全部unconfirmed。前端不能分辨“等原执行”“有raw可免费提交”“结果未知禁止重买”。必须保持原身份授权并扩展安全恢复状态，而非根据HTTP码猜。
5. **当前会话失败发送没有自动核对闭环。** `deliverMessage` catch仅写failed/unknown；`restoredSends.current`来自重载恢复，reconcile只挂载和visibility触发，当前新失败不会自动加入原命令核对队列。BUSY被sendFailureStatus标failed，可让用户看到失败而实际原attempt正在执行。恢复应覆盖当前和重载的pending/unknown，按原command读取，不能自动生成新command。
6. **模型已返回的结果有免费恢复链，但资格有限。** advance优先恢复private response_received（原worldVersion/actorRevision匹配）；runNpcAgent从受保护wrapper原协议parse+kernel，无模型调用。Director recover同样无模型port。若前景attention暂不允许，保持raw；目前任意private response_received可能保住整个旧world读帧并阻止不相关工作，不能靠清表解决。
7. **恢复本身遇到存储错误也会抛至generic banner。** runNpcAgent commit非已知invalid/conflict保留response_received。advance恢复循环仅吞delivery_deferred，其余向外抛；同一raw可重复免费恢复，但客户端没有标识/退避/结果状态。一个失败恢复也会挡本批其他人物，需按全局存储故障与局部人物错误区分。
8. **已知终态与HTTP提示不一致。** sendMessage previous stale_discarded与invalid_output统一INVALID_AI_OUTPUT；lookup却正确VERSION_CONFLICT。unknown只是API兜底，不能当durable unknown依据。runner上游明确拒绝与parse失败都可invalid_output，仍需阶段诊断。

## 状态与允许操作

| 原持久状态 | 允许自动处理 | 不允许 |
|---|---|---|
| committed，原event/receipt存在 | 读取原回执，刷新投影，清该操作错误 | 重发模型/重新执行 |
| reserved/request_sent且仍在执行 | 有界查询原状态 | 抢租约/换command |
| response_received，原snapshot/raw/hash完整 | 通过原runner/kernel恢复；仍校验版本/来源/权限/租约/attention | 重新模型、任意改expectedVersion |
| response_received但世界/人物变化 | 原有known Director整份handoff重验仅适用认证范围；NPC保持真实conflict | 泛化Director特殊方案为所有NPC rebase |
| invalid_output/stale_discarded | 确认终态并展示对应有限提示；其他合法工作可独立继续 | 清洗旧raw、自动付费替代 |
| unknown_after_send/发送后无raw | 查询可得的原结果；保持该工作围栏 | 自动重试/假称未计费 |
| cancelled_before_send | 检查原原因与原有准入机制，明确无发送证据才考虑同来源恢复 | 将所有cancelled视作全新付费许可 |
| 本次客户端请求未到服务端 | 查询无已接受记录并结合服务端准入重新检查 | 单凭fetch异常声称未发送 |

## Root最小实施建议

A. 复用原N10纯分类commit `55f19109`（目前文件不在HEAD、未接入），保持其仅诊断不授权。parser decode边界保留有限code/reason/stage；runner各阶段关联认证attempt/command，service包装前保留元数据。原报告已证明http自由errMessage和X-Error-Message需移除；route/error/header/log共用一个requestId。无需重写NPC v11协议。

B. 原聊天lookup增加恢复分类（或独立扩展协议/header以兼容旧strict客户端），committed仍需event存在；对response_received提供**精确原command的恢复入口**，只允许已有raw，不允许lookup副作用或模型回调。事务重复调用/CAS仍原内核处理。服务恢复函数应显式 no-model 能力，避免落入普通send的新调用分支。

C. 后台推进需一个可关联的检查/执行状态投影。最小可用实现先从原attempt+原batch租约提供授权只读状态（busy/pending-known/unknown/failed/idle/changed），返回稳定身份和恢复资格；如需精确“一次批次”应由root登记 durable receipt/schema，而非内存旁路。现readAgentPhoneEntryProbe continuation仅提示ready/deferred/pending/quiet，不足以证明某次失败已恢复。

D. 手机把load错误、发送错误、后台推进错误分开记录；后台失败先读投影与原状态，安全已知raw恢复有界退避；committed或该操作确证完成才清。quiet不是failure；另一个人物成功也不自动掩盖仍失败的原请求。用户不应永久看到要求刷新全世界的横幅，真正影响当前发送的错误就近展示且保留原消息。未知后台事项不应封锁不相关人物的合法工作。

E. 先完成状态链，不用更多真实付费调用替代诊断。root本轮生产只读记录判明具体断点后，针对该原因修。当前报告没有访问最新用户save，不声称截图本次是哪一错误。

## 必要反例验收（本包未执行）

1. 已提交但HTTP回执丢失：原command查询恢复、消息一次、模型一次。
2. 原raw已保存、提交临时数据库失败：同command免费恢复，额外模型调用0；同world/actor/hash不匹配拒绝。
3. response_received期间另一个玩家操作提交：不能偷改版本；不显示假成功。
4. genuine unknown：有限查询、不重买；另一合法NPC不被无关全局错误锁死。
5. BUSY仍执行后commit：当前会话无需刷新即可变为已发送。
6. 后台失败后quiet/其他操作成功：不误称原事项恢复；同原操作恢复后横幅消失。
7. 用户切世界/多标签/晚到响应：旧错误不污染新world、不会重复付费或弹新通知。
8. 网络连接前失败/读接口失败/模型HTTP明确拒绝/parse失败各分类，不把所有503标unknown。
9. body/header/log同requestId；无自由上游消息/SQL/private文本泄漏；未知code保持unclassified。
10. original history不会因恢复重新通知，后续真实新消息正常通知。

本包交付：静态链路审查和实施建议；0源码/生产/模型/测试，root统一开发、check/build/必要PG/真实体验/部署。
