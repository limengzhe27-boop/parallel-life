# 44-94 人物考虑事件后的计划与责任视图

负责人 codex-ma44-94-lifecycle-q，辅助线程 01a0c7c8-604f-7dc1-8122-fc7f0af1fd6b；集成人明确分配并确认API/范围。基线81c0719f874fa627bcfd9d0f902316b6a278fbf9；独立core-handoff88-q/codex/episode-lifecycle94-q。主登记短锁先领取。状态：待验收，尚未接线或上线。

## 文件与能力

仅新增：

- src/modules/world/domain/episode-participation-lifecycle.ts
- tests/episode-participation-lifecycle.test.ts
- 本报告；主登记仅本人任务行和报告镜像。

projectEpisodeParticipationLifecycle及validateEpisodeParticipationLifecycle接收原server request、明确的episodeDecision、原内核合并且授权后的本人state和真实results，生成该人物当前态度、已有goal/plan/responsibility及原触发/缺失条件的只读视图。没有新增公共模型字段、SQL、生产仓储或第二套调度器。

关联只认episode-intent:<准确requestId>来源、准确episode/request类型与subject ID，或已有明确goal→plan关系；直接关联的plan可带出其原goal，但不会带入没有事件来源的兄弟plan。普通输入来源、相似标题、正文包含ID均不构成关联。

engage没有后续安排仍合法返回followUp=none，不替人物编计划，不拒绝合法对白。defer、need_information、decline、quiet只记录人物态度，不自动关闭既有责任，不代表玩家答应/拒绝，不结清共享剧情。followUp=terminal仅指本视图所关联条目终态，不是SharedEpisode resolved。

已标fulfilled的关联责任必须有真实成功结果精确certify handledResponsibilityIds；关联goal的resultIds须逐项由completedGoalIds授权。结果必须同world/actor、非未来、匹配本人state.actions中的action/resultId，来源还须由调用方在原内核认证。失败结果、跨人/跨世界/错动作、发出邀请或记录计划不能冒充完成。失败时抛EpisodeParticipationLifecycleError并保持输入不变。

reassessment只展示已有非空triggers/nextCheck全部满足时的重查依据；空条件不反复自动唤醒。非result条件由调用方原eligibility核验后传入satisfiedConditions；result条件仍自行核真实结果。blocked计划有新触发时可以重查缺失条件，但原status和missingConditions不变，eligible不是执行授权或再次付费许可。不创建新任务、来源、路线、时刻或截止日期。

## 验证

- node --experimental-strip-types --test tests/episode-participation-lifecycle.test.ts：17/17纯领域测试，0skip。覆盖无安排、准确关联、不带兄弟计划、五种态度、换话题、非空触发全满足、真实失败重查、无结果伪完成、身份/epoch/未来版本/重复ID、返回值引用隔离和失败无部分修改。
- npm run typecheck：退出0。
- npm run check:boundaries：579文件通过。
- 本人两新源码/测试Prettier检查及git diff --check通过。新增关联用例之后首次格式检查指出测试文件格式问题，已格式化并复查通过。
- 没有重复全量check/build；本批公共接线、相关真实库检查、统一check/build和部署由唯一集成人执行。本人仅借用已安装node_modules作为独立树依赖，没有修改公共配置/锁文件。

## 接续与真实状态

集成人应在原人物/导演读取处调用project helper；若用于提交验证，应在原内核完成来源授权、真实执行结果验证并合并state后调用validate helper，不能把未经验证的模型state/results传入。必须提供相关历史真实结果；未读取结果不能把已有fulfilled错误结论包装成有效，也不要把资料读取失败静默转成完成。

该helper不持久化新的生命周期状态，不消费request/receipt，不决定下一次模型调用，不处理unknown解锁、不改SharedEpisode或作者事件资格。普通玩家同轮manifest及原receipt消费属于root44-93，仍走原内核；本模块不取代它，也未私建旁路。具体机会的新revision、整体事件结果、退出后重考政策仍需原公共机制接线。

本人真实PostgreSQL验证0、真实模型调用0、浏览器/公网验收0，未改用户草稿或玩家存档。“渣男体验”不发布，新引擎不启用。当前仅领域实现与纯测试，不能称产品能力已交付；接线、真实库验收与正式READY/公网证据仍待集成人完成。其余未完事项保留唯一主表。
