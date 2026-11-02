# CODE-CLEANUP-20 · 无入口代码清理与 NPC 指令解耦

负责人：code-cleanup20-01a1334b（会话 01a1334b-8fbc-7cd3-a11c-aadb33396f80）。
工作树：`/Users/limengzhe/.codex/worktrees/grok-image-20261023/人生剧本`，分支 `codex/code-cleanup20`。
基线：013dfc1b 开始核查，实施前快进 ed20dcb4，完整保留 MEMORY-SIMPLIFY-19。
集成人：01a0c73b-a93c-7ca3-ac44-29f189d2612e。状态：独立树实现、check、build 已通过，待 main 集成验收。

## 范围与实际改动

用户授权先删除确定未用实现，再解除表情与任务状态绑定、移除按中文匹配指令；不加业务字段、不换模型、不碰记忆模块。

- 删除 `application/interact-turn.ts`：运行入口无引用，仅测试调用的草稿回合，没有真实事务或媒体入队。删除其专属 ReplyStatus / InteractRequest / InteractEvent / InteractResponse 及 Schema；集成人已确认公共契约修改归属。保留实际 intent-router 使用的 TurnMode 和 WorldMessage 全部命令/流/回执/恢复契约。
- 删除测试独占旧调度 `features/phone/auto-advance.ts`、`domain/local-initiative.ts`，不改现行 time-experience-policy、runProactiveLoop、agent-schedule-collectors 或 local-initiative-context。
- 删除无产品挂载入口的 DirectorPanel、TimePanel、TimeExperienceControls、PublisherConditionEditor、PublisherStoryGraph，五个文件共 1,135 行。没有删除当前手机时间、创作入口、导演业务、共享 CSS 或历史文档，也不串联删除仍有消费者的图模型等依赖。
- `npc-agent-model.ts` 的 SYSTEM / WIRE_SYSTEM 拆成命名片段；能力说明以明确 capability 键选择。输入来源、compact、服务器事件机会与能力权限条件不变，不再 split 中文正文后 includes/正则猜类别。提示词原文和顺序不改；原 promptVersion 更新为 v81-scoped-instructions。
- 表情目录与 compact 解耦，统一使用现有完整 `id → 名称；含义/边界` 表示。当前实际目录 60 个，不是旧报告的 80 个。无任务和纯表情输入也不再固定前 10 个。既有超预算降级（12 个）未改，不能声称任何超长上下文都带全部目录。
- 未修改数据库、人物资料、历史消息、记忆实现、模型参数、任务状态判断、输出协议、内核、worker 或共享 3218/3219。没有调用付费模型/生图，没有用户存档写入。

## 测试取舍

删除专属旧实现测试，不保留虚假的 queued/random jobId 或 conversationVersion+1 验收。

- world-interaction-native 保留意图路由、删除式校稿、记忆纠正/遗忘测试，仅删除 resolveInteractTurn 子例及其独占导入。
- authoring15-auto 保留实际 LifeClient.readWorldStory 的公共数据/隐藏原稿/非推进校验，仅删除旧 PhoneStoryBootstrap 子例。
- 旧 UI 布局与旧间隔测试删除；现行时间/入口/调度测试留在 time-experience-policy、phone-runtime-policy、local-proactive-worker、proactive-scheduler 等原套件。
- 真实消息入口的流式投递和媒体唤醒仍由 world-message-stream-contract / world-message-media-wakeup 等原测试验证，不把已删除的内存模拟迁移为另一套假回合。
- 新增两项模型请求回归，含 12 组渠道×任务状态×纯表情/文字输入，验证目录、人格、状态及预算；另覆盖 player/wake/coordination 与 capability 授权组合，验证事件、唤醒、记忆及权限语义保留。

## 证据与限制

独立忽略目录 `.local/cleanup20/` 保存日志与比较脚本，不提交私有运行资料。

- 336 组 origin/事件机会/compact/能力组合：新旧 systemFor + wireSystemFor **逐字相同**。能力说明的文案变化以后不会改变选择条件。
- 12 组实际 NpcAgentModel 请求捕获（模拟 transport，不访问网关）：除 promptVersion 与表情目录外，完整业务 payload、system 文本、尾部输入、maxTokens、output schema 均相同。persona、observations、计划/责任/来源/事件数据未被清空。
- 原完整目录请求字节差仅 +1（版本号）；原 10 个目录请求 +4,468 bytes（含版本号），恢复 60 个选择。这项是解耦/功能一致性，不是请求缩小或模型提速；没有承诺秒回。
- 初次全量检查发现本工作树隔离 PostgreSQL 55651 未启动，以及新增测试把原本合法省略的空状态误断言为完整 state。前者只启动本树原独立测试库并应用既有迁移；后者按实际空状态表示修正。没有改生产或共享数据库来让测试通过。
- 修正后 `npm run check`：边界 763 文件、typecheck、**4,158/4,158** 测试通过，0 跳过。比基线 4,169 少 13 项旧实现专属测试、增加 2 项，非功能用例被静默跳过。
- `npm run build` 成功，实际页面/API 路由完整编译与预渲染通过。
- 源码、测试、脚本再次搜索已删除模块路径/导出类型，无残余消费者；保留历史文档引用供 Git 追溯。`git diff --check` 通过。
- 五个 UI 均原本未挂载，现有可见页面/样式未改；静态入口核对与全量 UI 测试不等于本批新做手机/PC人工浏览验收。本批无真实模型质量/延迟测试；指令原文等价不代表整体慢回复已经解决。

## 集成接续

冻结提交后由唯一集成人审查并合入 main。主目录未提交文档保留；本线程不覆盖公共进程或自动部署。构建、提交与最终 main SHA 在完成后补入。

## root集成验收（2026-11-02）

已审查并cherry-pick为main 695c59be，未覆盖其他未提交文档。再次全仓源码/脚本/测试搜索被删除符号无残余消费者。主目录npm run check 4158/4158、build通过，新增记忆真实PG旅程1/1通过，确认摘要仍进入实际模型请求。0新增付费模型。3218 PID92776、3219 PID92777健康200；queue92778与proactive92779 ready，仍使用本地clone且保留410/251旧工作排除。没有生产部署、没有人工写入用户剧情。此批实现清理完成，不宣称回复提速或长期主动推进已经解决。
