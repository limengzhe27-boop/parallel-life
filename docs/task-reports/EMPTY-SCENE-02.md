# EMPTY-SCENE-02 · 无熟人在场时承接现场输入

负责人 empty-scene-02-20261027 /root/empty_scene_runtime。独立 `.local/worktrees/empty-scene-02`、分支 `codex/empty-scene-02`，基线64535181。root唯一集成及双端口控制。本任务不启停用户服务、不调用真实模型、不写原存档、不部署；0新增SQL/表/业务字段。

## 原断点及实现

原 `nativeNpcTaskHandler` 在已认证scene输入、原receipt和任务租约之后，发现实际可回应actorIds为空就抛NO_ACTOR_PRESENT，玩家输入已保存但任务失败。现同一scene任务走环境叙述；群聊无人仍不套用环境处理，已有NPC路径不变。

- `npc-agent-channel-services.ts`：无actor且channel=scene时调用环境处理，第三个可选工厂用于区分scene模型与人物模型。
- `worker-composition.ts`：仅一行将既有createSceneTextModel传给该工厂；没有新增worker、循环、队列或剧情引擎。
- `server/empty-scene-environment.ts`：只提供当地时间、地点已有设定、当前玩家行动与玩家可见的最近现场历史，最多12项。没有人物persona、位置真相、私人记忆或未来作者事件。单次最多700 tokens的既有scene快速模型仅返回严格feedback文字，不得输出人物ID/执行状态/事项变更。文本须区分“没有听到回应”和“确认某人不在”；不编造门锁/物品变化、人物隐私/决定、付款或移动成功。仅已有设定/观察明确存在的环境人员可用简短间接引语，不创建联系人。
- `scene-repository.ts`：scenePlanning/commitSceneProposal增加仅服务器使用的environmentOnly参数，复用原事件、worldResults、scene_items、任务事务。环境模式跳过全NPC记忆读取与作者未来邀约材料；准备和提交都检查仍是原active scene、玩家真实位置、原action尚未结清、实际无actor。
- 输入时有NPC观众、执行时离场，不悄悄将定向原输入改成环境回应：模型前SCENE_AUDIENCE_CHANGED。新输入可按最新现场处理。没有重评旧未知请求。
- 无关NPC私聊在生成中插入时，复用已有acceptsTravelVersion的连续成功事件证明，按实际版本追加。新scene输入、移动、取消、缺口或未知影响不放宽。
- 环境处理只追加narration/adjudicated_result；实际attempt结为resolved/partial，表示输入已得到观察反馈，不证明开锁/交易/他人执行成功，不留长期pending。计划/假设保持非执行反馈。服务端拒绝环境提案带NPC、对白、任务/步骤更新或succeeded操作结果。
- 原任务成功与结果在同一事务保存，清除error_code。原任务身份/租约、epoch和当前世界保护保留；重复任务不能再购买，网络结果未知保持unknown且不自动重试。

## 文件范围

src/server/empty-scene-environment.ts（新）、npc-agent-channel-services.ts、worker-composition.ts仅工厂一行；src/modules/world/infrastructure/scene-repository.ts；tests/integration/empty-scene-response.test.ts（新）；本报告。未改前端/公共协议/SQL/调度/NPC模型配置。

## 验证

独立本机PG55683的parallel_life_test，pl_app实际业务事务+pl_worker真实claim：新旅程6/6（5个子例+父项）通过：

1. 保存公开发言→环境反馈→action resolved partial+task succeeded；仅玩家在场、无NPC对白；相同请求与任务重放不增条目、不重购。
2. 用户索求开保险柜/转账，严格模型输出拒绝夹带执行字段；内核拒绝环境succeeded/人物或事项变更。合法反馈不新增世界事实、约定或微信消息。
3. 生成中另一人物通过原npcAgentServices提交独立私聊：环境按实际v+2追加，模型仅一次、现场无冒名NPC。
4. 网络UPSTREAM_FAILED经原runOne标unknown，claim不能自动重买，无伪造反馈。
5. 生成中presence变更：提交重验拒绝过期“无人”反馈，未保存新环境结果。

已有 `agent-scene-npc-service.test.ts` 原样8/8通过，包含在场人物真实答复、伪造来源/到场/错误任务/离场等负向和lease失效后复用保存response，不放宽旧断言。

完整check4055/4055通过，boundary749/typecheck0；build结果冻结时追加。专属真实PG在最后元数据清除改动后再次6/6通过。所有模型均受控适配器，不称真实自然体验通过。

首次check因为新独立dev库尚未迁移，旧两项unit中的数据库夹具未能收尾；只停本人测试进程，给独立parallel_life_dev应用仓库既有迁移后重跑完整check通过，没有修改测试或生产库。

## 尚待root集成验收

原用户办公室旧失败任务未重写，旧unknown不重试。root需统一构建加载后，通过现有存档的新现场输入验收真实反馈；手机界面、主动剧情与人物合法到场由其他任务处理。反馈是受限叙述，不是通用物理/交易执行器；材料未确认的陌生人不能凭场所类别强行出现。真实模型表现及双端本地页面仍由root完成，未声称线上生效。

最终门禁：Next生产build通过，未启动该构建；prettier专属文件通过、diff-check通过。root接管集成/真实模型/本地运行更新，发布要求按用户最新口径仅本地。
