# WORLD-PUBLISH-MD-PARSER-B · 有来源、可补全的 Markdown 导入

唯一负责人 codex-world-publish-md-parser-b-01a11a84-20261013。root 指派并冻结语义/接口，root 唯一 UI/公共契约/集成/发布；Q 独占 ZIP。
基线13fccfeb9b41c4bcde65be8c0dd6833e13fdb29c，独立 /Users/limengzhe/.codex/worktrees/publication-story-02/人生剧本，codex/publisher-md-parser-b。
状态待 root 集成；本批未上线，不替代当前公开版本2。

## 精确范围

仅新src/features/publisher/publisher-importer.ts、新tests/publisher-importer.test.ts、本报告。解析器从小安9e231fcc同文件起点修复；不拷旧workbench。不改UI/controller/contracts/domain/SQL，不启动服务/DB，不调用模型或生产。不提交私有稿件、测试原文或ZIP实现。
extractZipEntries仅re-export Q的 ./publisher-zip.ts；测试期经root授权只读copy Q的WIP作未提交依赖，最终交接移除。root应先集成Q ZIP，再全检本模块。首次Q参数属性不兼容strip-types已向root报告，由Q修正；未越权修改Q模块。

## 冻结接口

parseFeishuMarkdownBundle(files,currentContent={})仍返回{updatedContent,summary}。
summary保留world/actors/initialMessagesCount/candidatesCount/warnings，新增：
- diagnostics: Array<{code:string,severity:'warning'|'error',filename:string,path?:string,message:string}>
- unmapped: Array<{filename:string,reason:string,content:string}>
- blocked:boolean
- actors条目新增completeness:'partial'|'complete'。

unmapped每份原文仅在前端提案完整保留，reason=source_review，不进extensions、公共DTO或日志。累计输入含文件名最多128KiB UTF8/64文件；超限明确blocked，原草稿不变，无静默截断。识别计数仅本次实际填入，blocked时归零。

## 草稿与发布的边界

JSON descriptor/原型/预算错误、已有字段类型错误严格阻止，不执行getter，不抹掉原错误。
原baseline完整schema合法时，不能因导入引入新非法记录；新增错误整批返回原草稿。baseline本来不完整时，原缺项继续warning待补全，可填入明确字段；新人物可以存已识别字段及空字符串的待补全persona，空字段不是假回复/人格，绝不说可发布。部分人物只在原baseline不完整时允许；完整baseline遇缺persona人物保报告、不追加非法人物。
新增记录的类型/引用/长度/数量/实际时间仍守协议：12人物/40开场消息/32候选上限。超长候选仅该段留unmapped+warning跳过，不截断或阻断其余可整理内容；整体JSON/输入预算与原合法baseline新增非法仍全批阻止。

## 映射修复

- 已有任一同名人物默认不写、不合并，原knownAtStart、关系、persona、扩展逐项保留。新批同名各自唯一key，消息歧义留待整理；namespace分配不依姓名或数组长度，不碰原key，不按候选标题/消息文本静默去重。
- 单份人物先有L1–L5表格、后有一次重复人物标题时保持整份单人物，不把前缀分身。真正多个顶级独立人物标题才切分；各L1–L5重复行累计读取，不取最后一行覆盖此前内容。正文列用于字段映射，额外说明列、旧重复设定、未映射段落保完整source_review，需作者核对，未假定全文都可运行。
- 预算内明确字段原样填入。缺失/过长必填persona在不完整baseline留空+warning；明确未来/后续背景标记不写NPC初始背景，留空待拆分；不靠全部成年或默认时间洗成可运行。未来识别是明确标记与人工整理提示，不是全文语义或内容尺度审核。
- 世界明确title/主角identity仅填空；公开简介、开场钩子、公开设定只接受明确作者标签且不覆盖已有非空。梗概仅hiddenContext填空；未来/秘密不从梗概推入公开description/hook/publicSetting。原稿未明确的主角处境、日期、地点、路线不推断。
- 不推断或覆盖玩家/NPC关系；关系原文保待填明确两端和visibility。
- 每份plot累积，每个预算内候选保完整原始段落，strict kind=candidate/prerequisites=[]/mutuallyExclusiveNodeKeys=[]/intent=editorial_only。不自动生成时间线、人物引用、运行邀约或必发生事件。
- 来信仅完整显式UTC ISO+history/incoming+唯一已认识角色，且相对明确world.startAt合法才写。无日期/来源或角色歧义留待整理；无当前日期默认，不替玩家说话。完整非法未来来信使本批阻止，而非吞掉错误。
- 每份原文均有source_review warning；未知格式不会零警告成功。结构性“基础设定/角色身份”等标题不生成幽灵人物。

