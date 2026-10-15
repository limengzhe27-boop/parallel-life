# MA-ARCH-44 阶段四：真实入口、已知结果恢复与知情边界

负责人：codex-root-ma-arch44-i；唯一集成目录 history-chat-media，主表仍为主登记目录的 DEVELOPMENT.md。

整体重构仍未完成。本批不切换生产存档、不购买模型调用，不把入口存在称为完整体验已可用。统一方案仍见 architecture/NPC_AGENT_RUNTIME_44.md。

## 实际变化

- 实际手机先读取、推进开场，再推进世界。opening、story、advance 均在旧处理之前核对数据库引擎；epoch2 读请求不初始化旧剧情 ledger，旧仓储直接入口也被围栏拒绝。没有候选不伪称开场已完成。实际非消息变化返回 changed/worldVersion，手机刷新日历和现场。
- NPC 与导演共用白名单状态视图，保留持续身份、计划、责任、决定、版本和完整执行历史；额外私密属性不会进入模型。
- 群聊、现场提交失败后，明确重试恢复原 taskId、child command、input 和保护结果。0076 在同一事务追加不可变恢复回执，轮换人物执行 token 和租约，再将原任务排队；实际 worker 使用原 snapshot/raw，不再构造模型。旧 worker 与旧 token 均不能迟到提交。
- 结果未知、坏输出和版本过时分别处理。unknown 不新建替代任务、不重付；已保存但事实版本已变化的结果保留为 stale，任务变为 conflict。
- 导演实际 advance 入口在领取新任务前处理原 slot。同语义 frame 恢复原结果；事实变化才标 stale；unknown 保持阻断。语义 command 不随时间滴答或 evaluated 记账变化。已知过期结果不能靠改 command 名称、重复空闲检查重新付费。
- 模型时间由代码换算，区分发生、获知和期限；保留玩家告知原话，不把“上周去过某地”当作当前位置。

## 验证与接续

本地：原生恢复真实 PostgreSQL 5 项、权限 2 项；真实签名会话/CSRF 的 HTTP retry/run 实际 worker 组合通过（Q 44-29），同原任务、唯一群聊回复、0 额外模型请求；跨 owner 和缺 CSRF 被拒绝。导演恢复/runtime/实际 advance 联合 50 项、语义 frame 2 项；模型与状态序列化 45 项、type 通过。以上均使用明确合成响应，不是实际模型验收。

B 的来源过滤已集成 c1a61bbe，并在过滤后接原告知引用及代码当地时间；root 真实 PostgreSQL 14/14 通过。完整 check 2710/2710 通过。build、全库复验、生产 76 校验、READY 与公网检查待后续填写。真实模型 0，生产测试存档 0，生产 epoch2 启用 0。

仍需完成：作者开场/事件首次候选、导演 proposed 机会与 NPC 自主参与及实际进展、通用移动/撤回/观察、业务会话身份、旧同步调用切换屏障、迁移与删除旧执行路径，以及完整真实模型连续旅程。保留多人、时间与多人生。
