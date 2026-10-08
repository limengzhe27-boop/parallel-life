# PLAY-01I · 基础契约集成验收

Agent：codex-play01i-01a11a84-20261008；2026-10-08。已通过read_thread核验主对话01a0c73b的原始用户指令：“好，你规划好然后让其他agent进行开发”“查看任务的进度，并给继续给另一个 agent 指令”。本项按指定分工复核和集成，不把其他Agent消息本身当成用户授权。

## 当前接续点

集成验收已完成。独立工作树/Users/limengzhe/.codex/worktrees/play-01-integration/人生剧本，基线2385ce9，d689790安全cherry-pick为4739316，仅5个新增文件。334check、49真实PG/1可选模型场景跳过、build均通过；生产36项迁移校验和一致，无新SQL。主目录LIB-04B及规划文件保留，不纳入发布。本项没有新接口、界面或场景模型调用。

4739316已推送，Production 5p948gk00 / dpl_3UkvuByDiiykQHV5N7oF4obVeAdN Ready，正式域名已切换。公网8项回归通过：首页/分支/health、旧世界读取、真实NPC私聊提交及重读、重复command回放原回执、另一合成访客读取404。原世界version1→2，旧照片引用仍1；NPC回答灯光柔和/角度层次建议，不替玩家决定。证据/日志在主目录.local/play-01i-evidence。PLAY-01新增文件全部释放，交GROUP-01和SCENE-01从此统一基线消费；不是群聊/现场功能上线。专用PG与工作树在收尾时停止/归档。

## 审阅

- domain仅依赖既有domain错误与类型，无框架/DB/网络；contracts单向引用domain类型，严格schema拒绝命令携带owner/world、裁定结果、来源和观察者。旧世界无需新增字段或重新生成。
- 事件来源必须命中runtime提供的真实owner/world事件及精确version。group_memberships加入含、退出不含、重新加入独立区间；历史查询与NPC上下文使用同一边界，退出NPC不继续得到新上下文。
- 现场presence独立于群成员和日程参与者；对白者和可观察对象必须实际在场，玩家事件流只读observableTo含player的条目。旁白类型标记observable无法证明文字未泄露内心，后续Planner和真实模型必须验收。
- 用户行动保留保存的原文和经runtime验证的意图；计划/假设只能recorded。attempt裁定必须为后续真实来源事件，unknown不当成功；事项完成需要相关行动成功或明确用户report，用户报告继续保留报告来源，不冒充独立裁定。
- 媒体必须是实际ready资产、同世界来源事件；phone附件另需分享事件，现场复用图标scene_reference。服务端须自行构建事件registry和真实assets，不接受模型/客户端伪造对象。
- 此处事件只有身份/version及用户输入，不编码所有事件效果语义；仓储/组装必须验证具体分享、加入/退出、行动及事项对应的真实事件效果。严格类型和有限规则不是通用语义证明。
- 暂停/ended场景允许读取历史；新行动要求active及玩家在场。迟到裁定/离场与世界暂停规则、日程状态/地点/故事时钟须由SCENE-01应用层收敛；本基础契约未实现时钟推进。

## 后续现场协调需求（未领取，不写公共组装或SQL）

建议首批现场与全局故事时钟分开记录动作序号，事件storyAt取现有clock运行时计算，模型无改全局时间权限；世界暂停允许读取和返回，拒绝新行动，用户恢复后再执行。长行动仅到下个必要选择，不自动跨天/发奖。返回手机仅改view，离场独立command。

SCENE-01拟用专属scene repository/planner/application文件及独立API路由；依赖统一基线后短锁领取。新增迁移编号和services/composition接线需主集成人唯一分配。日程进入需核实confirmed/玩家参与、时钟与地点，以事务建立现场、玩家presence、当前事项与事件来源；NPC是否到场不直接照抄participantIds。真实库验收包括唯一当前现场、版本/幂等/并发回滚、暂停和离场后迟到裁定；真实模型至少两种身份/不同处理结果。本段是建议与协调请求，不代表已经实现。
