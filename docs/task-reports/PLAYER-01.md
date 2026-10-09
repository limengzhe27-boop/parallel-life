# PLAYER-01 · 服务端玩家知情边界

2026-10-09；负责人 codex-player01-20261009（I 指定）。独立工作树 `/Users/limengzhe/.codex/worktrees/player-01-boundary/人生剧本`，分支 `codex/player-01-boundary`，基线 `39700c2`。唯一状态为主登记目录 DEVELOPMENT.md；PG55446 / HTTP3239，不使用 GROUP-01I 的55445，不碰 LIB-04B。业务已实现，提交后待验收，未部署。

## 实际行为与来源

内部 persona/欲望/relationship/actorTies 与玩家人物资料分开。opening 可选 playerActors 只由 genesis runtime 从真实已选人物构造，包含实际 actorId、selected_person/personId 和已授权关系；模型解析剔除自报公开字段。phone 按 actorId/personId 与同 owner/world 的既有绑定、不可变 approved seed 交叉核验名字、角色、照片，不读内部 persona/relationship，不用数组索引或任何简介 fallback。新旧世界缺少可信公开简介时无 summary，不重建世界或改历史。

玩家已知名单的来源分为：明确选入该世界的真实人物/分支角色；已保存的实际私聊（genesis 由 runtime 保存，后续由仓储加载已提交事件）；实际已提议/确认等有来源日程的参与者；同 owner/world 已提交且玩家可观察的现场对白。未知 actor ID 不构造新人物；模糊旧日程不据此公开角色。接触仅证明人物出现，不证明私人动机、未知关系已公开。普通人物真正来信后可正常成为新联系人，服务端完整 cast 保留。

生成 opening.notes 没有玩家知情来源，因此 phone 不原样返回。其内部 metadata 原样保留；用户通过真实 note.saved 保存的 state.notes 仍正常显示和刷新。这是服务端公开投影边界，独立于 UI 是否隐藏。

公共 memory 查询先过滤再排序/限额：character 一律不公开，缺省查询和 includeInactive 也不漏；branch 不公开内部 summary/inference，仅允许玩家自己的明确纠正及与同 owner/world、实际可见已保存消息/现场条目相符的原文片段。引用事件不自动证明一段模型摘要可见。loadActorMemories/loadWorldMemories 保留内部合法记忆。

公开 editMemory 沿用现有 services 组装。store 默认只加载玩家可读集合，character correction 拒绝，猜测私有 memory ID 的 forget 返回 NOT_FOUND，纠正精确限制 scope/key，不误伤同 key 的 NPC belief 或另一分支。服务端内部可显式使用私有加载模式；公开 schema 不接受该模式参数。正常 profile/branch 纠正和遗忘已真实验证。

branch→profile candidate 第二出口用同一玩家可读记忆门禁，并核验候选文本本身来自同世界真实可见消息原文；旧候选列表、确认/拒绝和历史回执回读也校验，不能以引用一条普通消息为由公开另一个内部摘要。interview 候选保持原流程；可见 branch 原文创建候选、拒绝和重复回执正常。

公开 direction GET/POST（含 preview）鉴权后统一410，明确说明进入人生后不再提供导演修改。未认证或无效 CSRF 仍401；不读取方向、不调用模型、不保存历史/限流计数。内部方向读取/导演/clock/store 未改，旧 world_direction 行及 updated_at 经真实 HTTP 前后比较完全不变。

## 验证证据与失败记录

