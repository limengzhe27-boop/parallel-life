# AGENDA-ADMISSION-31：删除跨请求的重复禁用

2026-11-03，root唯一集成。用户指定继续原2fb渣男体验，不重启3218/3219，优先删减已有机制。

## 根因与实现

readOwnAgendaReviewWorkInTransaction在原grant/family、活动请求与预算检查前，通过paidContinuationBases按人物状态摘要拦截。历史一次失败会一直阻止后来已完成独立回合形成的新anchor；仅额外编写的playerContexts例外才能解封。该限制扩大了原请求防重范围。

0901873a删除这层摘要禁用、专属domain函数、无用派生paidContinuationBases、playerContexts例外及相应查询材料。保留原transportHistory同family防重复、actorBlockers对unknown等活动请求的隔离、完整提交证明、时间退避、预算、权限和版本检查。不新增字段或数据迁移。不修改旧attempt、不使用换ID重试原请求。

051ae6c0集成13项真实PG验证：旧command不可重买；时间/他人/partial不产生新anchor；本人完整独立回合可以接续；unknown原生命周期、退避与预算保持。

## 原档真实验收

只读对照：原逻辑六人无候选；简化后林白语与李之之可进入既有合法窗口，其他人物仍受原请求/unknown保护。

一次正常advanceIfEnabled，maxActors=2/maxModelCalls=2，无force/retry参数，使用现有模型、配置、原世界2fb97a4a-7282-4d75-8a5c-67faf44a3188。没有伪造玩家输入、手填消息、改角色计划或清失败记录。

- 林白语 c3187565-f3d0-4150-a713-c4f84cb1d31a：committed，从sent_at到updated_at约5.47秒。
- 李之之 2567a106-5b86-43e7-9156-043130f5cc97：committed，约7.62秒。
- 两者statements/plans/actions均为空，仍为no_current_intent。前者等待旧问题回答；后者等待回答并引用媒体失败。
- 因此证明调度准入和模型保存已恢复，未证明人物主动发来新消息或剧情持续推进。没有继续付费调用来凑成功。

## 检查及运行边界

npm run check：4176/4176（删除原重复domain对应2项测试），0失败/跳过/todo。真实PG13/13。独立临时目录npm run build通过，未覆盖运行中的.next。

未重启/新启动3218或3219，未重启worker；当前浏览器服务仍运行上一构建。一次原档验收直接调用同一共享服务的最新源码，结果持久保存，不能冒称浏览器整套代码已更新。

## 剩余

- 已恢复评估的两人仍把旧等待作为无事可做；需核对输入材料、事件任务来源与真实行为，不强制消息。
- 其他人物原请求unknown/同family失败仍阻断，不自动重试。
- 只读管理员查询确认：原发布内容中actor_1姓名青青但lifeModules是23岁校花材料，actor_2姓名林白语但lifeModules是21岁邻家青梅材料；world actorId→contact actorKey→作者name映射正确。错配已存在于保存的发布内容，不是运行缓存串key。未改原稿或运行绑定，继续追查作者导入/保存来源。
- 原世界持续自主演绎、锁屏收到新消息尚未验收通过。
