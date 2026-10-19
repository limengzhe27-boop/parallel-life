# 44-161-ATTENTION-EXECUTION

负责人 codex-attention-execution161，root唯一公共集成/生产/模型/部署。独立工作树 attention-execution161，分支 codex/attention-execution161，基线79bddd60。无SQL、协议版本、模型调用或生产操作。

## 改动

已认证的当前私聊、群聊、现场注意力不再冻结其他角色的事件考虑与导演唤醒。原注意力数据仍从真实联系人、群成员和现场在场认证读取；它不是地点、知情、能力或收件人授权。

- `episodeAttentionAllows` 保留原立即打断规则，未放宽；新增 `episodeExecutionAllows` 只判断未解析/撤权的conversation focus是否仍需保守延期。
- 原事件dispatch资格与`requireEpisodeDeliveryInTransaction`改用执行门。原世界版本、活跃clock、episode请求、actor snapshot、能力、当前来源、幂等、付费及unknown检查不变。
- 原导演narrative wake仍对unknown focus延期，但不因存在合法focus直接退出。导演快照继续携带真实focus，可按它协调节奏。
- 手机只读continuation probe对合法focus可返回其他演员、已知导演恢复或正常事件的工作提示，不改变请求身份、不自行发模型。

unknown focus并非只有页面不明，也包括真实群成员/scene在场撤销后尚未过期的conversation lease。本批未改变其处理，以免把撤销的渠道错误当成合法上下文；后续可以独立建后台scope而不沿用撤权渠道。

## Root必须同时接线

1. `director-runtime-repository.ts`原599处仍对任意focus报DIRECTOR_DELIVERY_DEFERRED；原1214处known handoff同样拒绝focus。应只取消合法focus本身的总闸，保留unknown、nativeTurn与原snapshot/current focus一致性认证。否则仅本包会放行前置却被提交侧拒绝。
2. `npc-agent-advance-services.ts`原350全局response_received保护仍在：遇其他真实原因延期时，应由root恢复协议按原帧处理，不能无重验改expectedVersion或重新付费。本包未改它。
3. 前端通知必须把合法后台入库与打断区分：B的新私聊可进入B会话和未读列表，A打开阅读时不应无关横幅抢焦点。现前端通知尚未在本包实现，root独占UI。
4. 原源中其他attention相关集成测试如断言“任何focus必定不能调度”需更新为最新产品语义；权限/撤权与版本测试保留。真实PG由root统一跑，不能把73项纯测冒充生产闭环。

## 验证

聚焦原dispatch资格测试+新增执行/呈现分离测试73/73通过。保留原稳定命令身份、unknown/paid不重买、零发送取消次数、actor间隔离及公开hint schema反例。新增A会话中B可执行但不能立即打断、group/scene不被冒充私聊、unknown仍延期、浏览不改输入状态。

Typecheck、架构边界及format/diff结果见最终交付消息。无全量check/build/真实PG/模型；由root集成后执行必要完整门禁与真实手机旅程。本包不是全部自主议程修复，也不保证模型一定愿意说话。
