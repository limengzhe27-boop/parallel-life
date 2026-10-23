# 44-199 主动联系与事件推进精简

状态：进行中，未上线。集成人 root-proactive199；开工 main 0e42a2e4（并行文档随后推进至51be078f）。主目录其他登记/RECORDS-NOTES报告由原负责人保留。

## 实际调用链与断点

手机 time-experience-policy 5秒轻量检查 → world-phone-app checkForWorldNews → 原 advance / advance operation → npc-agent-advance-services → 调度来源与 scheduleAgents(selectAllIndependent:true) → 既有 batch → NPC snapshot/model → run-agent → kernel短事务保存事件/消息/回执 → 原消息轮询/未读/通知。

后台 pg_cron → /api/cron/proactive → 既有 run-proactive-scheduler → claim_proactive_worlds → 同一 advance。生产只读核对2026-10-23：job3每30分钟，目标新域，108迁移校验一致；最后08:00/07:30/07:00成功。

仍存在的旧阻断：localInitiative统一30分钟且只选最久一人；batch额外只放一个actor_local；前台sending与每次对话刷新活动时间阻断；后台4小时+错误六租约行全局日限；未知请求SQL整世界排除；主观正则过滤人物文字及锁屏通知。

## 复用 / 待集成 / 修改 / 新增

- 复用：人物状态/可见上下文、事件目录、导演、独立候选selectAllIndependent、handledActorIds、batch限额、attempt/lease/unknown、原内核与Outbox、通知队列。
- 待集成：phone199前台检查，attention199焦点/通知，scheduler199后台领取/容量。
- 修改：删除上述业务阻断；自主候选使用每现实分钟稳定工作身份，同一窗口刷新/世界快进不新购；跨窗口unknown仍由人物锁阻挡。不是每分钟强制发言。
- 删除：专用单人物batch状态、30分钟冷却及其额外数据库查询、无用userInactiveMs输入、主观台词过滤模块。
- 新增：仅增量数据库函数迁移与必要测试/报告；无字段/表/审批/评分/第二套调度。

## 文件职责

- agent-schedule-collectors.ts：全部独立人物获得考虑机会，稳定身份，不以正式任务为资格。
- agent-advance-batch.ts / npc-agent-advance-services.ts：移除local专用单人限制，原预算/人物互斥保留，删冷却专用查询。
- run-agent.ts / proactive-quality.ts：移除主观删词；原parse及kernel真实动作结果/依赖校验仍在。
- npc-agent-model.ts：现有提示允许人格/情绪/关系表达，不新增协议字段。
- phone199/attention199/scheduler199具体文件由各自报告记录，统一集成部署。

## 验收

必要纯测试、真实PG多人物/unknown与100世界容量，check/build；正式渣男体验作为主验收（无输入60–90秒、持续五分钟、与A聊天B来信、返回与未读），不复制重发作品、不手工插消息。真实模型与受控测试分别统计。部署新账号parallel-world-eosin，旧项目不删。

当前证据：73/73纯测试通过，含无任务双人物、真实分钟稳定身份/消费去重、跨窗口unknown仅挡本人、情绪对白不被静默删除。不能据此宣称真实人物主动推进已通过。

## 接续

并行包尚未集成；真实PG/旧档体验/手机PC/部署未完成。旧项目cron未停仍是44-198遗留风险，本任务不伪称已消除。

## 集成检查（2026-10-23）

已集成attention f31bf4c1、phone8bdf122b、核心3d7046cf、scheduler62a7ae8a、multi6ce8407a；Grok独立7727bd14合入a268d86a，媒体仍由原Agent验收。check首轮唯一失败为旧promptVersion断言，修正后45/45与最终check3951/3951通过；build通过。0109生产已应用，109迁移，无新增表/字段。

受控PG双NPC同批、分钟窗口接续、unknown本人隔离3/3；100世界PG领取+受控执行器两tick覆盖（非100世界真实模型/全内核容量），服务unknown核心用例通过。旧整advance夹具18项中13项旧失败保留，未伪称全数据库套件通过。后台预算复用3人物/6模型/8步/45秒停止启动；每调度请求2世界并发，最多50世界/240秒停止领取，不中止已发送调用。

现有正式渣男体验验收坐标：当前浏览器账号“渣男体验，继续这段人生”进入4953ca0f-56c4-4e92-9279-324031142356，修改前v41；2026-10-23T08:09Z只读记录保存在.local/proactive199/before.json。锁屏当时显示的是更早消息，不作为本轮主动证据。

下一步：新域READY、cron既有job调为每分钟触发（每世界后台30分钟）、同档手机PC五分钟和聊天并发真实验收，记录新增调用/投递/错误/耗时。

