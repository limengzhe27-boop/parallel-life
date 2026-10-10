# CHAT-SEND-RECEIPT-01I · 只读核对发送回执

当前：业务9699249已上线READY并通过正式只读API/受控手机长短与PC验收；591check/build、39迁移一致、0供应商模型/生图。I会话/局部存储/夹具/端口已恢复清理，F保留资源由本人收尾。最终文档当前版本另见忽略chat-send-final-handoff.json。下文过程保留追溯，最终结论以末节和主表为准。

2026-10-10；I codex-chat-send-receipt-i-01a11a84-20261010，scene-index-transitions/codex/chat-send-receipt-01，基线7547217。已短锁登记独占新文件范围，F单聊/群聊三UI只读，主client/interview WIP排除。0模型/生图/迁移，PG55450与HTTP3254开前无监听。

## 冻结最小协议（供根转F）

POST /api/v1/worlds/:worldId/messages/receipt，原WorldMessageRequest {commandId,actorId,expectedVersion,text}，不增加origin/重试字段，不另换commandId。使用现有会话、Origin及CSRF校验/no-store。只validateCommand + worlds.receipt(session,原TurnCommand)，不resolveTurn/模型/clock写/Queue/drainOutbox。

响应strict union：原WorldMessageReceipt {status:'committed',commandId,worldId,actorId,version,eventId} 或 {status:'unconfirmed',commandId,worldId,actorId}。committed仅为原事务回执，version允许旧历史；unconfirmed仅说明此刻未见已提交回执，不能推出已失败/未执行，不能触发新付费调用。跨owner/缺world404，原命令变text/actor/version等指纹409；查询失败仍保unknown，不自动发请求到原发送入口。客户端严格比对返回commandId/worldId/actorId与查询输入，不接收错回执。

客户端独立 src/features/api/message-receipt-client.ts：export class MessageReceiptClient（默认bound fetch，支持注入fetcher），方法 lookup(worldId,input:WorldMessageRequest):Promise<MessageReceiptLookup>。可useMemo(()=>new MessageReceiptClient(),[])；仅会话握手及本只读POST，未修改LifeClient。schema/types来自 src/contracts/message-receipt-lookup.ts。F需在unknown中保完整原命令，点击核对→committed刷新原世界并清对应pending，unconfirmed保待确认/文本且不换命令；确定failed显式重试的产品策略由F/root范围处理。

## 验收接续

实现上述四新文件及两个专属纯/PG测试；真实PG核原回执、后续版本、指纹、跨owner/世界、未提交以及读前后commands/events/messages/outbox/tasks状态完全不变。最终check/build、F实际双端故障/unknown流程及READY/public只读已存在合成回执验证；不得为核对运行模型。完成后同批纳根地图概念两文件，仅设计预览不等于地图实现；用户视觉反馈待验。当前仍实施中，线上7547217不含本修复。

## 稳定协议与源码可供F接入

四新文件已实现，接口/type/class/method按上方冻结协议不变。3纯专项、5真实PG项（父+4子）及完整581check/build通过；真实PG读取前后world/commands/events/messages/outbox/tasks全行快照不变，原receipt v1在world v2仍可恢复，原text/actor/version/origin指纹409、异owner404、同owner另一world只unconfirmed无泄露。首纯测试遇Node strip-only不支持参数属性，已改显式字段构造，保chat-receipt-tests.log，未降测试。0模型/生图，持久v1/原repo/API发送未改；新HTTP路由尚待本地及最终公网验收。源码提交后根可转F只接这四新业务文件，不接报告/旧祖先/主client WIP；F三UI与唯一I范围不冲突。

稳定提交 **cadc75e**：只含本轮四新源码、两新test、本人报告。根可现在转F接入，I继续本地HTTP和集成发布。PG55450/session63094已启，HTTP3254即将生产构建启动并启外部fetch拒绝guard，0供应商。

## 真实本地HTTP通过，后端待集成

新生产构建HTTP3254/session19255：会话200、原lookup200/v1（世界已v2）、重复200/v1、缺失200/unconfirmed、text/version变更409、跨owner/不存在world404；查询前后world/commands/events/messages/outbox/tasks全行不变。适配器只/session与/messages/receipt，无send/run/retry请求；guard外网拒绝，0模型0生图。证据chat-receipt-http-evidence.json/log。首ignored脚本shell引用错误在Node导入前失败，修引用后成功，未造成数据库/HTTP查询或模型调用。

后端cadc75e稳定；已见F独立6e4e4b2只消费四新源码，F正在UI实施，I不改其范围。I本项先待验收，最终与F统一check/build/39迁移、业务READY/public只读已有合成回执→最终docs READY归档。地图两概念文件可归档，但SPACE仍未实施。当前线上7547217未含本修复。PG55450保持到联合check结束（其已有权限测试依赖），3254保留本地验收，之后清理两个精确合成owner/world并停资源。

## 2026-10-10 接续纠正

上一条用户回复对应旧PEOPLE授权，误将旧朋友交付作当前final；根已纠正，本项仍待集成验收，未上线，继续唯一I职责。后端cadc75e冻结，F6e4e4b2依赖接入及UI在途故障验证；不碰F在途文件、不以其未提交改动直接上线。原生产两个paused合成世界只读receipt查询材料已准备成功（0生产写/0模型），待F稳定提交后受控集成、check/build、39迁移、READY及公网只读API/UI，地图仅归档概念两文件。当前线上仍7547217。

