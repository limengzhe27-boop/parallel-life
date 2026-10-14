# SCENE-NATURAL-02

负责人 codex-scene-natural-01a1334b-20261014；root唯一部署集成。独立复用map-travel-repair树，保上轮4/4闭账不沿用。当前只读/设计已登记，待I确认代码范围。

用户程晓小店实录：问“有人吗”，系统说未回应，下一条人物回应；第二问晚饭得到僵硬索要回复；现场无动作/环境承接，像微信。

已读PROJECT_BRIEF/DEVELOPMENT/ARCHITECTURE_REVIEW/ARCHITECTURE/PRODUCT/DESIGN及SCENE-EXPERIENCE-REVIEW-01（后者只有建议，不是已经实现）。发现集成树HEAD309c8f6与已发布origin/main d7389b4不同：最新93f9666/76bda1a已加场所候选、行动到场与旁白去重，必须基于最新不覆盖。旧地图报告末段已保存7b46bd4，再合origin/main，无源码冲突。

诊断：scene-planner对导演禁止人物动作、NPC普通prompt要求纯台词；导演先给observation，独立NPC随后答话，没有回应结论的一致性守门；条目仍将重复time_place/环境当每回合信息。程晓属于retired-star，不硬编码人物或题材。

方案见docs/design/SCENE-NATURAL-02.md。拟内部dialogues可选delivery，仍用现有narration条目保存（无需公共HTTP或SQL）；允许动作回合环境无新变化不追加，保开场非空和实际成果判定；新增一致性/隐私/来源守门、真实多轮。最多8新文字、本地与公网各1合成存档、0图片，当前0调用；不使用别线程24/2资源。写代码前先I协调并更新主表具体scope。

## 2026-10-14 实施与真实验收接续

I确认上述范围后开始，基线d7389b4。已实现内部可选delivery、身份与微动作校验、同轮沉默/对白一致性、动作回合无环境变化可空、既有narration存储、现场时间地点去重、弱化聊天卡片。普通问句不自动关联全部事项；只有实际在场且无结构化规则/延后动作时直接独立人物生成，保存原始发声回执且0事项/步骤更新，前端只去掉原文完全相同的发声回执。旧自动关联输入在同一无规则边界下兼容，不修改原输入。

真实费用独立累计：原12调用均计入（包含1次输出拒绝、1次上游unknown），用户明确追加6，总上限18。本地13已用、1临时存档；公网0。每次失败计入，不沿用旧closed4/4或root24/2，不生图。真实存档已经从海边住处正常前往小店、进入现场、保存开场与两种问句；但对话质量仍未达标，不能当验收通过，更不能发布。gpt-4o-mini收到修改后上下文仍模仿“等你来/确认时间”旧对白；13轮短prompt虽有合法微动作，仍对“有人吗”主动再提晚饭。继续收紧普通角色上下文最近轮、标明历史发言身份/当下已保存地点，尚未用最后本地一调用。

最近检查：npm run check 2219/2219；核心角色与步骤测试60/60；真实PG scenes/scene-step-runtime/scene-natural-delivery 5/5顶级（包含子用例），RLS、lease、来源绑定、原有信用规则、原子rollback。最后prompt变更仍需复跑check/build/PG。布局390×844/390×500/1440×900已检查无横向溢出，合成布局数据明确非真实AI，并已移除。

当前进行中，root唯一集成部署，禁止将本地桩/差质量真实回合标成功。接续：最后本地call14质量通过后才冻结提交/交I；公网预留4，READY后完整开场2+两问1/1。若本地14不通过，停止新付费动作、保存证据，继续无模型修正，不上线。

冻结接续：call14采用短普通prompt、本人可见预约、近6条现场与发言人身份，依然生成“今晚的晚饭你到底能来吗…期待答案”，delivery政策拒绝，不能质量验收。当前14/18，本地14、公网0、新存档1已正常pause200；浏览器原localhost会话已恢复、HTTP3287已停，Ego175保留待复验。只读网关模型清单确认gpt-4.1/4.1-mini/4o/5/5-mini可用，0新生成。用户待答是否将预留公网4调整本地，未获答前不调用。root已收到未上线原因/证据，暂未回复模型策略。

最终check2219/2219（构建与check初次并发曾产生.next types文件竞态，按顺序重跑已过，不掩盖）；PG5/5顶级通过；最新build正在顺序复跑。代码WIP未公开部署；不能把旧线上地图交付当本次现场修复。

顺序最终build成功，check2219全过，PG5顶级全过。代码冻结仅供I审阅，仍未真实质量验收；等待预算用途调整/模型策略，未发布。

## 18/18闭账与本地自然回复通过

用户明确将剩4转本地；同一local1存档，无新存档/图，忽略的启动器仅本地model=gpt-4.1。原未知任务在明确leave后仍unknown造成space busy，已定位navigate仅取消queued/running；现在包含unknown并保历史。旧已保存leave回执相同hash重放也取消同scene遗留unknown，保原回执/版本，不自动付费。实际旧回执正常HTTP200恢复，然后UI进入新scene6a5b34fd…；该老版本恢复暂依赖精确leave回执重放，旧已离场且不掌握回执的纯UI用户仍需I补受控恢复入口/space audit过滤，不能遗漏这点。

call15/16新开场真实成功：午后阳光/玻璃门/桌椅环境，人物擦杯直接招呼眼前玩家。call17有人吗真实成功，答柜台后在场，微动作在台词前。call18吃饭问句真实成功，说明桌未收拾、先坐、晚上六点开饭，也提本人已知明天熟人晚饭。两输入均resolved/relatedMatterIds[]、0事项完成。保存v21；完整原结果在ignored .local/scene-natural-4.1-result.json。台词仍可能带人物调侃/提明天话题，不宣称通用质量已穷尽；本例不再机械等邀约回复且有观察动作。

实际390×844/390×500/1440×900无横溢出，textarea分别737–783/405–451/775–821；本轮发现滚动flex子项被压缩造成菜单点击重叠，reading子项禁压缩，保输入框可见。刚才一幕也不再把完全相同发声回执称随后结果。截图均ignored .local/scene-natural-real-*，实际非桩。

最新check2219/2219；PG6顶级/0fail含新unknown leave/replay/late lease/RLS/真正往返travel+entry。最终build需在新模型选择器任务后统一顺序跑。存档pause200、HTTP已停、ledger18/18 closed；原localhostcookie待本次恢复。root已确认此证据，要求先冻结本组，不自行部署；允许下一SCENE-MODEL-01独立服务端配置YIBU_SCENE_MODEL默认inherit全局，只用于ScenePlanner内部导演与独立人物轮，其他服务不变。root审后决定正式env/发布；不把local通过称线上完成。

官方模型指导只作为对比设计，实际采用结果以网关与本地真实回合证据为准：[GPT-4.1文档](https://developers.openai.com/api/docs/models/gpt-4.1)、[提示指导](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide)。