## 首轮公网与后续根因（2026-10-23 08:21–08:35 UTC）

部署dpl_37GYsTCy9U2cJpNdRHed9MSGunp8 READY，新域指向bf726bb9业务。既有cron job3由每30分钟改每分钟触发，单世界后台30分钟领取未改变。正式world4953… UI基线08:21:18 v74，约48秒后v78两条新消息；锁屏截图含随后李之之、刘胜男、舒雅婷新来信。未把作者历史消息当本次生成。持续超过五分钟多人物有实际新提交，但重复等待较多，故**持续剧情质量未通过**。

真实刘胜男snapshot审计：12条近期观察全是本人来信，最近玩家原话被挤出；人格5269字完整、最近本人6句完整，非预算裁剪。修复actor-context优先保留最后玩家原话，沿原预算/知情，无新字段。actor_local已有reason原未传入wake，复用wakeCue传入，并去“必须阶段”的强制措辞。

测试发送真实一句“今天先不约见面了，先把公司的事情说明白。你现在最需要我处理的是哪件事？”后，页面长等待，最终连接失败；无/messages资源记录、无对应人物输入attempt，不能记作聊天通过。定位发送前await startConversation→clock sync串行队列；随后还有完整world GET。phone199负责解除这两项发送前依赖、保留错误原文和稳定命令。

生产只读锁采样：publication_story_offer_context并发19–33秒，world SHARE/UPDATE等待21–23秒；实际该正式world旧publication_story_nodes=0。0110仅保留授权后空候选短路、约束旧查询到当前world，不增字段/表，不改变有旧邀约的权威校验。group read/list也需只读一致性快照，写路径锁保留。未发现模型调用期间持数据库事务。

媒体Agent额外定位非stream聊天未传onMediaCommitted，8cc83f46已集成6bd14800；原任务pending未派发，经原outbox接续后真实图ready、聊天/相册已有资产。公网最终验证仍由媒体Agent完成，不用重发索图修数据。

## 后续集成与容量边界

6eaacb96玩家原话、b6c26d97唤醒原因、6bd14800非stream媒体回调、3f00f7e8群只读快照、904dac32发送前阻断、e1e80804空旧邀约SQL已集成。0110生产已应用（110迁移）。新增PG旧/新offer5/5等价且权限拒绝；旧followups两子失败在0049也复现，非新增。最终check3961/3961、build通过。

后台每分钟触发与单tick最多240秒领取窗口可重叠，生产出现资源争用，故既有cron收敛为每5分钟（job3，仍新域）；每世界30分钟与在线/返回即时检查独立。单tick2世界并发/50上限保持，不新增全局计数/字段。受控100世界两个tick可覆盖，但真实模型耗时与生产容量仍需监测，不宣称全负载SLA。

## 第二轮真实发送反例（08:44 UTC）

e09a4d17 Git部署dpl_Ea1kJPPLsD7S5im72xdvxYAXKdGg READY且promote；随后同SHA干净归档dpl_ATVBQNVdDY5FjQBVtJSNsArGRqP5 READY。正式档读API降到375–573ms样本，按钮立即出现用户气泡并发出/messages，无旧clock/world前置等待。但command ed1b3823-d990-4d28-98be-7d2c4bc6cd53模型4.6秒后UNKNOWN，不能算聊天通过。

服务日志failureCode=CANCELLED/model，DB首段status=superseded_by_interrupt。实际并无用户打断：模型基线v99，李之之v100仅本人消息+plan+episodeDecision写入，旧resolveAgentCommitVersion blanket拒绝，onStreamEvent自己abort付费响应，导致没有完整response可恢复。修复范围收敛为：他人私人状态按原episode依赖证明不相交才放行；真实共享变化仍重验；VERSION_CONFLICT不能伪装用户interrupt或主动丢弃已付费响应。旧unknown保留，不重买、不伪造完成。

另实测内容仍有角色分工混淆（李之之说见父亲、青青说照护交接）及重复邀约；记录为持续演绎质量未完成，不以多条来信证明剧情正确推进。地图/人物/故事原文未手工补写。

## 最后一处保存并发修复（16:58 CST）

91afdb6c允许其他私人actor的纯状态变化；episode选择沿原snapshot/request表证明不相交，缺证据/共享episode/行动或位置变化仍拒绝。86ec58a9在首段版本冲突时不再标用户打断、不abort付费响应，继续读取并由原最终提交/恢复检查。未新增字段、表、审批或模型调用。

必要验证：准入SQL/单测7/7，带root最终调用方修改的真实PG并发6/6、恢复9/9，check3961/3961、build通过。原unknown command保持未知，不重买、不清状态。待新部署READY后正式档再验收。
