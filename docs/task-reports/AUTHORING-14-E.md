# AUTHORING-14-E · 通用可选事件与真实导演选择

2026-10-13，主负责人 author-events-director-14。唯一状态源为主目录 docs/DEVELOPMENT.md；此报告不是另立任务表。

工作树 /Users/limengzhe/.codex/worktrees/author-events-director-14/人生剧本，自 d1cd0ac；依赖 root 公共提交 bf9f47b、aa4ebbc，不回传其重复提交。本人仅修改登记的 story domain/ports/repository/service、turn-planner application/infrastructure、plot editor/model/graph model 和专属测试。

## 已实现（待集成验收）

- 新增事件默认“导演演绎”；作者填写事件内容、参与人物及由谁开启，前提可空。旧明确来信/邀约和仅备注保留。
- 仅含新 director_event 的故事启用真实导演候选池。旧世界保持原流程，避免所有旧轮次额外调用模型。
- story.opportunities 只返回运行时核验过前提/时间/地点/互斥/速率的候选；不进入公开 progress。选择调用只收到这组候选和玩家自己手机最近消息，不接收现实访谈或其他人物私有记忆。
- WorldTurnPlanner.chooseStoryOpportunity 使用现有 TextModel 单次结构化调用，允许精确候选 key 或 null，拒绝多余字段、无效/越界 key、坏格式，无默认补选与自动纠错收费。
- SQL 持久预约 beginSelection 前重检前提和版本；root 提供 selection_begin/finish 函数。选中后 prepare 再次检查世界版本与合法候选。null 只记 deferred、不领取节点、不认完成；错误记 unknown，不自动接着演另一个事件。预约真实时间冷却由 root SQL 实现，未经过本 Agent 真实数据库验证。
- director_event 用现有 resolveTurn、角色裁剪上下文、命令回执/事务保存实际消息。只允许本人 message.received / belief.recorded；不代玩家作选择，不自创日历或媒体。失败仍按现有回执 reconcile，不把模型文本当成功。
- 新事件实际展开为 presented + outcome=null；消息已保存不等于玩家完成。after_presented_node 依真实 sourceEventId 及呈现状态可连接后续；claimed/unknown/failed不符合。
- 编辑器和图用中文呈现“某事件已展开”“导演择机演绎，也可暂缓”；无某剧本、人名、情感题材的硬编码。

## 校验记录

- 专项 tests/author-events-director14.test.ts + 既有 story/service/conditions/plot model/graph model：70/70 通过。涵盖合法选择/null/恶意选择/失败不补选、冷却无角色调用、版本重验、消息真实保存、无来源日历被拒、已展开前提不认玩家完成。
- npm run check 执行：四项失败全为未运行默认 PG55432：character-image-flow 两项、rls-tenant-isolation 两项 ECONNREFUSED。按分工不启动PG或调用生产；主集成需按PG55476配置重跑。
- 第一次 typecheck/build 被公共 aa4ebbc publication-content.ts:615/621 拦截：after_presented_node 误入读取 outcomes 分支。已告知 root 修复；本人不越界写公共文件。构建源代码编译阶段成功，不能据此标整体build通过。
- 未调用付费模型、生产接口、浏览器或生产库。真实模型质量、SQL兼容、PC/390页面与上线由 root 统一验收。

## SQL 集成要求

- publication_story_selection_begin(w text,o text,v bigint,a uuid,keys jsonb) returns boolean。
- publication_story_selection_finish(w text,o text,a uuid,status text,nodeKey text) returns void。
- node guard 必须允许 director_event 使用 actorKey，并将 presented+outcome=null 视为“实际消息展开”；保持旧 offer_message presented+committed 语义。
- 预约绑定当前 world version、候选 key 快照、owner/world；严格候选白名单和状态机，冷却不等于世界剧情事件。不能用虚构回执绕过保存。

## 尚未完成／边界

- 首版通用事件通过单个角色主动私聊开启；多角色现场、导演决定切换到现场、任意邀约/图像演绎不属于此交付。
- 与节点无关的自由语义条件、动态知情/关系证据、自然语言前提自动整理仍待实现。
- 新通用事件的 presented 不等于 committed；复杂阶段“全部完成”、完成结果/互斥必须以实际证据另行表达。没有自动把展开当完成。
- 真实收费调用范围本轮未获新授权，不能以确定性测试冒充真人体验自然性验收。


## E2 · 按用户新要求持续推进编剧预制事件（2026-10-13）

- 公共依赖 root direction 提交551c05b，以及28fde99的after_presented验证两行修复（临时工作树应用，公共修复不混入本人提交）。
- director_event 缺省为 required，新增默认写 direction.mode=required；旧明确来信/邀约缺省 optional。required候选排在前面，沿用 root 候选24项输入上限。
- 导演候选中有 required 时必须选择其中一项开始演绎；null 或改选 optional 会报错并记 unknown，不补选、不制造台词成功。全部 optional 时才允许正常 deferred。硬前提、速率限制、持久预约和事务重验仍保留，required不能越过前提或改成玩家必选。
- 新 SQL 函数 publication_director_setting(worldId text) 由 root 0054提供。仓储读取不可变世界总体设定，只送幕后导演；导演看所有虚构角色id/name/persona/relationship，并看事件的预期影响/体验。NPC只收到当前自己的可见上下文及本轮事件，不接收整组cast/幕后总体设定。
- 作者首屏以事件概述列表为主。事件标题 + “事件概述：主角将面临什么”，约200字指导而非硬长度；前提可无；预期影响/希望体验选填；需要推进/导演择机可切换。历史、阶段、独立条件、关系图折叠保留，无数据删除，不要求事件都连成线。
- 开始演绎仍是呈现一条真实人物消息，不表示整个事件已完成、玩家已经接受或达成预期影响。
- 99/99专项通过，包含required不能暂缓/越界、可选仍可暂缓、导演cast与总体设定不进入NPC上下文、原前提/回执、编辑器/图旧数据兼容。typecheck通过；build独立工作树通过，最终文案变更后再执行记录由回传说明。
- root authoredPosts payload与 ActorContext新增字段已保留；不重写root人物导入和预览。
- 未满足前提的required仍保留于不可变剧情计划，不领取、不收费、不写虚假结果。尚无作者侧实时调度待推原因/卡点跟踪页面；本轮没有自行增加另一张状态表。多角色现场连续编排、独立事件分步生命周期与实际目标达成证据继续待办。
