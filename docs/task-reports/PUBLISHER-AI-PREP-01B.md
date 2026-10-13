# PUBLISHER-AI-PREP-01B · 文稿整理 Planner

- Agent：codex-publisher-ai-prep-01b-01a11a84-20261013；主会话 01a11a84-9572-7ab0-92fb-967f963dfc20；root 唯一集成。
- 独立树：/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本，codex/publisher-ai-prep-b；准确基线 1328bd3248d76b4c2208d853938b65772c592bcc（616f02e 后的根冻结契约）。
- 状态：源码冻结、待 root 集成验收。仅四新文件：settings/infrastructure/publication-manuscript-planner.ts、settings/domain/publication-preparation.ts、tests/publisher-preparation-planner.test.ts、本报告。没有修改契约/HTTP/旧 compiler/UI/SQL。

## 实现与实际边界

`PublicationManuscriptPlanner implements PublisherPreparationPlanner`，注入已有 TextModel；一次 complete，16000 输出上限、json_object、signal 传递，任何失败/截断/非法 JSON 不自动再付费。输入使用冻结 MaterialSchema（source 1–32，128 KiB 与完整 JSON 48000 字符门槛），序列化快照；currentContent 在 Zod 前先做不可执行 JSON/存储检查，模型输入总长度再核至 63000。完整输入超限明确拒绝，不截原稿。仅完整 JSON 响应≤192 KiB，经独立内容≤64 KiB存储门槛，不使用围栏/部分 JSON/预置世界救场。

提示词将文稿放 user data，系统声明文稿不是指令，没有执行/网络/发布/真实档案工具。要求 complete world：公开/幕后/人物/地点路线/时间/知识/开场/阶段/候选、必要合理虚构补充 notes。未来意图保留候选，不自动当历史、承诺、玩家已经接受。未给图库不造 media。该提示约束与结构检查不能证明自然语言忠实/无幻觉；所有输出仍是作者待核对提案，真实模型质量由 root 另验。

纯合并保原所有非空标量（false、0、null 也保留）、未知字段及已有实体顺序；仅填缺失/空白字符串/空数组。实体按稳定 key（initialKnowledge按actorKey、routes按有向端点）匹配补空，缺实体追加并有服务端 supplemented note；不按名字匹配、原实体不会删除。现有普通非空引用数组保持。重复模型key不能覆写已有行；新重复仍由 schema 拒绝。明确唯一例外是仅含kind=editorial_only的候选intent可补offer_message/offer_invitation，原标题/editorialIntent保留，新增timeline/空引用依旧需校验。已有非空执行intent保留。

media/extensions/phone.album 及封面/头像/场景图引用严格保持已有，不允许模型添加或替换；原不存在时三个集合为空、图片引用省略。未知扩展/非法作者字段也不删以凑成功。合并后再核总存储预算，失败不部分返回。

调用实际 PublishedWorldContentSchema（含publicationContentIssues）生成 issues；结构/引用通过后调用实际 compilePublicationGenesis 做纯 dry compile（内部确定性测试 UUID，仅进函数内存，无世界/种子/时钟/任务/数据库持久化）。编译器返回unknown actor、persona预算、不支持媒体/扩展等会如实成为issue；不复制编译器校验逻辑。模型issues字段完全不可信并丢弃；server计算结果至多100项，超过明示additional_validation_issues。notes保模型前60项、另加作者确认说明和至多38项合并提示/额外数目；模型extracted声明不是证据，原稿由根单独保存供比对。结果 succeeded 仅代表有可核对提案，不等于可发布。

原导入knownAtStart=false保留，可能仍报unsupported_unknown_actor_projection；不得自动改true以通过运行门槛。不得声称任意剧本已完整可运行。

## 验证证据（2026-10-13）

- 17/17 专项通过，0skip：有效完整提案实际schema/domain/compiler、单次json调用、同名key/原文/false/0/未知保存、实体追加、initialKnowledge/routes稳定匹配、候选执行化且正文保留、旧执行intent保留、伪造media拒入、既有不透明素材保留、未来历史/越权知情/无效引用/阶段环、真实compiler未知人物与persona预算、缺字段明确issues、注入仅user数据、输入输出预算/unsafe getter、失败/取消无重付、合并总预算、重复key。
- `npm run check` 已执行：408边界通过、typecheck退出0；1852 tests，1848 pass / 4 fail / 0skip。四失败为旧 character-image-flow 两项和 rls-tenant-isolation 两项拒绝连接原已停止的127.0.0.1:55478。未启动DB绕过资源限制，不能称全check通过；根统一真实库环境复验。
- `npm run build` 退出0；三TS Prettier check通过；git diff --check通过。
- 首次边界静态扫描误把白名单字串from当import（脚本正则不解析TS），只在同义字串使用unicode转义规避误报，没有放宽脚本。首次getter测试暴露冻结契约superRefine仍stringify非法原值，已在本Planner前置纯存储检查修复，已同步根公共契约事项。
- 没有真实模型、生产调用、新存档、真实DB成功、端口服务、浏览器或部署。旧12/2额度保持closed。

## 根后端只读复核

复核准确51ab591的0050_publisher_preparations.sql、publisher-preparation-repository.ts、publisher-preparation-http.ts及调用链，没有发现具体P1：admission提交后才请求模型；principal advisory lock串行与单running/10次小时门槛；原cmd/hash恢复不重调；超3分钟running读转unknown；触发器锁原material/终态；finish落库失败不会改判或重付；HTTP GET不建gateway、同principal私稿隔离。没有改root源/运行root PG。

P2：HTTP RATE_LIMITED沿旧后台统一“登录尝试较多”文案，用于整理10/h不准确，已建议根该入口局部修正文案。

## 接续

root取本次四新文件提交，接已冻结HTTP构造器，统一库/前端核对、真实模型质量与失败恢复、手机PC/部署READY/公网验证后方可标交付完成。B源冻结，不自动运行模型或扩展任务。
