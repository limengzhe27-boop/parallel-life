# PUBLISHER-SOURCE-03B · 最终稿文字对应核对

- Agent：codex-publisher-source-03b-01a11a84-20261013，root唯一集成。
- 独立树：/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本；codex/publisher-source-03b。
- 基线70df9d3782d1b53e70cdcb73191b09d872c719ea；cherry-pick根共享类型34cd373为本树db9b943。共享类型未改，本次仅三个新文件：domain/publication-source-review.ts、tests/publisher-source-review.test.ts、本报告。
- 源码冻结后由根集成UI/全量check/build/正式READY验收。旧11/12文字、2/2存档账本closed，B不使用模型/DB/browser/生产。

## 实现

导出buildPublicationSourceReview(sources,content):SourceReview。完全同步纯函数，原稿与最终内容变更时可重新计算，不持久化，不生成事实，不控制保存/发布权限，不读notes/summary/extensions/其他未知字段作为证据。

原文按中文句末、问叹号、分号和换行切片，保留未带句号尾段。quote对应原始sources[fileIndex].content.slice(start,end)，start/end为真实UTF16半开区间；按原文件CRLF/LF/CR记录真实1-based line。文件ordinal+起止位置组成row ID，重名文件/重复句不合并。去纯标题、表格表头/分隔符、代码围栏、列表排版前缀；含数字事实或句内事实标点的标题保正文。人物标题提供局部主体线索，子标题继承；不是提取事实的授权。

目标白名单仅实际语义文字：作品名/引子/简介/体验说明、公开背景/基调/幕后、主角身份/处境、人物公开身份/外貌/性格及四项privatePersona、关系description、地点description、history.text、实际phone.messages.text/notes标题正文/invitations标题、阶段标题、候选标题/editorialIntent/合法消息或邀约intent文字/timeNote。结构key、数字布尔值、数组引用、模型提取说明、媒体/未知扩展不当文字证据；本版不声称比较所有结构化字段或时间线执行语义。目标ID以实体key/字段slot定位，不以名字当ID；缺失/重复实体key跳过并警告，防错误归属。原value不截断。

有限排版标点/空白规范化保数字、负号、算术符、英文撇号、否定与所有词。长度至少6且与完整字段或其完整句片规范化相同，才literal_match；不把任意子串当同一句。短片不判文字已保留。literal仅文字证据，不是语义正确。

候选预先按字段计算字符bigram和数值单位索引，逐source取相近字段，不反复对所有长字段tokenize。至少3个重合bigram+源覆盖比例/目标覆盖比例门槛；已明确人物且同数值单位时允许较短数字改写候选，长段另需2个重合bigram。不是一字交集就配对。最多比较48候选，返回最多2项；比较截限与其他候选存在会有notice。已实际识别为文字候选但未列入前2的目标不误列为“无线索”。未比较的目标仍可能列unlinked，配合容量notice人工核对，不能称为模型捏造。

人物专属字段主体优先仅owner actorKey，不与正文提到的他人姓名union；防B背景提到A被拿作A的年龄/身份。关系/历史用明确参与者，其他全局文本仅用实际出现的名字作为线索。同名不同key不判literal，显示歧义候选。数字差异保留原数字及单位，missingNumbers/addedNumbers只比较关联候选，不到其他人的字段搜数字当覆盖；相同数字也不证明相识=共事。差异只提醒核对，不自动判错。

原文含明确知情限制/否定/未来可能性，即使literal也附核对受众及事实/候选栏目notice。未做庞大词库或NLP，不能保证识别所有隐藏语义/别名。年龄、相识关系、昨晚约定等没有硬编码任何验收人物。

## 容量与安全

- 最多400正文片段、512实际文字字段、64文件、原稿合计262144 UTF16字符；有余下内容时明确warnings，当前文件第400片后还有其他行也不漏警告。
- 8192字符以上单片/单字段全文保留展示，但不做相似比较，显式notices/warnings。原稿总量超限从该文件起不核，警告定位文件；不截半句伪称完成。
- 最终content先经过既有publicationStorageIssues（不可执行JSON、深度/值数/64KiB预算），非法或过量稿不读取字段，警告且保原稿待核；不会执行getter。
- 输出仅作者核对使用，包含幕后值也不接公开世界/角色投影。0网络、存储、模型、副作用。

## 验证与实测

23/23纯专项、0skip，typecheck退出0、414模块边界、Prettier及git diff --check通过。反例：notes-only年龄；26→45限正确人物；相识→共事不literal；昨日约定缺历史不被未来节点当完成；否定改变与literal私密/可选语句仍notice；错人物背景/同名歧义/标题主体；同名文件/重复句；emoji UTF16、CRLF/尾行；Markdown数据保留；短通用词/单字重叠；重复target最多2且非唯一；实体重排ID稳定/旧稿不改；unlinked保全文且不指控；400/512/64/262144限制、超长全文、getter、无效实体编号；长复合人物段保年龄缺项提示；负号/算术/撇号不消失；近上限索引对比。

本机近上限一次400片×512字段、稿件64817 UTF8字节约275ms；纳入正式专项后一次356ms。此为本机运行证据，不承诺所有浏览器耗时；没有硬编码测试耗时断言。

按根单独授权只读主目录.local/publisher-ai-prep-live-state.json，仅取synthetic sources与preparation.result.updatedContent；未输出任何staff/player凭证或其他字段值。实算18片约5ms：26岁段possible_rewrite对应关系/个人经历并missingNumbers含26岁；45岁段unmapped；“昨天老陈与主角约好今晚讨论进货单”unmapped；库存段possible并有知情范围notice。没有把原notes里的26/45当目标。以上是原测试稿文字核对，不重新执行真实模型、不改变旧档；原文具体值未写入实现/fixtures。

完整check按根指令留统一环境，不启动旧DB。独立build已在根后续“不重复build”消息到达前启动，本次只收取该次结果，不再次运行。

该次独立npm run build已退出0。源码与报告冻结，下一步仅由root/Q接入核对UI与统一验收，不再扩算法。
