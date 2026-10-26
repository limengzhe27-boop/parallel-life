# CHAT-FIRST-REPLY-01 · 正常发送首条回复性能

负责人 chat-first-reply-20261026；独立grok-image-20261023工作树，branch codex/chat-first-reply-20261026，读取基线1e989d83。用户不能接受几十秒等待，目标为点击到首个真实已保存可见分段，不以已接收或恢复对账冒充回复提速。root当前只授权只读定位，实施范围须先核对；不碰SCENE-ORIGIN-02的snapshot/kernel/领域协议及portrait WIP，不动3218/3219。

## 已有成果

CHAT-RECEIPT已集成：客户端收到complete后结束读取；原commandId对账；移除相同文本+最多6次整世界读取。HTTP仍在final receipt前读一次stream summary，常见流式内容复用内存。不重复开发这套恢复。

## 只读证据

旧实测原command499300f8的既有回执metrics：context40840.57ms、上游首个非空chunk45823.12ms、model总81348.67ms、response保存7243.42ms、finalkernel50456.6ms、server总195275.63ms；应用SQL331（context67/run264）、事务17。不是本轮重新调用，不能外推当前所有请求或把model时间与流式commit重叠部分简单相加。

从该原已保存snapshot纯本地重建当前模型输入（stub只收集请求，0商业模型、0业务写）：system39060 UTF8 bytes、payload27665 bytes、response schema37076 bytes。payload主要actor8815、sources7198/71项、wireCatalog3190、state3089、worldContext1299；实际选中observations1项（原snapshot19项）。字节数不是token数，也不能用体积单独证明上游45秒原因。当前本地NPC/文字配置均grok-4.7，仅记录模型名，未变更配置。

代码可见的往返：

- PostgresDatabase.transaction每次独立BEGIN、SET LOCAL lock_timeout、set_config(owner)、COMMIT，共4次底座往返；现有metrics不含底座全部SQL。17事务另有68次底座往返。
- persistAndCommitStreamSegment每条独立文本先一事务登记，再一事务提交。提交已拿world锁后，依次单独查epoch、锁attempt、锁actor state、原input、新玩家input、prior segments，6个相邻往返；随后仍要输入授权、活跃期、版本/来源校验及原world commit。不能跳过这些校验，也不能把模型生成期放进事务。
- 当前普通聊天已可流式输出，NpcAgentModel逐个安全statement等待落库再回调给HTTP；不应改为先展示未提交台词。

## 最小候选改动（尚未实施）

1. 底座事务setup：只将无参数的BEGIN与固定SET LOCAL lock_timeout合为一次simple query，owner仍参数化set_config；不改SQL权限/超时值/事务边界/错误回滚。每事务少1往返。需真实PG覆盖租户隔离、SET失败回滚、断连、任务队列，并核对所有旧mock对BEGIN的预期。
2. 仅stream-segment已有world锁内的读取批量化：保持world锁先取得，再将上述独立元数据和既有行锁作为一个有界读取，保留原attempt/actor锁、owner/world/token/epoch/expiry/新输入/来源和最终活动校验。避免同一个PoolClient上Promise.all。需原stream PG、并发新输入/epoch切换/actor变化/取消/unknown/partial测试与首段SQL计数。

这些减少网络往返但无法保证把模型首chunk45秒变成几秒。达到用户体感目标还必须区分现模型上游时延与本地保存时延；若上游仍慢，需由root安排有界同上下文快模型候选验收，不能静默换模型或宣称仅靠恢复已提速。

当前0新模型/0业务写/0端口变更。等待root确认最小实施范围和稳定集成基线；首段及全轮实际前后耗时尚未测，不能标完成。

## 已批准实施与真实数据库验收（2026-10-26）

root批准独占postgres.ts、npc-stream-segment-repository.ts和专属测试/报告；只本地，0商业模型、0原档写、0端口3218/3219重启。独立PG55651合成测试。

A提交e4b7daf0：固定BEGIN+SET LOCAL合并，owner保持参数化；真实PG新测试证明setup 2次往返而非3次，回调值、事务内身份/5s锁超时、提交后身份/超时不泄漏、失败回滚、下一owner复用均通过；既有postgres-disconnect测试证明断线后回滚和新连接恢复通过。

B采用更小安全范围：仅将原receipt读取与newer-input EXISTS合并。world→epoch→attempt→actor锁/校验顺序不变，authority、activity、prior和最终内核提交均不动，减少每分段一次往返，不引入锁CTE。原chat-latency-stage2真实PG完整用例改前/改后均通过，包括交错发言、输入一次、媒体一次、中断、重放、部分失败及恢复；同一pg.Client.query计数器前后总数3244→3233，原11次receipt+11次对应interrupt被11次combined替换。其他14次interrupt读取不在本次范围。

build通过。首轮check与build误并行导致.next/types生成文件竞态（TS6053），已在build结束后顺序重跑check；以最终check日志为准。

不声称用户可感知首句已达标：只验证减少往返，上游首段约45秒是旧记录，尚无当前真实模型端到端对比。已请求root优先安排当前模型/快模型有界验证，只有首句真实耗时通过才能关闭整体性能问题。root唯一负责main合入和本地运行，不部署（账号暂停）。
