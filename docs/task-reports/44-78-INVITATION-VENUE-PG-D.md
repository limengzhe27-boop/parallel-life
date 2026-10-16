# 44-78-INVITATION-VENUE-PG-D

2026-10-16，codex-ma44-invitation-venue78-d，**待根集成验收**。独立 `/Users/limengzhe/.codex/worktrees/author-eligibility63/人生剧本`，分支 `codex/invitation-venue78`，准确基线 root `8722bb8586156580b301a3e8aa1afcaba2b554fc`。

测试冻结 **`edf9087e75cb5eb1110310c63378efd63d0685bb`**。仅新增 tests/integration/agent-invitation-venue.test.ts、本人报告、主镜像及主表本人行；所有公共源码/SQL/旧测试/CI只读。根唯一公共契约、源、集成与发布负责人。没有发现需根修复的产品问题。

## 真实链路

真实 PostgreSQL18.4/pl_app/pl_worker、实际 world/agent 初始化与 epoch 切换；普通私聊经 npcAgentServices、实际 input/attempt/NpcAgentModel/runNpcAgent/kernel；silent 经 actual npcAgentAdvanceServices 与真实 DirectorSnapshotRepository；群经实际 groups.create/send、worker claim/nativeNpcTaskHandler、原 task 成功提交。TextModel.complete 全是明确本地替身，模型调用前确认没有持有数据库事务，不调用真实模型。

普通合成世界有两个已知地点 home/cafe 和真实定义的步行 route，没有 NPC actual position。silent fixture 声明有合法起点事实来源的本人待考虑邀约计划，不伪造已发生结果。隐藏地点负例另外通过真实 publisher role 的 create/check/publish、实际 compilePublicationGenesis/PublicationWorldRepository.startPublished 创建绑定世界：作者内容中确有 knownAtStart=false 的 hidden_place，实际世界地图与 NPC context 均没有该地点；不是只给一个不存在的 ID 然后声称已覆盖隐藏内容。

## 11 项实际 PostgreSQL 验收（含父测试）

- **私聊成功与重放**：可选 placeId=cafe 出现在实际 turn.resolved 的 appointment.proposed effect；同一事件写 proposed 日历投影和 space.places[cafe].appointmentIds。真实 map read 和 hydrated world 都只关联一个地点。原命令精确重放只返回同一 event，模型仍1次、完整业务行及 replay clock 不变，没有重复 invitation/link/result。
- **silent**：actual advance 消费本人 ready 邀约计划，通过真实 kernel 保存 agent.state_committed，place/calendar/link 同源；played0/actors[]，无私聊消息，故事时间仍09:00。
- **原生群**：实际群 task 的 NPC 提案经同一个 kernel，在 group.turn_resolved 保存相同 venue/calendar/link，并实际完成原 task；群内有合法台词，world_messages 无私聊替代。旧 task lease 再调用为 NOT_FOUND、0新增模型。该世界从 V0 起的完整实际事件可重放出相同地图和日历。
- **无 placeId 旧输入**：原成功邀约保持兼容，effect 不出现 placeId 字段，日历仍 proposed；空间完整不变，不默认为当前位置或猜地点，重放一致。
- **unknown/真实 hidden venue**：两者均只使邀约 action failed，failureCode=APPOINTMENT_PLACE_NOT_AVAILABLE，outputRefs/completedGoalIds 为空；依赖成功的台词被过滤，独立有效台词可保存。没有日历、map link、额外地点、责任或事实变化；本人 goal 仍 active。隐藏原稿地点名称哨兵未进 NPC payload，地点 ID 也不在其 boundary。
- **两类 prepared snapshot 负例**：从实际 accepted input/readPrivateAgentSnapshot 取得 frame 后，故意移除实际 cafe 的 boundary ID，或给 boundary 添加不存在的 forged_place；实际 run/model/kernel 都运行，但不能仅凭准备快照授权 venue，动作仍失败且无 invitation/map link/依赖成功台词。核对了 boundary 和 actual place 双门槛。
- **实际晚期 SQL 回滚**：只在专属世界 agent_action_results BEFORE INSERT 临时触发 SQL 异常；原 paid completion 留 response_received/sent/raw，world/calendar/map/messages/state/results/commands/notes/journeys 全事务回滚。移除触发器后原 command/input/attempt/raw 免费恢复提交，模型仍1次，且保存的 protected envelope 完全相同；没有第二 invitation。
- **旧接口闭环可读**：新 venue link 的邀约先由实际 appointment-wait 识别并拒 UNCONFIRMED；玩家通过真实 respondToInvitation accept 后仍在 home，等待仍拒 NOT_AT_PLACE。只有实际 player travel(home_cafe) 后才可用原 wait 接口等到10:00，原 wait 命令可重放。最终日历仍 confirmed、没有自动 attended，本人 goal 仍 active，NPC 没有 journey/到场证明。完整 accept/travel/wait 的实际事件历史重放与持久地图/日历一致。

成功用例额外核对：participantIds 只有提议者，sourceEventId 精确等于实际创建事件；没有 responseAt/responseVersion；新责任是 waiting/player，无 deadline/nextCheck，既有 clock 的故事时间和 speed/paused 不被邀约变成等待或截止；动作完成仅表示 proposal 成功，completedGoalIds=[]，不让 goal 自动 fulfilled。地点绑定本身不移动玩家或 NPC，不建立同意/出席/事件结果。

回滚逐行比较10类实际对象：world state/version、world_events、world_messages、world_appointments、actor_agent_states、agent_action_results、commands、world_group_messages、world_notes、npc_journeys。input 的真实接受与 paid raw/status 单独检查，不伪称发送尝试本身从未发生。

## 检查、夹具修正与清理

最终 `node --experimental-strip-types --test tests/integration/agent-invitation-venue.test.ts` **11/11 通过、0 fail/skip**。`AGENT_INVITATION_VENUE_TEST_PORT` 默认55505；最终 tsc --noEmit exit0，模块边界567文件，专项 Prettier/diff check 通过。证据在 ignored `.local/venue78-{test,type,boundary}.log`。

首次把合法 private turn 的 wall-clock lastTickAt 重锚也当成必须不变，导致1个用例失败；仅修本人断言为首次故事时间/speed/paused不变，以及精确 replay 后整个 clock 不变。隐藏 publication fixture 首次没有将端口 originKind=published_work 适配为 compiler 的 published，只修本人夹具（type与实际开档同时指出该错误）；没有改产品或弱化动作失败/投影/重放/付费次数断言。

scoped venue78 触发器/函数均 finally 清除，最终 pg_trigger/pg_proc 对应catalog各0。开服前确认55505空闲，结束正常终止本人 local-db 父进程，原会话91575 exit0，55505无监听。根55564未触及。

0真实模型/生产/公共源SQL旧测试CI/UI写入；未跑 fullcheck/build。无 actual NPC position 的 scene 不手补在场，不声明现场完整旅程。77 只是可选已有地点关联，不是67自由原稿交接或68事件发生/完成协议；完整44/69仍由根继续推进。根负责统一总检、正式迁移确认、部署 READY 与公网验证，本测试冻结不等于已上线。
