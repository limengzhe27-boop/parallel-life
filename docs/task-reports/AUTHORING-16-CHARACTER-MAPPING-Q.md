# AUTHORING-16-CHARACTER-MAPPING-Q · 人物编辑对应审查与待办

2026-10-14；审查 author-import-modules-14；实际读取集成 6c72ec240704d9e047629604908a50685cccbc94。只读业务源码，无浏览器、数据库、模型、生产或付费验收样本操作；本报告只登记后续修复计划，不代表修复完成。

## 已确认的问题（应排入下一项）

1. **公开介绍错写身份。** `publisher-workbench.tsx:1389` 附近「公开角色介绍（玩家可见）」绑定 `currentActorForm.identity`，变更调用 `handleActorChange('identity')`。`parseActorEditor` 仅取 publicCard.identity；实际作者介绍存在 publicCard.introduction。新生成/导入完整介绍不会显示在这里，编剧修改这个框又只改身份，手机仍接收旧 introduction。
2. **五模块全错位。** 当前五个框读/写 background、voice、caresAbout、immediateGoal、relationshipToPlayer，分别来自 privatePersona.background、voice、motivation 拆分及顶层 relationships。它们没有读写 actor.lifeModules 的 lifeContext/traits/drives/behavior/relationships。尤其「行为模式」实际改成眼前目标，不能等同。导入五模块原文存在却看不到；手改框后完整模块仍保持旧值，导演/NPC继续拿旧完整设定与新兼容摘要混合使用，角色演绎可能不遵从作者刚写的内容。
3. **关系模块潜在公开泄露。** 关系模型框被标为供 AI 的核心维度/相处底线，却写到顶层 relationships[].description，并新建 visibility:{kind:'player'}。此描述进入公开 authoring preview（publication-content.ts:751）及 opening.contacts.relationship（publication-genesis.ts:414），最终联系人投影显示。编剧如果按照「关系模型」填写幕后策略/认知差，可能以公开关系简介泄露给玩家；不能把 L5 私密模块继续接到这个公开字段。

## 是否会仅打开就覆盖原稿

**本次未发现被动渲染覆盖。** 工作台从保存稿 deepClone；parseActorEditor 是纯解析；dirty 比较实际 content；800ms 保存仅在实际差异时运行。纯合成内存断言显示 `updateActorInContent(content, parseActorEditor(...))` 无变化。源完整模块与明确介绍仍保存着，问题是展示与主动编辑对应错误，不是打开页面就被自动摘要覆盖。

**主动编辑错写已复现。** 合成内存断言确认：修改「人生背景」后完整 lifeModules.lifeContext 不变；修改「公开介绍」后 introduction 不变；修改关系框生成 player 可见关系。未读取或修改任何真实作者稿。

## 最小后续修复

- 直接复用既有 `CHARACTER_MODULES`、`characterModuleText`、`updateCharacterField`，五模块输入各绑原字段，按唯一 actor.key 更新；完整原文不截断、不拆摘要、不将私密模块变公开。未来扩展与其余作者字段保持原样。
- 公开角色介绍框绑 publicCard.introduction，身份另用明确「身份」短框或已有字段；禁止从私密模块推断玩家简介。不能让一个框同时表示两种含义。
- 对旧角色仅有 privatePersona 的兼容：可显示明确的旧摘要帮助理解，但不要在初次 render 自动写入完整模块。作者主动确认/编辑后才创建对应模块；动机拆分、眼前目标与行为模式不可硬替代。未编辑其它旧摘要/角色/素材不改变。
- 关系模型始终私密 lifeModules.relationships。已有公开 relationship 不删改；若仍需要编辑公开初始关系，应有清楚的独立用途，不能与五模块合并。
- 真实试演保存新 canonical 作者稿后按版本/hash重建独立手机；旧存档是旧稿版本快照，不能静默覆盖。已有普通历史/动态未修改时保留。新五模块要进入真实 NPC 自己的隐私上下文，新 introduction 进入玩家资料。

## 未来验收

用任意两个通用合成角色（不绑定特定剧本），完整5模块长段落与独立身份/公开介绍：加载所有原文、只改一个模块只改该字段、隐藏底线不出现在公开预览、readonly/busy不能绕过、打开不产生保存、保存→回读→新试演NPC上下文/资料拿到最新版、旧绑定不变。保空值、无模块老格式、未知扩展、重复key安全退出。编辑期间800ms自动保存与试演排队保持原保障。

此项由 root 排入主清单并分配后再改源码；当前正在进行的真实生成验收继续，不触碰样本、不追加模型调用。