I已只读复核F在途源码和single-failed-short-visible/PC两真实截图：单次局部提示、草稿在、底部重复撤除；unknown-unconfirmed材料显示send count4→4，非最终F完整验收。F尚未冻结提交，I不提前集成。Ego115/p1独占正式只读验收空间已创建，正式命名pl_session备份0600成功；首次相对路径保存失败，改绝对路径成功，未改cookie或删除存储。浏览器提示0.5.1.11有更新，仅记录，不升级。HTTP19255已停止/3254无监听，PG55450保持联合check；public verify脚本准备但未执行、0生产写/0模型。

本地HTTP夹具已断言owner/独占port55450/title/version2后删除两个精确合成账号和world0283e220-f676-4f18-8600-03b5a43613a0，并删除本地私有cookie材料；cleanup-evidence/log保留，PG仍用于联合check。I已目视Fgroup-failed-short：玩家原消息在、局部仅一个回复失败alert，无底部重复；迟到/及时提交草稿JSON结果复核。F另补结构化VERSION_CONFLICT代码判断，尚待其最终回归/提交，不接在途源码。Ego115/p1仅登记Page新文档fetch guard：POST仅允许session与readonly receipt，其余全部拒绝或受控lost不转发；现页面尚无测试发送，未切合成会话、未公网查询新route。待READY后真实lookup加手机/PC受控故障验收。默认体验方案docs/DEMO_WORLD_EXPERIENCE_PLAN.md与根两行冻结释放，最终文档受控归档；仍方案，无世界实例化/源码/付费测试。

## 受控集成提交9699249，尚未上线

F稳定3ba6d3e仅六src/tests受控取入I树，未取其四依赖祖先/旧报告；review通过。联合591/591check及build通过，HTTP已停避免.next争写；12个src/tests精确复制到主并逐文件字节校验等于验证树，主client/interview两WIP哈希不变。正确关联身份提交9699249，仅12源码/测试，未纳任何其他在途功能/docs。F仍补群恢复不execute/独立读取及刷新409证据，待其最后材料后39生产迁移核对、push→READY→正式只读receipt+受控双端UI。当前生产仍7547217。

给F接续的I资源确认：3ba6d3e六src/tests已完整受控收取9699249，591check/build通过，I不需要继续占用F的Ego112/PG55458/3263-4。F完成最后群恢复不执行/独立读取/草稿刷新与409实际原命令证据后，可依本人范围安全清理自有fixture/会话/端口和临时链接，并交最终待验收报告；I公网独用Ego115与已冻结脚本，自己的PG55450联合check已通过。F未交最后材料前不把本批标上线或完成。

## 最终业务上线与公网验收

业务 **96992493117aa07f476251e64683a801f4d48fd9**，Production **parallel-life-mxqf1bxxo-limengzhe27-boops-projects.vercel.app** / **dpl_8tDGVy4QUd7aoT5Bm9neoXdERJ7M** READY，正式 https://parallel-life-nu.vercel.app 已切换。本批12个src/tests受控集成自cadc75e与F3ba6d3e，F最终报告64f93fc；主client/interview在途两文件哈希不变。591/591联合check、build通过；只读生产39/39迁移哈希一致，无SQL变更。

真实本地专项3纯+5PG（含父+4子），原v1回执在world v2可恢复，完整指纹与跨owner隔离、缺失不写，六表全行一致；真实HTTP同边界通过。正式两个既有paused合成R世界：原receipt与重复200/v1、缺失200/unconfirmed、text/version指纹409、跨owner404，16个HTTP状态含会话握手；查询前后worlds/commands/world_events/world_messages/outbox_jobs/tasks全行相同，world version1/paused不变。不新增世界、消息事务、生产任务执行或供应商调用。

正式Ego115：模拟恢复记录中的已提交原命令，经浏览器原生touch找到真实回执并清待确认；受控422拒绝与网络lost均在Page保护下不转发/messages。390×500/844及1440×1000原始截图已目视：失败仅对应消息下方一处alert，原草稿保留，无输入框底部重复。unknown两次原生touch核对实际receipt，blocked sends2→2、form alerts0、原文在、版本1与clock整对象相同。F独立真实群玩家消息/既有lease finish故障、恢复不execute1→1/明确继续1→2、独立读取错误、新旧草稿竞争、实际8→9冲突后原命令保存9/刷新不重发均复核通过。群聊天UI公网未新建付费测试或伪称真实AI效果。

真实限制与失败保留：Ego自动selector/高层mouse在滚动短屏偏移，DOM命中与截图显示按钮可达；浏览器原生touch成功，不代表真机验收。首次CDP新文档guard跨调用不持久，在当时只点readonly核对、未发送；后用同调用register+reload并断言global guard/audit实际生效。首次受控拒绝body漏retryable，客户端正确保守unknown；发送审计确认blocked未转发，补齐真实契约后422 failed通过。没有把这些失败算UI通过、没有产生模型调用。照片分享仍文本，不新增真实附件链路。已引用图片、时间/地图/任务引擎及真实AI自然性不在本批扩展。

Ego115已恢复正式named pl_session与仅本合成world局部local/session存储，原会话值校验，finish一次；cookie备份删除。本地两精确账号/world夹具与私有cookie材料已删，HTTP3254/PG55450停止并无监听；临时node_modules symlink在最终只读检查后移除。F自身PG55458/3263-4按根保留登记由F负责，I已通过主报告明确无需继续为I保留，等待其本人收资源，不误删他人资源。浏览器0.5.1.11提示更新，仅记录未升级。

MAP_PREVIEW说明/PNG及最新DEMO_WORLD_EXPERIENCE_PLAN受控归档，仍概念/方案及待用户判断；SPACE/LIB实例化/专业后台未实现。专业后台保持列表最后。根新DEMO-SCRIPT在途行/四讨论稿/报告本批排除，不因其迭代延迟CHAT交付。最终docs部署READY及实际当前线上提交保存在主目录忽略chat-send-final-handoff.json，避免tracked READY循环。
