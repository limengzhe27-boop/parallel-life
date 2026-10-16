# OPENING-EVENT-18-REVIEW-P 来源与存储只读审查

2026-10-14，author_people14，root 指派。审查源码 e8134e9ede7ca3fa6ce9906d366dc83096350eb6，独立 author-people-preview-14 树；root 唯一集成/生产执行。只写本人报告与主登记行，不改业务、迁移或测试。

## 结论

未发现阻断本次集成的来源绑定、旧稿兼容或新增公开泄漏问题。0057 的 source/store 与最后 0051 同签名替换；抽除恰好四处开场增量后，两份 SQL 字节一致（另统一文件首行注释），没有遗漏旧权限/历史知情/来源守卫。仅完成源码及纯测试审查，不据此宣称正式数据库、浏览器或真实导演模型已经验收。

## 证据

- `0057_publication_opening_event.sql:4-9` 继续用 owner 会话找 binding，按 work/draftVersion/contentHash 读取不可变原稿；published 还精确核 publicationVersion、draftVersion、contentHash 与内容。initial snapshot 和 build origin 同 seed/owner/world 一致才产生来源。开场取原稿 `d`，不接受调用者另指定来源。
- `0057:17` 仅当原稿拥有 openingEventKey 时拼入；旧稿保持键不存在，避免 null/default 与旧 plan 不一致。`publication-story.ts:167` 同样按 optional 复制；已有存档有持久 plan 时不重读最新版草稿（repository:140-153），不把后改开场强加给旧世界。
- `0057:22-26` 对 origin/nodes/timeline/conditions/开场引用精确一致，白名单仅多开场字段。变更、遗漏、增加、JSON null 与原稿不一致均不能偷偷存成别的开场。string/严格小写 key/唯一 director 目标检查保留；大小写不会模糊匹配。
- `0057:27-53` 原 actor/place namespace、history 唯一性、收件人知情、初始 canonical 文本与可见性、factId 次序、未映射初始事实的全部校验原样保留，最终仍以 owner binding 插入。
- `0046_publication_story.sql:32-41,162-163` 原 RLS、plan 仅 SELECT 权限及 source/store 仅 pl_app EXECUTE；0057 不新增 GRANT、不改签名、不 DROP，沿用既有函数 ACL，没有开放 publisher/worker/Public 访问源数据。
- `publication-story-repository.ts:218-245` 公共 progress 只投影已有实际 sourceEventId 的呈现记录及 claimed/unknown 恢复标识，没有开场编号、候选正文或导演幕后意图；`publication-story-http.ts:24-30` 仍验证 owner world。既有内部机会池需要私有导演概述，此改动没有把池新增到玩家返回。
- 公开 schema 候选总 key 唯一性在 `publication-content.ts:249-259`，开场目标总匹配数在 `:566-572`；buildStoryPlan 再拒候选重复并核开场类型，未使用姓名或大小写猜测。

## 实际检查

- 44/44 纯专项通过：publication-story、publisher-opening-event、publisher-plot-ui。含仅开场初次候选、前提未满足不改演、claimed/unknown/failed 不释放、实际呈现后不重开、旧无字段兼容、引用/删除/未知值保留。
- 11 个额外内存 schema 反例/正例全部通过：缺字段、合法选择，以及 null/object/false/大写/尾空格/不存在/空字符串；两个相同 key 分别同 director 类型及混合 editorial 类型均拒绝。
- 机械比较断言通过：去掉0057的 optional 来源拼接、精确开场比较、白名单新增及开场类型/目标 guard 后，与0051逐字相同；检索0051之后无其他迁移重定义这两个函数。
- 只读核对新真实 PG 专项：包含跨 owner source=null、改开场/改 origin plan 拒绝、公共 progress 不含私有文本/字段、旧稿 source/plan 无键。本人没有运行 DB，不复述他人的5/5为本人证据。

## 非阻断补强与交接

SQL57:26 本身只数同 key 的 director_event；若数据库管理员已破坏不可变原稿，放入一个 director 与一个同 key 非 director，SQL单条目标 count 恰为1。这不是当前合法导入/发布/初始化链路的可达绕过：公开 schema 的候选总唯一性及 buildStoryPlan 在 store 前均拒绝。可后续增加 SQL 同 key 总数也等于1的纵深校验，以及真实 PG 对 null/大写/混合重复的反例；不得为该反例削弱 TS 守卫或篡改不可变稿。

root 接续：统一全 check/build、真实数据库 ACL及57应用/校验和、手机PC保存重读、生产 READY 后公网体验；供应商导演实际质量需另按该批明确授权验收。本人0模型、0数据库、0浏览器、0生产写入、0推送。
