# WORLD-PUBLISH-MD-REVIEW-B · Markdown 导入只读审查

负责人 codex-world-publish-md-review-b-01a11a84-20261013；根明确指派。状态待根验收/冻结修复范围。

## 实际定位

小安工作树：主目录 .local/worktrees/world-publish-people-ui，codex/world-publish-people-ui，干净HEAD 9e231fcc0437187f2ee7a383f9db40fb668dd2ff。
实际提交链：22e5b409992b83f65c53ba6a01466c388f56091e（首次导入）→1df4ec7426b647c1bb54bbff37ee18a7eee86f45（报告）→9e231fcc0437187f2ee7a383f9db40fb668dd2ff（ZIP/粘贴/多人物切分）。父基线是旧836ea2c人物工作台，并非当前root基线。
实际源码publisher-importer.ts、publisher-workbench.tsx导入弹窗，tests/publisher-importer.test.ts及WORLD-PUBLISH-FEISHU-MD-IMPORT.md存在。root .local/worktrees/world-publish-intake-01 HEAD45a05de尚无publisher-importer接线，不能称已上线Markdown导入。

## 已复现的问题

1. **P1 导入结果不符合当前保存协议**。用内存合成Markdown+01A协议报告的合法基准，通过准确root PublishedWorldContentSchema验证：世界导入新增world.title/hook/description被严格契约拒；开场消息缺origin/at；候选缺kind/prerequisites/mutuallyExclusiveNodeKeys/intent。人物关系新增记录缺visibility，缺失的人格项被写空并遭拒。importer没有最终schema或运行支持检查，summary.warnings为空。内存publicCard.identity/appearance还可带undefined，直接schema先invalid_json；模拟HTTP JSON序列化后以上具体字段错误依旧。定位importer538-545、605-610、651-660、679-684。现有专项测试只验证局部抽取，没有证明可保存/试演/发布。
2. **P1 同名人物错合并、原开场知情覆盖**。importer567 findIndex只按name取第一位；两位key不同但同名的既有人物，导入覆盖第一位，且knownAtStart从false变true（form固定true）。单份两名同名人物输入，summary报告2位，实际仅1位，两个summary key相同。未匹配字段也用空白重写现有人格，不能声称无损。应稳定key优先、同名歧义明确选择，缺失字段不覆盖，不默认为认识。
3. **P1 关系修改目标错误**。importer601-603只匹配to.actorKey，不检查from.kind='player'；合成已有NPC→该人物关系会被导入的玩家关系描述覆盖，from仍是另一个NPC。新增关系需明确两端、visibility并避免key碰撞。
4. **P1 隐藏未来被复制到公开简介**。合成世界观梗概包含“隐藏剧情：角色在第三章背叛主角”，原样进入work.description和world.description；root authoring preview publication-content.ts635公开work.description。因此修复world非法键使其可保存时，仍需先区分公开简介、私有背景、未来候选，不能直接公开全部梗概。此为纯解析/公开投影风险证明，未发布任何内容。
5. **P1 剧情、时间和多文件语义丢失**。parseFeishuPlotMarkdown仅取小节标题，忽略正文人物、地点、时间、前置与备选；actorNames恒空，editorialIntent是拼接标题。开场消息只截首行，无显式时间；不得补固定日期/角色/必发生事实假装可运行。importer499多份剧情文件覆盖importedPlot，两个合成文件“第一候选/第二候选”只保留后者，warnings为空。应保留未映射条目并让作者确认，缺必填项阻止应用/保存。
6. **P2 稳定key碰撞与错误去重**。cand key由数组长度生成：既有单个cand_2，新候选也为cand_2；实测重复key且无warning。候选按title去重、消息按actor+text去重，不同时间/阶段但同名/同文不应静默合并。新key从现有namespace无碰撞分配，或显式作者稳定ID。
7. **P2 未识别文档被“成功应用”**。无格式合成文档返回空summary与空warnings，UI确认仍可用并显示成功。没有识别率、非法字段、未映射段落或来源清单；未知导入内容不保留。既有草稿未知JSON扩展在顶层/原对象spread保留（合成extension.keep=7通过），这不等于新Markdown的未知扩展得以保留。
8. **P2 ZIP/大文档资源界限未实现**。纯源码审查：extractZipEntries47-120、UI231-269无输入大小、文件数、累计展开字节限制；Response.text无上限。没有CRC/加密标志/目录边界完整检查，未知压缩方式直接continue。建议有界解包与明确不可识别反馈；本轮未创建压缩炸弹或浏览器实测，不将推断说成已复现崩溃。
9. **P2 异步导入快照未绑定作品/版本（静态风险）**。UI文件读取捕获旧draftContent，stagedImportContent未绑定work.id/版本；确认只setDraftContent(stagedImportContent)。新工作切换useEffect清draft而不清stagedImportContent。应绑定作品与草稿版本/取消代次，避免慢解析覆盖后来选择/编辑。未浏览器复现。

## 边界结论与修复建议

导入当前只是浏览器内存草稿变更；确认处理无onSave/onPublish/网络，不直接发布。没有模型/数据库调用，不预写世界事件，候选本身未被当必发生。React文本渲染不执行Markdown HTML；本轮未发现导入执行脚本或读取私人访谈的代码。初始知情与公开字段自动映射仍须修。

先由root冻结支持的Markdown子集及映射协议，再实现解析→有来源的暂存提案→逐项缺失/歧义/公开范围确认→完整契约+运行支持验证→应用草稿。不能为通关编造persona、关系、时间、候选意图或把剧情改成初始事实。发布继续已有保存/检查/私有试演/不可变发布版本路径；不允许导入直接发布。

保留现有草稿未知扩展；新稿未知块进入导入报告/暂存层而非擅自塞契约。ZIP与文件/粘贴总字节预算、作品/版本绑定必须在接线前补。当前小安workbench来自旧836基线，root应按精确文件/回调集成，避免回退现有剧情编辑器/dirty/试演/地图功能。

最小验收：合法完整文档完整schema和运行支持检查通过；真实保存→检查→试演→发布另验。两个同名稳定ID、同标题不同节点、同文不同时间、key碰撞、多剧情文件、NPC↔NPC原关系、knownAtStart false、缺字段/未知段落、隐藏未来、ZIP字节/条目预算、切换作品/编辑期间慢导入等正反例；任何不完整导入不得显示已可运行。

## 验证与资源

只读准确小安树和root协议/公开投影；内联Node真实纯解析合成反例，不写业务源/测试/公共契约/SQL，不启HTTP/PG/浏览器，不调用模型/生产、不读凭据。未重跑小安声称的37测试/构建，不以其报告代替本次验收。本人仅本报告及唯一主表本人行修改；原31fdbd8剧情源保持冻结。
