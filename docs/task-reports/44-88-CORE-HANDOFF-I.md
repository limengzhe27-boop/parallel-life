# 44-88 核心链路限定增量

Owner codex-root-ma-arch44-i，唯一集成人；history-chat-media / codex/ma-arch44-integration，基线f351e221。小安独立验证；88A/88B各自新增文件，公共协议、SQL83及接线均由root完成。

## 已实现

同一导演→SQL81请求→人物snapshot→发送门→原kernel支持选择每个NPC本人授权目标、计划、责任的稳定引用。内容、状态、来源变化、遗忘和跨人引用阻止投递。甲提交不因全局版本变化使乙的未变主题失效。只传对应人物事项，不传导演全局描述和别人私聊。历史策略依据不恢复原私聊正文。

原提交hook追加邀请提出、准确玩家接受或拒绝、出发、实际到达的子证据。SQL校验committed来源、epoch、actor、精确action/outputRef及episode因果；重复相同记录保留，冲突拒绝。导演能读取实际结果，但不会自动将子步骤算作整段事件成功。

位置告知按原群消息可见性或现场entry.observableTo与原presence传播。私聊不扩散，晚加入无旧告知，离群不抹去已获知内容；重放重新认证原输入受众。认知仍为player_report，不改真实位置、不广播全地图、不以同地点制造目击。

## 必要验证与修复

check3126/3126、最终build/type、聚焦format/diff通过；最终事件交接真实PG30/30（邀请到接受、导演结果读取、幂等、伪造对象拒绝、跨人主题隔离），kernel/native/arrival真实PG32/32（群消息实际内核到双受众认知、原私聊隔离、任务unknown），独立受众PG5/5与角色权限2/2。重复运行不累加覆盖。

新83本地迁移先发现shared_episodes只有(world,id)唯一键及PLpgSQL IF内CASE需括号，生产应用前已修。首次接受投影发现command.result_state的appointments是紧凑空投影，改从原成功创建事件的appointment.proposed effect确定性还原before，原红例转绿，不手工补剧情。

生产2026-10-16T03:23:52.813Z已83/83；83 checksum cc245f3d18bcd3e5f97eb2ddff7ba7764bb51d917333ad8e3768561e4e909173。RLS/FORCE、app只读插入且无UPDATE、worker无读取、invoker trigger无直接EXECUTE核实；原稿、副本和受保护玩家世界不变，nativeworld0。0真实模型、0生产测试存档、0图片。报告冻结时部署READY待核；最终部署状态以主登记最新记录为准。

## 未完成

普通自由原稿的按人物语义拆解与全新具体机会的完整交接仍未实现；本次是本人已知事项的具体跟进，不是完整剧本自动演绎。原typed建议和可选首段提示保留，不要求编剧为本片重写原稿。仅由旧episode意图支持的事项暂不递归作为新主题，避免循环自授权。

复杂事件的实际发生、整体结果政策、改期后的新revision、退出与再次考察，完整主动观察和房间视线、模型消费回执，旧档接管回滚、旧路径退役和真实模型连续旅程仍待实现或验收。生产不启用新引擎。
