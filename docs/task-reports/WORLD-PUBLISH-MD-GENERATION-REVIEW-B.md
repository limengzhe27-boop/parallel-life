# WORLD-PUBLISH-MD-GENERATION-REVIEW-B · 导入、初始化与 AI 运行边界

负责人 codex-world-publish-md-generation-review-b-01a11a84-20261013；root明确指派只读。
准确根树：/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/world-publish-intake-01。
本地HEAD与只读git ls-remote origin refs/heads/main均为9f4d20010beaa483c3804640d7ca70511c482871；根树干净。公开部署READY是根既有交付证据，本轮未请求生产。
状态：限定只读审查报告待根验收；不把新导入稿试演/发布待验收改成完成。

## 直接回答

现有Markdown/ZIP是确定性字段解析和草稿整理。发布版开始体验和后台新建试演都是确定性初始化，**没有调用WorldPlanner或世界构建Agent重新生成整个世界**。生成的新UUID、独立所有者/世界、版本0状态、时钟和保存来源不等于模型生成故事。
进入存档后，角色私聊、合格剧情机会和现场导演/人物互动才走实际模型接口。它们运行在已初始化的作者世界上，不会自动把所有幕后备注补成完整可执行剧本。

## 1. 导入自动填什么

准确代码：publisher-importer.ts392 parseFeishuMarkdownBundle；publisher-workbench.ts的Markdown提案/保存分开；publisher-zip.ts只返回有界文本条目。

|项目|目前自动处理|需要作者补齐或明确确认|
|---|---|---|
|ZIP与Markdown|本地解包/UTF8/路径/CRC/条目与字节守卫；提案累计128KiB/64文档|压缩包里的图片不会自动成为头像/地点图/可公开素材；不是读取任意飞书链接或云文档账号|
|世界|明确标题、公开简介/开场钩子/公开设定、主角身份仅填空字段；梗概仅幕后hiddenContext|日期、起始地点、地点说明/路线、基调、主角处境、体验说明等未明确支持的字段不推断；已有非空值不覆盖|
|人物|L1-L5正文列映射身份/外貌、背景、说话、动机、边界；明确开场认识；新增唯一稳定key|已有同名不覆盖/合并；缺必填/过长/明确未来背景在不完整草稿留空待补全；关系两端、visibility、知情事实与素材不自动猜|
|开场来信|唯一明确已认识角色、完整ISO UTC时间、history/incoming来源且相对世界开场合法时，写合法多行消息|普通原稿无时间/来源的来信只保待整理；不补当前日期或伪造已发生对话|
|剧情|各文档预算内完整段落转editorial_only幕后候选；无scope标题+完整正文相同可警告跳重复|人物/地点/前置/阶段窗口/备选/可执行offer_message或offer_invitation仍需作者编排，不替玩家完成行动，不生成时间线|
|未知/未支持内容|完整原稿只保前端unmapped提案/核对下载与warning|不写作品extensions/公开简介/日志，不声称全文识别或可运行；需人工整理|

导入确认只改变编辑状态；publisher-workbench.ts338单独onSaveDraft，检查与发布又是独立回调（530/559）。解析器、ZIP无model/fetch调用；不直接创建世界、不直接发布、不生成图片。
已验实际稿件数量沿已接受parser证据：2partial人物、5幕后候选，5缺日期来信及1过长节点保报告。这些是待补齐导入成果，不能说已经具备全部原稿运行规则。root模板2complete人物是字段完备性，也不等于整世界runtimeReady。

## 2. publishedStart 到数据库的准确调用链

1. src/server/publisher-world-http.ts38 publishedStartRoute →42 new PublicationWorldRepository(db,publicationWorldCompiler).startPublished；试演startTrial也用同一编译端口。
2. publication-world-repository.ts353 startPublished → publication_admit_published（精确发布版本/owner/命令准入）→323 commit；命令已有结果返回原回执，不重复创建。
3. 同文件332 compiler.prepare(input)；实际组装端口是src/server/publication-runtime.ts7 publicationWorldCompiler，prepare直接调用compilePublicationGenesis（10），无模型适配器。
4. publication-genesis.ts156函数明确是Deterministic authored initialization only；163完整契约解析、178运行支持拒绝、200起映射作者人物key到新runtime ID。230-275裁剪历史知情与原稿消息，282起作者proposed邀请，300起作者地点/路线，330起opening来源元数据；没有WorldPlanner/model.complete。
5. repository.ts338先检查实际JSONB物理预算，349调用publication_commit_published（试演用commit_trial）；SQL43的129 commit_internal与183-192将seed、world、version0初始快照、非空opening、clock、绑定和回执同事务写入。没有enqueue world-build任务。
6. SQL43的world_builds已直接有opening；普通build-repository.ts66-72已有build记录也会返回，只有没有记录才78 enqueue world-build。普通build-handler.ts22要求opening IS NULL才取seed，然后31 planner.propose。这条AI构建路径并未被发布世界启动接口走到。

