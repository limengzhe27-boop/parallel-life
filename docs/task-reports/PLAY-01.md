# PLAY-01 · 共享体验契约与纯领域边界

## 身份与范围

- Agent：codex-play01-20261008；子任务 /root/play_contracts；集成人 codex-main-01a0c73b。
- 工作树：/Users/limengzhe/.codex/worktrees/play-01-contracts/人生剧本；分支 codex/play-01-contracts；基线609e266。
- 范围：src/contracts/world-experiences.ts、src/modules/world/domain/experience-rules.ts、tests/experience-rules.test.ts、tests/world-experience-contracts.test.ts、本报告。主登记目录总表按短锁更新本人行。
- 无应用端口、迁移和模型额度。全量check含4项既有数据库测试，因此建立独立本地PostgreSQL55440并应用已有36迁移；无生产库访问，无SQL修改。
- 开始：2026-10-08；依赖现有事件、角色、事务基础；集成人授权新增公共契约唯一实现。

## 当前接续点

- 状态：待验收；不是已部署交付。
- 实现：共享领域类型、运行时schema，以及来源、群成员区间、现场观察、行动/结果、事项转换、单一当前现场和真实媒体校验。
- 下一步：集成人审阅合入；GROUP-01与SCENE-01从统一基线消费；统一部署和公网验证后才能标完成。
- domain不导入contracts。类型在experience-rules导出，contracts用satisfies ZodType校验静态一致性。
- 阻塞：无。

## 接入接口

- 共享schema：Participant、ConversationChannel、GroupConversation、GroupMessage、SceneSession、SceneAction、SceneEntry、CurrentMatter、PlayerExperience、ExperienceMediaRequest、MediaReference及CreateGroupRequest、GroupMessageRequest、SceneActionRequest。沿用api.ts的Id/Version/Timestamp；公众命令禁止owner/world、来源、裁定、观察者。
- GROUP-01：assertGroupConversation、assertGroupMessage、canReadGroupMessage、groupMessagesForActor。存在媒体时显式传真实assets；无媒体默认为空数组。
- SCENE-01：assertSceneSession、assertNewSceneAction、assertActionResolution、assertSceneEntry、visibleSceneEntries、transitionCurrentMatter、enterCurrentScene、switchExperienceView、leaveCurrentScene。
- MEDIA：assertExperienceMedia、assertMediaReference。
- WorldExperiencesSchema.parse({})返回空groups/scenes/currentMatters。既有WorldState和私聊结构无新增字段，无迁移、不要求旧世界重建。

## 关键边界

- ExperienceContext的world/events来自真实授权世界及事件仓储。原子提交验证可加入runtime分配的新event和拟保存world.version，必须共同验证、共同事务保存；不能接受模型声称已提交的来源。
- 内部事件可选playerInput为真实世界内用户命令原文及runtime已校验意图（plan/hypothesis/attempt/report/speech），不含现实访谈。registry仅供运行时校验，不能整体传给NPC模型；群消息和现场可见投影才是模型可见输入。
- 群成员、现场在场和日程参与人独立。群/现场区间加入包含、退出不含；重新加入另存区间，不获得间隙历史。旧区间结束V、新区间从V重新加入可衔接。首次加入且退出同版本的零长度区间拒绝，须拆有序事件，不能用同一事件效果数组次序创造不同权限语义。
- 重复退出需application回放同command回执或拒绝，不能移动原退出边界。退出NPC的groupMessagesForActor返回空；历史读取只保留其当时区间。
- observableTo为事件当时实际可观察/能听见的人。现场旁白、角色对白、用户行动、裁定结果、媒体引用、时间地点六类分别建模；玩家视角仅返回含player的项。角色不在场不得发当面对白，旁白显式使用observable视角。文本是否暗含隐藏内心仍须模型提案审阅和真实场景评测，类型校验不能证明语义真实。
- plan/hypothesis只能recorded；attempt可pending/unknown/resolved。行动原文与意图须匹配真实playerInput，角色台词不能替代用户输入。unknown是恢复状态，永不当成功，也不自动重复执行；已有command由application回放回执。
- 结果必须引用实际保存的attempt裁定及后续来源事件；输入事件不能直接展示成成功结果。
- 事项五态依法转换。完成依据区分user_report和adjudicated_result；report必须来自实际用户报告原文，plan/hypothesis不可冒充完成。只允许绑定该事项的相关行动影响它。放弃只接受玩家明确自述，导演推进或成功裁定不能替玩家放弃。
- 返回手机仅切view，保留currentSceneId；显式leave有独立来源。每个owner/world最多一个当前现场；repository须保持这份player projection唯一。
- 媒体ready引用必须来自真实ready资产，pending/failed/unknown不能宣称资产成功。scene_reference保留旧事件来源作环境参考，不能冒充新事件证据；消息附件须有真实分享事件。无占位图片、假回复或生成调用。
- 本批是可选projection和纯规则，无仓储/调度/回合/API/UI，没有第二套世界引擎。不规定新时钟；场景active/paused仅表达动作边界，时间和暂停实现交SCENE-01。

## 交付与验证

- npm run check：模块边界209文件、typecheck、334项测试全通过，其中新增27项契约/领域反例。
- npm run build：Next.js16.3.5 webpack生产构建通过。
- 最初全量check的4项既有数据库测试因独立工作树无DB报ECONNREFUSED；初始化PG55440并应用已有迁移后全量通过，未跳过失败项。加强真实输入和事项证据后最终334项全部通过。
- 日志：/private/tmp/play-01-check.log、/private/tmp/play-01-build.log。
- 真实模型/双端UI：本批不涉及。真实本地数据库仅验证check内既有测试；不等同GROUP-01/SCENE-01持久化验收，后续仍须真实库、模型及UI验证。
- 代码与本报告在codex/play-01-contracts分支同一提交；只提交登记的5个文件，无密钥、照片或现实访谈。
- 部署由集成人统一执行；当前线上功能未因本批变化，待验收不等于交付完成。

## 集成验收

2026-10-08，授权集成人codex-play01i-01a11a84-20261008已复核并合入4739316。独立PG55441验证334check、49真实库/1可选真实模型跳过、build通过；生产36项迁移校验和一致，无新SQL。Production 5p948gk00 / dpl_3UkvuByDiiykQHV5N7oF4obVeAdN Ready且正式域名切换；公网旧世界读取、真实NPC私聊持久化、重复command回执和跨访客拒绝等8项通过。PLAY-01基础契约范围已验收完成并释放；仅纯规则/契约，不代表现场或群聊仓储/API/UI已实现。具体限制和后续协调见[PLAY-01I](PLAY-01I.md)。
