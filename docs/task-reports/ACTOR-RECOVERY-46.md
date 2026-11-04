# ACTOR-RECOVERY-46：未知旧请求不阻断新玩家输入

本地3218交付，业务c8d1af2e，build-recovery46。无新字段/表，无生产部署，3219未改。

## 根因与修复

原档李之之现场请求61ab7ca7于20:21上游request阶段10518ms后UPSTREAM_FAILED；没有可保存response，正确保留unknown_after_send。随后微信372ec7bb已accept、尚无attempt，却被同人物旧unknown的4分钟lease阻止，返回BUSY。故上游异常与执行占用是两个问题。

统一claim在身份/来源/当前world和actor revision认证之后，允许不同的player input_receipt退休无response、无event的旧unknown执行权。复用stale_discarded，不改原receipt/hash/付费记录。自动唤醒仍沿原到期策略；同请求仍走原replay，request_sent/response_received继续保护；迟到response只保存为stale，不能执行。没有重发未知调用、伪造成功或删除历史。

## 验证

- 完整check4219/4219，build通过。
- 真实PG agent-runtime38/38：新增未到期unknown→不同player输入→旧请求replay→迟到结果只留档不可提交；原同输入防重买、正常在途与权限保护继续通过。
- 真实PG message-response-recovery9/9，已存response恢复不购买。
- 修正已有旧夹具：44已取消重复accept版本检查，首次claim应使用当前world与actor revision；保留新accept旧版本拒绝及错误actor revision拒绝，不放宽生产校验。
- 原档372ec7bb原请求接续：committed v729 event460cacbe，modelCallCount1；serverTotal7407ms，model5675ms，commit420ms。旧61ab7ca7保持无response/event的stale_discarded，未重买。实际原档重试时旧lease已自然过期，提前解除能力由真实PG未到期用例证明，不混称原档验证提前解除。
- 原现场读取2条新entry，页面文本均实际渲染。首次验收HTTP多带worldId字段被strict input以422拒绝，尚未进入模型；移除路由已有字段后同command通过，不是重复付费。
- 本地web、queue、proactive均更新到本批源码，用户内容/位置/进度保留。

## 剩余

上游request异常具体网络根因目前没有足够证据，不能保证模型服务不再失败。本批解决失败后新消息被牵连阻塞，不把unknown判为未扣费。旧现场未知请求仍保留，不自动重试。长期主动剧情、现场长期摘要与上下文/查询成本继续沿45/43清单；本次queryCount879，尚未优化。
