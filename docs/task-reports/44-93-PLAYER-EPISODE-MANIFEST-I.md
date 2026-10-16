# 44-93 玩家当前回合同次承接待处理事件

唯一公共协议、SQL与集成人 codex-root-ma-arch44-i；history-chat-media / codex/ma-arch44-integration，基线81c0719f。93A独立新增数据库测试，小安94独立开发后续计划责任纯组件；公共文件不交叉。

## 实际链路与状态归属

原 npcAgentServices.accept 保存真实player原文 → readPrivateAgentSnapshot 从本人pending请求与已授权具体意图选最多一个 → 同一 runNpcAgent → 原发送短事务核owner/world/epoch/actor/input/source/hash/revision并写不可变attempt-request binding → 同一次人物模型返回普通回复及可选episodeDecision → 原kernel重核binding/来源 → 原事务事件、人物状态、结果、episode receipt与Outbox。

没有改写player正文为coordination JSON，没有额外人物调用或导演调用，没有临时开场旁路。manifest由服务器生成，不接收客户端同名字段。只下发本人已授权的作者建议/本人事项/可选作者提示；不能以全局导演描述补齐被裁剪信息，无合法个人意图时保持原请求待处理。

绑定在付费前保存，原attempt仍是状态权威。unknown、已付费invalid/stale和response_received阻止同请求换command重买；response_received沿原snapshot和raw恢复，不重选新manifest。旧coordination六键输入/hash及旧receipt恢复路径保留。

显式本人决定才消费request；普通天气等回复不写unassessed receipt、不消掉事件、不推active。后台与手机提示共用binding资格，避免成功普通回复后立即再买一轮主动联系。后续新玩家回合可合法重新携带；新的自动重考cause/revision生命周期仍后继任务，不靠自动重试掩盖。

## SQL84与兼容

新增agent_episode_attempt_bindings，append-only、RLS/FORCE，app仅SELECT/INSERT，worker无SELECT；核原reserved attempt、真实private/player receipt、本人pending request/current epoch/版本。原81 request guard新增严格player绑定分支，先辨origin再对旧coordination正文parse JSON，普通中文不会触发错误转换。receipt还核实际committed事件、私有决定和实际消息，与原request消费同事务；不修改已应用81/83。

回滚策略：84为扩展表及保持旧coordination分支的guard替换，代码可回滚到81c0719f而保留84及全部付费绑定/收据；不删除已应用迁移或以回滚清除unknown，不更改旧档epoch。生产本批epoch2仍0，因此没有接管旧玩家数据。

迁移84 SHA256 c16610235ea73d79505bdcc2ae83d63badfc414e7300e45c4b5a2749238f4b3b。部署顺序：生产只读核83与保护数据 → 应用84并核权限 → 推送关联身份提交 → 精确正式Nu READY → 公网保护入口检查。生产原世界/原稿不改，epoch2不在本批启用。

## 必要验证

93A独立真实PG7/7，root集成同专项7/7：普通中文一次NPC调用消费、未评估保pending/后台不重发/新player再带、unknown原/新command不重买、另一个人物粘JSON无授权、篡hash/request或剥来源发送前拒绝、存储回滚后的原raw恢复0额外调用。旧actor intent真实PG30/30保持。局部纯协议73/73、模型适配18/18；最终check3129/3129、build、类型与聚焦格式/diff通过。生产2026-10-16T04:15:44.472Z84/84 checksum及RLS/FORCE/ACL通过，保护数据未变，epoch2=0；READY与公网证据接续主登记。不将独立与集成重复运行累加，不使用真实模型或生产测试存档。

## 未完成范围

小安94后续生命周期组件待公共接线，不将pure helper当作运行完成。整段事件结果/改期/退出/自动重考、自由原稿逐人完整语义交接、完整观察/旧档接管与旧引擎退役仍在总表。自然模型连续演绎未验收，生产新引擎仍未启用。此次交付仅同一人物当前回合事件承接，不能宣称整个新架构投产。
