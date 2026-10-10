# BOOT-01N-COORD · 真实历史来信分步生成

2026-10-10，根协调 codex-main-boot01n-coord-20261010。用户要求继续优化，接续上轮4b593e2 READY。上批完整开场混合actors/notes/messageHistory，实际4请求失败，恢复生产旧协议；新模型历史仍未交付。

本轮只改善真实生成闭环，不重新大改页面。候选两步骤：世界设定通过现有角色/授权校验后冻结；独立生成过去来信，程序绑定演员与编号/锚点，再严格验全部覆盖/字数/时间/来源；完整结果一次事务，不在ready后补造。旧世界不回填、不伪造玩家发言。若失败保护此前可用生产协议，不能当成功。

风险需I先明确：两步不能各耗85秒导致超110秒HTTP生命周期；含纠错的累计调用需有限、unknown不自动重付。演员key由程序绑定，文字不能模板兜底。历史生成输入只用获准世界设定及对应角色必要知情，不给NPC其他人的私聊或完整真实档案。当前五类跨应用完整前史及长期回忆预算仍留父BOOT。

已分派I唯一源码/集成与F先只读审查；根不写业务。新批最多10供应商实际请求含纠错与NPC承接，生图0，不抹去上批4失败。资源各登记后开工，稳定后释放Q新测试。当前尚无新生成/测试/部署证据。

## 稳定源码审查及协调交接

辅助首审4b61a41，13组可执行反例已读，编号绑定与上下文裁剪采用。根发现projectPlayerActors明确禁止内部relationship作公开兜底，I修为只传当前seed.personRoles的明确branchRole，未知空，不传原生actor.relationship。根另发现child100秒TimeoutError无code可能被110秒外层runOne误记failed，I已在two-stepcatch映射TIMEOUT/CANCELLED，原生abort与晚返回不纠错。

已只读审b265959完整5文件：私有HistoryPlanner严格groups{actorIndex,messages}，integer唯一全覆盖、可乱序、机器绑定key；160字/60..43200分钟/每人最多6，既有domain二次校验；模型只接identity/setting/storyTime和安全cast，无persona/ties/notes/当前私聊/seed。第一阶段授权姓名/角色先规范化，第二步角色冲突拒绝，不重生成世界补历史。共100秒signal、有限2+2known格式纠错，未知/取消/截断不暗重付。handler读完与commit前检查取消，最终仍现同事务与lease fence。默认single-pass和falselegacy保持，生产未开two-step。

I证据550check/build、5真实PG通过，真实本批0/10；不是根执行，不叫全库或AI成功。释放F唯一新boot-01n-q测试，独占PG55458/HTTP3263-3264/一个新Ego，源和旧测试只读，0供应商。

根报告至此冻结，只读跟进；允许I最后受控收3报告/任务表/实际用户待验入口/部署记录并一次最终文档提交部署。真实双入口/NPC/日期/read态、最终READY/公网尚待，不标整体完成；旧世界不回填，父BOOT全跨应用前史、长史召回、多聊天/地图/任务仍未完成。

## I受控最终有限集成验收

有限集成自审通过：业务7a98c8f/2wwrxj6mp/dpl_F6DchQ4YWpsD62nNpuciofQsRYXk READY，QA独立test7e7fe79待随最终文档发布；550check/build、最后15串行专项全部通过（含F纯跨午夜/PG父组）。本批实际7/10文字请求=普通世界2+历史1、固定cast世界1+历史1、两NPC各1；普通4人物8旧/3当前，固定2人物4旧/4当前，NPC版本1/immutable hash不变。正式READY后health/两world均200，390短屏/长屏和1440电脑420宽无溢出，历史默认已读不通知，当前独立分钟/读态正确。旧M四失败不改为通过；本轮首遗漏地点纠正、脚本receipt误读只读恢复、语义样本限制保留。所有真实seed明确合成，不冒称AI推荐；真实模型执行为本机冻结planner+生产受限Queue/Repository，未额外付费测试HTTP /tasks/run。model gpt-4o-mini与旧自有正式task元信息一致、85秒gateway同实现；当前生产敏感env值由Vercel遮蔽，无法直接比较key/baseURL，不冒称已独立核验。两自有world已暂停/仍version1，7请求不变、0生图。I105会话精确恢复并finish一次、PG55450及HTTP3254/3255无监听（HTTP未启）、临时依赖链接清理；F106/55458/3263/3264清理。39生产迁移06:11:28Z校验一致、无SQL。仅有限NPC过去来信本包完成，父BOOT日历/便签/素材/长期召回/跨设备读态及任务地图多聊天仍未完成，用户A15待体验。

三个报告/主表/A15/DEPLOYMENT只作这一次最终文档归档，随后最终READY与正式读态写忽略handoff，不循环追加文档。不再新开任务。
