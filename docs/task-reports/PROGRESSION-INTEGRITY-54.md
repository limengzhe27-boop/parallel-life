# PROGRESSION-INTEGRITY-54

负责人 root-progression54，基线 09227d2b。用户授权收口53四处，保留已有效的导演快照 `goalId:null` 和具体机会，不改原档历史/数据库结构。只更新本地3218；其他文件与生产只读。

- 移除独立 idle-beat 生成器及失败回落。周期复盘只是同一份导演输入中的侧重点，复用既有 schema、原响应保存、解析、提交和恢复。一条尝试只有一次模型调用；断线、明确拒绝和已知无效输出交由原生命周期处理。旧 `idle_beat` 只读解码后走同一校验，不重新购买。保留既有环境值，但 `force` 只强调复盘方向，不能强制机会或人物行动。
- 机会仅为有依据的未来提议。导演输入和人物现有机会视图均区分设定、建议、已确认通知/期限及实际结果；定义来源不能代替第三方事实。保留普通协议中的具体工作/生活机会，不要求无来源代价或危机。没有把现有旧台词改成事实，也没有回写旧计划或记录。
- 删除 `PASSIVE_WAKE_TEXT`/`CONCRETE_WAKE_TEXT` 整轮吞消息。有效拒绝、退出或普通来信保留；沉默仍由本人选择，节奏仍由已有复查与退避处理。
- 删除“任何最近回复”导致的两故事小时全人物门槛。复用 `agent_plan_reviews` 的同一 planId/nextReviewAt；不同事项互不延后，有行动/实际条件路径保留。

验证：check 4265/4265、隔离build通过；真实本地 PostgreSQL director-runtime/plan-review201 22/22。新增原runner真实库故障旅程：丢结果保存 unknown，无效输出保留原文并记 invalid；重放同命令均只一次调用。旧epoch用例改为先断言保护中的请求拒绝切换、退休后合法切换、旧提交和旧epoch均拒绝，不修改生产保护。聚焦134/134。

原档读取：04:02刘胜男事项实际 rawProtocol=director-wire-v15、rawKind=null、cause=null；这条具体机会由普通导演协议产出，不能作为新 idle-beat 旁路的成功样本。共享事项仍active，result_count=0、evidence_count=0。新统一输入对原档v1337离线组包通过，未提高限额。

本地切换、原档一次正常有界验收及其证据待补记。未做真实模型重复试探、手工补消息、补事实或清空旧状态。

本地验收补记：业务提交 `24989116`，3218 已切换 `.local/build-progression54`（BUILD_ID `s99ZlrX_v2hd4cWoqxaeo`）。web 50122 / queue 50123 / proactive 50228，使用原克隆库，关键源码 SHA 对齐。切换前已核对 NPC 和导演无活跃 request_sent / response_received；没有中断或重买付费调用。仅回收已确认死亡且属于此前自有队列进程的本地锁。三个进程独立保留。

原档一次正常有界 advance：`2fb97a4a…`，v1337→v1338；真实文字模型只选中一位NPC（李之之），一次调用，原内核保存 `turn.resolved`，attempt `0a2363bf…` committed。该轮没有导演调用，未强制生成新机会或补发来信。真实导演语义输出仍待自然触发验证；现有刘胜男事项没有完成回执，不将来信当实际完成。无3219、无Vercel、无数据库迁移。
