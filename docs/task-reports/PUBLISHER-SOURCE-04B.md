# PUBLISHER-SOURCE-04B · 原稿核对降误报

- Agent：codex-publisher-source-04b-01a11a84-20261013；root 唯一集成。
- 工作目录：/Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本，分支 codex/publisher-source04-b。
- 基线86d02a9b86afea3eaf96e1a849cc9d8f93b5bd24；根共享类型05e7114在本树为4ee483c。未修改共享类型。本交付仅既有domain/publication-source-review.ts、tests/publisher-source-review.test.ts及本报告。
- 状态：源码待验收。B专项和type；完整check/build/browser/DB/正式READY由root统一。本轮0新模型、0DB、0browser、0生产变更，旧模型预算closed。

## 实现

buildPublicationSourceReview增加可选baselineContent。assessment五分级与旧status/notices共存；covered只表示文字或明确结构值对应，不表示完整语义审核通过。容量、缺失/重复key、同名歧义、实际值完整展示和UTF16偏移约束保留。

Markdown表格按真实cell和br间隔拆分，仅排除层级/模块等已知排版列，未知列仍保留。显式年龄/身份/外貌/声音/动机/边界/与主角字段标签用于限定目标字段，不把L1数字当设定。短字段只有明确标签及唯一主体才能按实际值对应。带说/来信的中文引号消息保留完整正文，尾随“没有付钱”等独立事实另片核对，避免用消息证据覆盖额外断言。实际模板操作说明单列；普通“请核对货款”“请选择车辆”不是instruction。

数值只在唯一主体及明确字段、当前年龄、对应关系年数中比较；相同单位本身不是证据。年龄从实际身份/经历中的明确当前年龄读取，不读notes/summary/未知age字段。否定、假设、历史年龄、年龄差不当当前年龄；26岁与26 岁忽略空白；中文/阿拉伯写法不能可靠确认时unresolved，不报明确遗漏/改错。26/45真未写入仍possible_omission；相识三年变共事三年仍possible_change，复合段同时列出年龄缺失与关系改写。原稿已发生约定未定位历史保unresolved并明确原因，未来候选不能当历史保留证据。

否定与数字比较使用对应句片，不从目标字段的其他句子继承差异。未来可能性放入已发生历史保unresolved；知情限制仍提示需核对真实权限。正确候选文字中的“可能”等词不会仅因notice被判改错。

新增实际phone.messages.at目标，value保原始ISO。只有同一发送者、唯一同正文消息、单一明示开场年月日及北京时间、明确今天/昨天HH:mm才做时间换算；不会使用系统当前日期/时区。缺锚点、同正文多条、错发送者、歧义、无效日期保unresolved。输出同一消息正文与时间两项证据；时间冲突possible_change，不再把17/20当正文缺失数字。不验证全部时间线、地点路径或因果执行语义。

origin只用真实baseline按stable key+字段对比：existing/added/modified/unknown；modified保previousValue（包括空字符串）。没有baseline或baseline安全读取失败为unknown；明确空对象baseline的实际新字段为added。traits只在同actor按唯一实际值判断重排existing；跨actor不借值，重复值/重复key保unknown。不会因无原稿对应就将原有内容称作新增或捏造。

## 验证证据

37/37纯专项，0skip。包含原23项及表格/br偏移、当前年龄真遗漏/否定/假设/历史、相识改写与同单位不同槽位、同名歧义、字句否定、双聊天时间、缺日期/时区/错发送者/重复消息、baseline空值/缺失/原值/traits重排及重复、模板说明/剧情指令、消息后额外事实、中文数字写法。旧复合年龄测试改为检查assessment明确年龄缺失，不再要求在无年龄槽位的关系字段上挂missingNumbers。

TypeScript无输出退出0；模块边界415文件通过；Prettier与git diff --check通过。近上限400×512专项一次约368ms，仅本机证据，不做硬耗时断言。

按root授权只读既有synthetic状态的preparation.material.sources/currentContent与preparation.result.updatedContent，未打印其他字段或凭证。当前17片：covered 2、possible_change 1、possible_omission 1、unresolved 12、instruction 1，无容量warning。两条原有消息时间正确对应；26岁+相识共事合并段同时明确两种风险；45岁单独明确遗漏；昨天约好仍提示历史未确认；消息后“没有付钱或完成采购”独立待核对。没有新模型调用。

真实public/templates/world-script.md空baseline经现有parser后35片：covered 22、unresolved 10、instruction 3。另测原有同名actor的重导入，相关片段保持unresolved，不合并同名人来降低数量。与旧版整行25片不同，不能直接用片数差作为准确率。保留10片待核说明本次只做有界规则，未声称整份原稿已完整落库。

## 接续

root/Q接入真实领域函数与UI后统一check/build、390/1440验证、独立环境部署READY和公网关键流程验收，随后由root勾完成。B冻结后仅可只读审查，不自行扩展规则或启动Notes开发。
