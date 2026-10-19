# 44-154-N8 保留人物五维之外的公开背景

负责人 codex-public-premise154-n8；独立 public-premise154-n8/codex/public-premise154-n8；基线 cfdd1cec。状态待 root 集成，0 模型/SQL/生产/部署。

## 原因与最小修复

新 native 冷启动已有五维模块时，原 snapshot 选择 modules 并彻底省略 legacy actor.persona。该 legacy JSON 中本来有发布时的 publicSetting/protagonistPublicIdentity，人物因此只看到导演未来 task，缺少明确公开筹备背景。

新增纯 helper `actor-public-premise.ts`，从当前已由 agentDefinitionRef 绑定的 actor.persona 顶层仅投影两个字符串白名单字段；不递归寻找字段，不取 hiddenContext/overallSetting/其他人物计划/实时位置或原稿。与 primary modules 共存于原 actor.persona JSON 的 `publicPremise`。source/authority 放在受既有 persona excerpt 保护的 `identity` 对象内，边界说明放在受保护的 `boundary` 字段中，避免再次压缩破坏来源或语义边界。

```
publicPremise: {
  identity: {sourceId: "definition:<原人物定义hash>", authority: "public_background_only"},
  boundary: "公开背景与身份设定，不证明当前事件、实时位置、他人知情、人物已经行动或玩家已经决定。",
  publicSetting?, protagonistPublicIdentity?, excerptedFields?
}
```

背景限1800字符，玩家公开身份限240字符；使用原 source excerpt 方法，发生摘录时明确标记字段。未知/非JSON/非对象/错误类型/无公开字段/无合法 definition 来源返回 undefined，不推断背景。

## 认证与兼容

`readPrivateAgentSnapshot` 原逻辑先计算 agentDefinitionRef(world, actorId)，该hash覆盖 world.id、actor.id、原actor.persona与relationship；既有人物state.definitionRef不匹配即 VERSION_CONFLICT，不允许把新定义套入旧state。随后原 definition authored source 注册，再调用新纯 serializer。

没有改来源身份、定义hash算法、snapshot schema版本、事件、paid raw、历史codec或旧快照验证。无五维模块的 legacy-only persona 序列化保持原样。本修复不将公开背景转成实时fact，不提供他人私聊，也不补造开场对白。

## 必要检查

纯 helper+原 actor-situation 聚焦10/10通过，覆盖：五维与公开背景共存；顶层白名单；secret与嵌套字段隔离；异常格式/来源不生成背景；长文摘录标记；旧legacy布局兼容；原模型4000字符JSON excerpt在五维长文下保留公开背景、身份、来源与边界。tsc无错误、边界654文件、Prettier/diff通过。

未变更数据库/权限/队列，因此不重复搭建PG；root统一进行全量门禁和真实新冷启动，不能用本地投影测试代替人物自然参与验收。仅支持已明确标记为publicSetting/protagonistPublicIdentity的字段，不把作者未区分的总体设定或完整开场原稿自动变成所有人物知识。
