# 44-161-MESSAGE-RECOVERY

状态：待root集成验收。执行者codex-message-recovery161；root-runtime161唯一集成、前端/公共HTTP诊断、模型、生产及部署。
基线79bddd60，独立message-recovery161/codex/message-recovery161。源码冻结b8ccacaf。

## 交付接口与边界

- npcAgents.lookupMessage(ownerId, TurnCommand)仍只读，无accepted-input时return null，保留旧引擎查询回退。unconfirmed可选recovery字段只含pending/response_received/unknown，不包含raw、attempt token、模型响应或私人来源。
- 原POST /api/v1/worlds/[id]/messages/receipt仅在X-Message-Recovery:1时保留新字段；不带该header仍剥除recovery，旧严格客户端保持原响应形状。root新client需加header。
- 新POST /api/v1/worlds/[id]/messages/recover使用原WorldMessageRequestSchema、身份/同源/CSRF保护，默认返回扩展MessageReceiptLookup。
- npcAgents.recoverMessage(ownerId, TurnCommand)只允许当前epoch>=2、原accepted-input存在且精确匹配owner/world/command/actor/text/hash/expectedVersion/private线程/player origin。committed直接查原回执；pending/inflight、unknown、invalid、cancelled、stale均仅返回现有状态，绝不创建新输入或新工作。
- 仅已有response_received且readResponse确认保护记录存在时，以null snapshot运行原runNpcAgent，使用原保存snapshot/raw、原parse、原kernel事务。模型port硬禁止decide且不构造modelFactory。所有资格、来源、版本、epoch、租约、并发及晚到结果仍走原内核，不改旧paid解释。
- 已知invalid/stale归原终态；未知或未执行结果不自动重试。存储故障保留response_received，可再次恢复已有结果，不重新付费。lease已失效或世界已变的结果仍按原kernel转stale，不做隐式付费重基。
- send对previous stale_discarded改为VERSION_CONFLICT，与lookup一致；其余错误翻译提为原样共享函数。NpcMessageError类未改，root可接可选安全diagnostic；新recover路由目前把该类转HttpError(code/status)，避免旧endpoint不识别apiCode。

## 后台复用的无付费适配器

导出protectedMessageReplayStore(store, ownerId, expectedAttempt): AgentAttemptStore。

仅接收protected response_received/committed预期项；owner/id/world/actor/command/inputReceipt/hash/epoch/worldVersion/actorRevision/token精确匹配。claim只lookup并返回replay:true，绝不调用底层store.claim，也不恢复cancelled或创建不存在的attempt。saveResponse和新发送生命周期转换硬禁止；只允许原runner将已知结果标记invalid/stale。原store/kernel继续负责事务原子提交。root后台operation可复用，避免将runNpcAgent(null snapshot)误解为天然不会claim新工作。

## 必要验证

- 新本地真实PostgreSQL55662原服务/内核旅程9/9通过：只读pending/received/unknown；保护结果实际落库后幂等；并发恢复仅1事件；跨用户/篡改命令/version/hash/actor拒绝；cancelled/invalid/unknown不重试；另一NPC原入口提交后旧响应原kernel版本冲突；中途存储失败回滚并保留raw，随后无模型恢复；旧引擎和缺accepted兼容边界。
- 4/4纯策略/契约测试：replay-only不调用底层claim/save、身份/token/版本严格绑定、新付费生命周期禁止、旧lookup响应兼容且新恢复state仅白名单。
- 所有恢复路径modelFactory构造次数为0；唯一额外模型适配器是测试内另一NPC受控返回，用于制造真实并发世界变更，不是商业调用。
- tsc --noEmit 0错误、check:boundaries662、git diff --check通过。
- 额外原npc-execution-contract文件出现5个旧子fixture失败（总8/通过2/失败6含父）；在同一独立DB、原79bddd60完整server文件做对照，得到完全相同5项失败。旧受控fixture把已短引用payload当canonical来源以及旧coordination断言，未在本任务改旧fixture或冒称原文件全绿。对照后当前源码已恢复并重新跑新9项旅程通过。

无SQL迁移、无商业模型、无生产查询写入、无全量check/build、未部署；本地PG停机由执行者清理。root统一集成必要最终门禁、手机/PC原入口与正式部署。此交付是消息结果恢复，不能宣称NPC持续主动演绎已全部完成。
