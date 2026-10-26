# SCENE-EARLY-WAIT-01：早到普通现场中的合法等待与约定接续

负责人 npc-early-wait-20261026；基线 ec1db7f2；独立工作树 `.local/worktrees/scene-early-wait`、分支 `codex/scene-early-wait`。root 为唯一集成人。本批不接触原存档/远程数据/真实模型/图片生成/本地应用端口，不部署，不修改 agendaCollector。

## 真实断点

原 appointment.wait 和 story.wait 仓储遇到任何 current_scene_id 都拒绝；scene.enter 对任何已有现场也拒绝。用户早到同一约定地点、进入普通现场后，即使没有待处理动作也只能先离开才能等待，随后另建现场，割裂了历史和体验。

## 实现及边界

- 新只读 `readSceneWaitContext` 在调用者现有世界事务锁内认证当前体验/现场归属、原 scene.entered 成功命令及来源版本、玩家仍在场、实际地点一致、场景已真正 opening，且无未决现场动作/open scene question。现有已投影实际位置优先；没有该投影的旧引擎沿用已有权威 world.space.currentPlaceId，遇到明确 unknown/in_transit/不同地点不回退猜测。
- 纯领域 `canWaitInAppointmentScene` 只放行 confirmed 约定、唯一同地点、当前 active scene、玩家在场且无待处理内容；普通 scene 可等待，同一约定 scene 可继续等，不放行别的已绑定约定。
- story.wait 仅对上述现场允许 next_appointment，继续原“赴约前10分钟”保护边界及来源认证的重要剧情/消息停点；不放行现场休息到明早或任意等30分钟。
- appointment.wait 在新放行的 active scene 复用原 story.wait 保护查询；有重要信息、未完开场或更早剧情边界时拒绝直接跳过，现场与时间不动。保持旧 appointment.wait 事件/回执精确到约定时刻的协议，不增加 stop 字段或放宽 reducer。非现场的原等待行为不变，可选未接受邀约不会被本批重新变成全局阻塞。
- 到时间后 scene.enter 可将该 confirmed 约定绑定到原普通现场；仍保存真实新命令/事件/回执及后续任务，原 sceneId、原来源、历史条目、presence 区间保持不变。不创建第二个场景，不增加 NPC presence，不新建旅程，不完成/消费约定。相同请求重放返回原回执。
- 手机 canWaitToAppointment 移除“只要有 currentSceneId 就禁用”的唯一条件；继续现有地点/confirmed/忙碌检查，严格现场资格交由同一服务端命令检查，不增加调用或字段。
- 按 root 追加要求，同步 origin 上批提示词版本测试期望 v69→v70，仅改一条必要断言。

未新增 SQL、迁移、业务列或存档字段。仅增加内部只读上下文。

## 验证

独立 PostgreSQL 55674，使用原仓储、队列与受控 planner 开场，再切换 epoch2 验证新引擎命令：

1. 真实 opening task 阻止等待；原 worker 提交 opening 后解锁。
2. 同一普通现场 story.wait 到约定前10分钟，appointment.wait 到约定时刻；重放不重复。
3. scene.enter 沿同一 sceneId 绑定约定，历史和 presence 不变；仅一条 scene_session，约定仍 confirmed，NPC 行程数0。
4. pending 现场动作即使相关任务已取消仍阻止跳过。
5. 真实取消操作后不能等待或绑定旧约定。
6. 认证上下文的 owner/world/scene/place/约定绑定/状态/玩家在场/未决条件负向；其他 owner 读不到上下文。

当前结果：新 PG 5/5（父项+4子项）通过；既有 appointment.wait PG 14/14通过；npc-agent-model 49/49通过；typecheck 0；boundaries 733 files通过；diff --check通过。未重复全量check/build，root统一集成构建。

额外跑原 domain appointment/story wait 与 story.wait PG 时，旧 story.wait PG 唯一子项失败为“expected speed12、actual3”，是现有产品速度与旧 fixture 不一致；其余保护旅程通过。未借机改该任务范围外的旧速度断言。

## 未宣称完成

未在用户原存档、真实模型或浏览器实际点击等待验收；这些由 root 统一安排。本批没有让 unknown NPC 瞬移，人物自主赴约/媒体/主动推进不由本任务代替。appointment.wait 不能返回中途 stop：遇到重要边界明确拒绝直跳，需用原 story.wait 先到受保护停点；本批未另建事件协议。已绑定同一约定的现场按现有前端 navigate 返回，不再重复绑定/重复开场。
