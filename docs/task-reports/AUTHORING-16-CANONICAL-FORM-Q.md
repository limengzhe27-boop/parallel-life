# AUTHORING-16-CANONICAL-FORM-Q

author-import-modules-14；2026-10-14；只读审查精确 d362ed28822cdf989dcbde37915c1b57d7e3cbdc。root集成04f44cc的人物model/workbench与该提交无diff。仅报告/登记写入，无业务修改、真实模型、数据库、浏览器、生产或样本操作。

## 表单修复结论

**canonical表单范围未发现新阻断，原三项错位已实质修复。**

- 公开身份仍走 identity 独立框，公开介绍输入和onChange现在对应 publicCard.introduction，保留换行/空格原文，未从五模块或私人摘要推断公开资料。
- 五个输入逐项由CHARACTER_MODULES映射到lifeModules.lifeContext/traits/drives/behavior/relationships，读取characterModuleText，实际handler调用updateCharacterField。只更新唯一选中actor的该字段，不把行为模式变成眼前目标，也不改旧privatePersona。
- L5写私有lifeModules.relationships，没有写top-level relationships或player可见范围；既有公开relationship原封保留。公开characterPreview只允许公开介绍/身份等，五模块不出现在玩家预览。
- 旧摘要只在缺少该模块时以折叠参考呈现；打开没有migration或保存。新输入按作者主动编辑写入，未知扩展/人物/素材/已有聊天与动态不变。空白输入只清该可选字段。非文本容器和重复key fail closed；readonly/busy既禁用输入，也阻止强制调用handler。
- 保存后新试演按实际版本/hash绑定，服务端wrapper读取该绑定版本中当前speaker五模块；system明确ownCharacterSettings优先用于刻画表达。旧存档保持旧绑定，没有静默用新稿替换。

## 验证

运行当前集成的 tests/publisher-character-canonical-form.test.ts：5/5通过，实际React字段handler保存/回读、单模块编辑、空值/扩展、readonly/busy、私密预览以及stub真实planner wrapper链已验证。该专项DB与model都是内存stub，没有网络调用。测试loader的effects不执行，所以此处不是声称已测真实800ms自动保存；root手机/PC正在做最终验收。

## 已有运行缺口（不是d362表单回归）

**P1/接续：允许保存的长五模块可能被NPC上下文静默全部省略。** publicationCharacterPlanner（src/server/publication-character-planner.ts:48-62）把本人全部五模块作为可选supplement；超过 ACTOR_CONTEXT_LIMIT=18000 或 ACTOR_INPUT_LIMIT 时不加入，也没有告诉作者/调用者。每维schema允许4000，合法5维共20000字即使极简基础context也必超18000；完整原稿保存在库中，却不会发给NPC。纯stub复现输出 modelReceivedCanonicalModules=false，model只拿兼容摘要，仍返回正常回复。这违背「编剧已更新完整设定后用于人物演绎」的预期，不能把长稿测试通过等同全人设已阅读。

最小后续修复：让必需的本人作者模块有明确预算策略，先裁可选旧历史/动态而不是静默丢整套作者设定；若仍不能完整输入，应明确阻止本次演绎并显示可理解的容量提示，或者采用有来源可核对的摘要机制并保原文。不要直接截断原稿、改成公开资料或擅自提高供应商输入预算。本报告未领取此业务范围，由root安排。增加500字普通稿与4000×5边界的stub链断言，必要真实模型质量另按root额度管理。

此前legacy两份设定同时保留不是本次错误：prompt已让本人模块优先。是否所有模型均遵从仍需真实多轮质量验收，不能仅按stub断言承诺性格质量。
