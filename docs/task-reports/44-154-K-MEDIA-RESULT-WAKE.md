# 44-154-K — 真实媒体完成沿原调度唤醒与稳定消费

负责人 codex-media-wake154-k；root唯一集成人。独立 `media-wake154-k` / `codex/media-wake154-k`，基线 `771b3313`（含154-J与G）。独占 `application/agent-schedule-collectors.ts`、`infrastructure/agent-phone-entry-probe.ts`、两个新聚焦测试和本文。主表待root集成验收；无SQL迁移、模型调用、生产写或部署。

## 运行链路

1. 原J `attachAgentWorldContext` 为同一人物读取原G认证的实际完成，保留 `media-result:` / `action_result` / `private_strategy`、精确contentHash和结果观察。
2. 原 `createAgentScheduleSources` 发现此来源时注册已有 `observation` 类别。新增纯函数 `collectActorMediaResultCandidates` 验证完整完成观察与来源一致，只把它解释成“本人可重新考虑后续”，不生成动作或消息。
3. 候选ID只绑定世界、人物、引擎epoch、真实完成source ID/hash；不使用worldVersion、人物revision、刷新时刻、消息数或clock tick。预计CAS版本照常使用当前读，身份不跟着CAS变动。
4. 原服务 `agentWakeCommandId` / input receipt / attempt / original kernel 提交该候选。人物可以quiet。原 `consumedCandidateIds` 过滤和实际advance已提交command去重生效；不建立第二套消费表、消息队列或执行器。
5. 原手机只读probe对pending Director也读取本人合法完成的新资格；复用同一纯候选ID，并从原wake receipt/attempt排除已提交quiet、已知失败以及付费后取消的同候选。人物自己的inflight/unknown仍阻断本人，不清理或重新购买Director，也不扩大为全世界unknown阻断。
6. 正常非pending路径在现有bootstrap/narrative/agenda顺序后也能得到实际完成的稳定cheap cue；仍只是请求原advance做资格检查，不授权直接调用模型。

## 真实性与边界

- 不认 `world_media_requests.status=ready` 的单独自称。probe复用J/G原认证：本人enqueue成功→不可变执行来源→原task/Outbox真实成功→精确asset/revision。
- queued / unknown / failed / unverified_ready 和泛化的“支持计划”占位观察均不生成媒体完成候选。
- `completedAtReal`只检查为合法服务器时间，不与剧情时刻混算。请求来源早于人物已读版本并不妨碍新外部完成获得一次机会。
- private_strategy只供本人持续计划；不向其他人物授予知情，不把群消息泄漏给所有人。
- 不强制发送“图片好了”，不改写旧enqueue结果、completedGoalIds或目标完成状态，不把quiet消费当用户读过图片。
- 原phone focus、manual pause、raw恢复优先级保留。业务交谈中其他人物内部重规划与投递拆分仍属root后续，不冒充本次完成。
- probe对从无原生生成动作的完整人物状态跳过外部结果查询；有动作才调用G/J认证。无每张图逐条查询、无模型轮询。

## 必要验证

### 纯候选与原collector

新增 `tests/actor-media-result-candidate.test.ts` 3项：稳定ID排除时间/CAS、完成hash变化对应新依据；pending/unknown/占位观察不授予完成；原注册collector消费 `consumedCandidateIds` 后不再返回此候选。并运行原collector回归。

### 原服务真实 PostgreSQL 旅程

独占PG55633，新增 `tests/integration/actor-media-result-wake.test.ts`。使用原native人物输入和内核生成媒体请求，原Outbox dispatch与租约handler实际持久化任务和资产；只有provider/model为明确合成适配器，0商业调用，不证明图像质量。

2子旅程+父测试，3/3通过：

- Director已有真实持久化unknown；媒体仅入队时无完成候选。原媒体真实完成不增加worldVersion，却准确改变手机cheap cue；只有本人A有完成候选，B无此依据。原advance给A原媒体结果上下文，A quiet提交；原消息仍只有最初一条，无强发消息。重新进入/再次advance不增加NPC/Director/媒体调用，旧Director保持unknown。实际库只含原一次media request、原一条Director unknown和两条committed NPC attempts（入队、quiet消费）。
- 原媒体task unknown时无完成候选，phone cue不被伪造完成改变；原advance不调用NPC、不重试媒体，unknown保持。

同时回归 `phone-entry-independent-pending-director.test.ts`，保留原raw优先、未知Director隔离、agenda/plan cheapcheck、focus与pause规则。

`check:boundaries`641文件、`npx tsc --noEmit`、Prettier及`git diff --check`通过。root集成统一执行全量check/build与部署；本任务不重复大型门禁。

## 接续与未完成

root按冻结提交集成，无新契约枚举/SQL。154-J的 `validateActorMediaResultContextInTransaction` 仍需root在原kernel提交段调用；本K不拥有该文件，不能用collector认证取代最终事务重验。

媒体完成只带来人物自己的下一步评估。是否执行何种新动作、目标的真实完成证据、无事可做时的有界复查、通用due/dependency索引以及可靠分钟级后台执行由后续统一调度继续，不能据本局部旅程宣称全世界已持续自治。