因此“初始化已发布作者世界”和“从个人seed让AI提出世界opening”是两条路径。前者不是失败后假成功，而是明确的作者内容编译；它不应在界面被称为世界Agent重新创作。worlds创建成功也不能作为真实试演模型证据。
publication-runtime.ts33 publicationReview同样先纯编译，再读已持久化trial evidence，检查不自行调用模型。正式发布不自动执行一轮试演。

## 3. 发布后哪些真的调用模型

|触发|代码证据|模型与条件|
|---|---|---|
|普通角色私聊|api/v1/worlds/[id]/messages/route.ts25 resolveTurn/28 characterPlannerFor；services.ts255包装→269 WorldTurnPlanner.propose；turn-planner.ts167 this.model.complete|剪裁后的当前人物上下文、真实记忆/世界时间，生成NPC提案；运行时校验/事务后保存。已有回执可无新调用；角色可以拒绝，不由台词造邀约|
|当前合法剧情来信/邀约机会|services.ts165/191 advancePublicationStory，publication-story-service.ts92 resolveTurn，最终同WorldTurnPlanner|先持久claim、阶段/前置/窗口/配额门；none/rate_limited/paused自动不调用；未知结果不自动重付。只发当前机会，不将全剧本未来交NPC|
|generic导演推进|services.ts208 application advanceWorld +WorldTurnPlanner|仅在受控合格回合调用；不是每次看地图/日历都会调AI。作者剧情受managed防绕过；editorial_only在publication-story.ts135/265明确不进入可执行资格|
|进入/行动现场|worker-composition.ts38 sceneTaskHandler(queue,ScenePlanner(YibuTextModel))；scene-task-handler.ts16 read上下文、19 planner.propose、20后commit；scene-planner.ts637 complete导演提案、838独立NPC开场、1031普通现场回应|导演裁定不替NPC决定到场；候选人物由真实预约/当前presence裁剪（502），独立人物决定本人到场与发言；每次最多选2位人物（822-825）。一次scene任务可能有导演和多个人物请求，应按供应商请求次数记预算，不能按世界/任务数算|
|一般个人seed世界创建（对照路径）|worker-composition.ts45 buildHandler(WorldPlanner(YibuTextModel))；build-handler.ts31 planner.propose；world-planner.ts186/399 complete以及two-step历史路径|这是实际世界构建AI；与publishedStart不同，不能凭同名world-build表/seed把两条路径混为一谈|

实际provider：YibuTextModel.complete52，经内部request对/v1/chat/completions发起POST（源码约85）；实例化planner本身不等于请求。上述是准确代码调用证据，不宣称本轮再次执行任何供应商调用。
纯界面读取、保存草稿、schema/编译检查、发布版本保存、地图移动/确认/确定性等待本身不需要模型；后续发起现场/导演/角色请求时才进入相应模型路径。创建后浏览器若另行触发自动推进，也应单独记实际请求，不将其归因于纯compiler。

## 4. 可行改造建议（本轮不实施）

优先在**创作者准备阶段**加独立AI整理/补全提案：用有来源的、授权的虚构内容和明确角色/地点key，输出已有PublicationContent结构或有限patch；程序检查引用、时间、阶段、未知字段、公开/私有/知情边界，作者审阅再保存/检查/试演/发布。新补内容标清“建议/待作者确认”，不能当原稿正史，不能提前写玩家接受/赴约/任务完成。这样可减手填，又保留每位玩家绑定精确不可变发布版与独立运行结果。

如果用户明确希望**每次启动存档都让世界构建AI做个性化准备**，需另设published preparation端口/持久任务：先冻结准入owner、作品version/hash和明确允许变化的字段，再在事务外调用模型，严格验证后同事务commit绑定/事件/快照/回执；失败/unknown可核对，不能自动重复收费。现repo323-350的compiler.prepare处在准入同一数据库事务、票据还绑定txid/pid，不能直接把现prepare替换成长时间远程模型请求。也不宜把现WorldPlanner个人seed协议强塞发布世界：它可能重写作者身份/关键人物、日期/既有历史，需专门不可变约束和虚构来源协议。

无论选择哪条，原Markdown解析保持零模型，完整原稿/未来计划不进入NPC和公开DTO；运行仍由真实提案+runtime guard+事务产生结果。完整剧情编排自动化、图片/朋友形象一致性、每次开局个性化不是本版本已完成能力，不借未来方案夸大当前支持。

## 验证、范围与收尾

已核本地与remote main精确9f4d200，阅读调用方/实际端口实现/SQL43/实际model.complete及资格门，未把计划或类构造当实际生成。报告不含原稿/凭证/私人内容。
本轮只写本报告与主目录本人新任务行；无源码/SQL/公共契约变更，无生产/模型/数据库/浏览器/端口资源，根独占12文字/2存档记账未消费。纯报告不重跑业务check/build、不声称新增运行验收；根唯一集成与部署。