## 实际验证

26/26标准node strip-types专项、0skip，合成fixture真实PublishedWorldContentSchema/publicationContentIssues/公开preview与运行capability协议验证。覆盖完整与partial baseline、原字段类型/getter、同名/同批同名/稳定key、关系/未知扩展、future与公开隔离、两plot同标题完整正文、重复表行/旧重复标题、无日期来信/显式不同时间同文来信、原合法baseline整批回退、字段与总预算/数量界限、未知文档、幽灵人物。

真实私有原稿仅额外只读纯验，未复制正文进Git/日志：4MD共61844 UTF8字节。空{}草稿blocked=false：青青/林白语恰好2人物，均partial、已填sectionsCount4；5幕后editorial候选填入；5缺ISO/origin来信未写；1超长候选保完整原文待整理。unmapped4原文件；work只有明确title，world只有hiddenContext，原稿无明确标签的public description/hook/主角身份未推断。各未来背景留空，另1过长字段留空。草稿仍待补全，不能发布。

root公开合成模板public/templates/world-script.md对空{}纯验：2人物阿禾/老陈均complete、sectionsCount5，2editorial候选、0消息；明确work.title/description/hook、world.hiddenContext/protagonist.identity均识别。17缺项warning（世界日期/地点/公开设定/基调等仍待补齐）；无需改root模板格式。未从私稿推断额外人物/地点/时间。

npm run check 已运行，边界/type通过，完整单测有4旧DB测试ECONNREFUSED127.0.0.1:55478：character-image-flow两项、rls-tenant-isolation两项。按本轮0DB授权未启PG，不称整库绿；其余与专项通过。npm run build通过；最终check计数及格式见交接。首次测试依赖的Q strip-only问题由Q修；初稿过度阻止partial导入已按root新要求修正，失败样本不算通过。

## 根接续

先串行接Q ZIP和本三文件，再接root UI；不要直接cherry小安旧workbench回退当前后台。unmapped只能留当前前端导入记录/下载，不自动保存/发布/公共展示。completeness是人物字段完备性，不是整世界runtimeReady；summary warning/blocked不能被UI换成“已可发布”。
root用本地真实库补旧4测试及保存partial→作者补全→检查/试演→发布；手机/PC、ZIP与原文预览/版本读入守卫由root/Q验收。本执行者模型、生产、数据库、端口、浏览器均0，原剧情31fdbd8源仍冻结。

最终冻结验证：26/26专属pure、完整check1775=1771pass/4旧DB连接失败、401边界/type0、build0/formatdiff0。无PG/端口启动；Q临时ZIP依赖只用于验证，提交前移除，最终仅三文件。

## 限定精确去重后继

root新增明确授权：仅候选kind=candidate、intent只有editorial_only、原key合法、actorKeys/prerequisites/mutuallyExclusiveNodeKeys均为空且无timeline/placeKey/其他未知字段的既有记录，当title与完整editorialIntent全等，warning exact_editorial_duplicate后跳过，原key不变；当前batch也适用。检查在32候选数量守卫之前，已满数量但只重导同一无scope稿件不会误报超限。相同标题但改正文仍新增不同key；任何actor/place/条件/timeline不合并。

新增一个综合API回归，实际schema/domain验证重复导入0新增/原key保留、同batch仅1项、改正文同标题仍独立、有actor scope仍独立。27/27专项、typecheck通过、diff/格式通过；按root限定不再全check/build，保留上面的26专项交付及1775完整check/4旧DB环境失败证据。

messages目前没有exactduplicate跳过。建议若后续授权，可对完整schema合法的原消息仅actorKey+text+at+origin全等、原key合法时warning跳过；不同时间或来源不能去重。本后继没有改messages，也没有新DB/端口/model/生产。Q临时ZIP依赖不提交并收尾移除。
