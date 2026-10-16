# 44-27-DIRECTOR-RECOVERY-P｜导演已保存结果恢复

状态：实现与专项验证已冻结，待 root 接线及集成验收。2026-10-15。

## 范围

- 执行者 codex-ma44-director-recovery-p，线程01a11a84-9572-7ab0-92fb-967f963dfc20。
- 工作树 publication-story-02/人生剧本，codex/director-recovery44，从 root f4d85bf5fcd44cfd0a01762d9c28f579ac1e0146 开始。
- 仅修改 application/director-runtime-ports.ts、run-director-agent.ts、infrastructure/director-runtime-repository.ts；新增 tests/integration/director-recovery.test.ts 与本报告。server/npc-agent-advance-services.ts 仍 root 唯一写入。
- 0 SQL迁移/真实模型/生产/HTTP/全check/build。本地PG55566、原75迁移；全部模型为显式mock，使用独立合成世界，不改编剧草稿和真实玩家世界。

## 实现

新增 DirectorRecoveryStore 继承原 DirectorAttemptStore，不破坏旧应用测试的 store mocks。`prepareRecovery(ownerId,currentSnapshot)` 在 world→pending attempt 同一短SQL事务枚举该世界的active槽：

- reserved/request_sent/unknown_after_send 保持 blocked，过期lease也不推定“未收费”，不释放槽位或自动重调。
- response_received 首先核当前调用者snapshot的真实world/epoch/clock/boundary/actor/cursor/episodes/pending范围；调用者读过期时抛冲突，不误废弃合法raw。
- 与原snapshot做结构深比较：JSONB对象键顺序不影响，数组顺序保留原语义；对比candidate完整payload/blocker/actor/boundary/cursor/setting/cast/episode/change/observation/focus。
- storyAt可在同一时间条件区间内前进，不能倒退；人物计划trigger、动作precondition、责任nextCheck/deadline及blocker.reconsiderOn的at_or_after越界则frame_changed。当前候选本身没有额外时间窗字段；未来扩展需同步恢复规则。
- frame变化或原lease已过期，只将原response_received→stale_discarded；原raw、snapshot、hash、command和其它身份均保留，释放active唯一槽。不改0075不可变token/lease规则。

新增应用 helper `recoverDirectorAgent({attempts,parse},ownerId,currentSnapshot)`，无模型端口：ready只以原snapshot/raw解析并提交；并发导致原frame在prepare后改变时，已知CAS冲突标原attempt stale，返回明确分类。解析失败标invalid_output并保留raw，不伪装unknown或重新请求。所有业务提交仍沿用原store.commit事务，未新建旁路。

## Root 必须完成的实际接线

在coordinate取得当前真实snapshot后，生成/lookup新command和runDirectorAgent**之前**调用helper：

- none：走现有新协调。
- recovered：直接return原decision，不能再调用模型。
- blocked：按原attempt状态给UNKNOWN/BUSY；不创建新ID绕过。
- stale(frame_changed)：可继续当前**新语义frame**，原command状态/结果仍可追溯。现command seed仅worldV+candidate IDs，同worldV但blocker/focus/payload变化可能仍得旧ID；应明确停止或使用真正语义变化的稳定identity，不能用随机ID/时间tick强行再买。
- stale(lease_expired)：同frame不得自动购买另一请求。旧command留stale，runDirectorAgent原本就拒绝再发送；若新world/frame有独立推进原因，按新frame独立处理。

此批未自行修改server，不能据helper存在宣称线上已接好。原command committed回执仍原样重放，不重新解释。

## 实际验证

新增实际PG 18/18（17子项+父），0失败/0跳过：

1. 无pending零写返回。
2. director_decisions插入处真实SQL故障→protected raw保留→同frame恢复同attempt/command，模型仅首次1次；原command已提交再读不调模型。
3. 同样真实SQL故障→NPC B通过真实private service/kernel提交→worldV1→恢复标旧raw stale且hash/body不变→新frame正常claim/commit，不再卡旧slot。
4. prepare之后、commit之前B真实推进，原decision不提交、raw标known stale。
5. reserved/request_sent/unknown_after_send各自B推进后仍blocked，claim仍DIRECTOR_ATTEMPT_PENDING，不重发不丢raw。
6. 同worldV改变candidate完整payload、blocker、focus、observation、setting，各自废弃旧raw。
7. JSONB键顺序反转与同时间条件区间内clock增加仍可恢复；跨已有责任deadline则stale。
8. 真实等待原短lease过期，raw仍可追溯、原command拒自动重买。
9. 过期caller snapshot/跨owner拒绝且不误废弃当前合法raw；畸形known raw明确invalid仍保留。

联合真实PG director-recovery + director-runtime + npc-agent-advance-service：**50/50通过，0skip**。既有pure run-director-agent + director-agent-model：**73/73通过，0skip**。typecheck通过，模块边界544文件通过，4源码/测试Prettier检查与git diff --check通过。

忽略日志 `.local/ma44-director-recovery-pg.log`、`ma44-director-recovery-joint.log`、`ma44-director-recovery-pure.log`。本地合成世界clock在test.after暂停，PG55566结束释放。模型阶段没有引入新事务；helper全部为短数据库操作和本地解析。

## 限制与交接

源与测试冻结交root；root负责接实际advance、全check/build、整体真实PG、生产迁移核对/部署READY/公网及用户授权的真实模型产品验收。这里没有HTTP/worker真实入口验收、没有真实模型人格质量结论、没有激活epoch2或发布任何世界。没有新增author事件/媒体/travel等尚未实现能力，不取消其待办。