- 最终 npm run check：边界222文件、typecheck、359项全部通过；npm run build：Next16.3.5 webpack通过；改动格式、git diff --check通过。
- 新增纯领域4项：未知名单/源关系照片/actorId顺序/错误person绑定/模糊日程/模型自报/合法本人persona保留。
- 专属真实 PostgreSQL18.4 与最终生产构建 HTTP：6项全部通过。覆盖源原图 image/webp200、旧世界/metadata不删、角色排序、后续新联系人、公开原始 JSON/HTTP 秘密标记、真实用户便签、branch可见原文、内部角色和导演记忆、scope/key不误伤、候选第二出口、正常公开profile/branch POST、跨身份404、无会话/错误CSRF401、导演GET/普通POST/preview410、旧guidance行不变。
- 全量 npm run test:db：61项，56通过、2失败、3可选跳过。两失败均是未同步的旧公开预期：setting-trials.test.ts:121要求尚未接触的全部author人物显示；world-build.test.ts:144要求无玩家来源的生成开场便签显示。没有把全量数据库回归声称为通过。已获批world-build可见人数/内部ties两处断言调整，其他断言文件范围尚待I协调，故不越界更改。
- 将上述两处旧预期改为“仅实际来信人”“没有已证明开场便签”，并明确检查snapshot仍保留全部author角色的忽略目录兼容副本，按串行真实DB验证3项全部通过，包括整条世界选择/日程/choice流程。待集成人正式纳入测试后，必须重新跑全量DB。准备好的准确补丁在 `.local/player-required-test-updates.patch`，未夹带入提交。
- 真实 gpt-4o-mini：两个合成身份（摄影合作、邻里维修），前后两轮共4调用，实际作者草案→固定试演修订→队列租约→genesis保存→phone投影。首轮虽无秘密标记，却发现 opening.notes 写出“有未说出口的安排”“工作上有顾虑”；因此没有把标记过滤等同语义成功，而在服务端排除无玩家来源的生成便签。最终两身份各1调用，真实手机投影无内部profile/秘密标记/生成便签，消息由实际NPC开场产生，原始样本留存。
- 更早 check 因专用 dev 库未迁移，旧媒体测试失败后未关闭连接；已停止本任务子进程，应用既有37迁移后重新完整359通过。真实模型脚本首版试演少了真实draft引用被23514拒绝，未调用模型；改用正式草案/试演仓储。兼容副本并发曾争同一建世界队列，随后依项目串行约定运行3项通过。所有失败保留，不改生产数据或伪造成功。

证据仅合成资料，存独立工作树忽略目录 `.local/player-{check,db,build,http,http-server,compat,live}.log`、`player-live-result.json`、`player-live-before.json`。凭证仅服务端忽略文件，不入报告、客户端或日志。

## 集成接续与限度

没有迁移，不申请39；使用已存在37项持久结构。唯一集成人应先裁定/正式同步两处旧测试预期，重跑全量DB，然后在GROUP统一基线合入、核对生产迁移、提交推送、等待READY及公网验收；本批未部署，不能标完成。

必须与 WORLD-CONTROL-01UI 联动：旧 DirectorPanel 的初始化 Promise.all 含 direction，410会使旧面板时间加载报错。用户导演入口/旧深链接移除，时间管理迁出后要验证clock、暂停/倍速/切换人生仍可用。本任务按分工不改UI、sharedservices、worker、replay、群或现场业务。

历史 guidance 是否继续影响内部 NPC/推进须由I明示兼容策略。本批只封公开入口，旧数据和内部使用不改；不静默删历史、重写过去或更改时钟。既有明确确认进入profile的用户资料不在本批追溯删除，新候选第二出口加门禁。

当前没有可信的泛人物公开简介/介绍持久协议，不会接受模型一句“公开”即可获准。已授权源人物关系可显示，普通接触人物仅名字；额外介绍以后需要真实来源契约。群可见成员/消息的联系人接线需GROUP-01I统一后另协调，不假定群成员=现场在场。

自由生成的 identity/setting/messages 仍需要实际语义抽样；角色可以在真实发言中自行透露本人想法，但模型可能以间接表达泄露他人未知信息。首轮便签反例证明仅来源字段/标记检测不等于完备语义防剧透，本批没有作此承诺，也没有建设第二世界引擎或重建旧世界。
