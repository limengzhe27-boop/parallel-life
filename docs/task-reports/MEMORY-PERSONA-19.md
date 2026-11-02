# MEMORY-PERSONA-19：稳定人设选择

负责人persona19；root唯一集成。基线ffb2f8c6，独立工作树`/Users/limengzhe/.codex/worktrees/persona-core19/人生剧本`，分支codex/persona-core19。

## 改动

只改actor-situation.ts及原actor-situation.test.ts。

- `selectActorPersona`仍复用原五类人物材料与原预算。traits/drives/behavior/relationships使用与本轮话题无关的固定原文摘录；lifeContext仍选择与话题相关的详细经历。
- `legacyPersonaExcerpt`对已识别的核心人格字段（包括嵌套对象/数组）沿用同一选择规则。身份/姓名/边界原样保留。
- `reserveActorContext`的最终容量兜底也复用同一核心摘录方法，不再因聊天关键词重新挑选核心性格。
- 没有新字段、持久化摘要、模型调用或检索服务，不改作者原稿。相关输入入口已调用这三个既有方法，因此无需新入口。

## 验证

18项聚焦测试通过：actor-situation6项 + actor-context12项；typecheck通过。新增覆盖：换海边/医院话题时四类核心一致、lifeContext按主题变化、有条件的性格差异保留、legacy嵌套核心一致、身份边界不变、总体容量兜底核心一致且原稿不变。

未调用付费模型，未写生产/用户存档，未启动/停止3218/3219；构建和本地集成由root执行。

## 边界

这是现有原文选择逻辑统一，不是声称已将任意作者长稿语义提炼为无损人格摘要。超过现有预算的核心仍是固定摘录，全部条件性人格事实不能由截取算法保证完整保留。未结构化的legacy纯文本仍走原有相关性摘录，不能假装已识别其核心/生平边界。原稿保留，后续如需保存经过整理的人格核心，必须另行依据现有作者结构评估。

本批不承诺整体输入减少或回复提速；解决的是核心随话题抖动和不同裁剪入口规则不一致。旧入口总预算保护仍保留，没有为“减少步骤”删除必要的容量兜底。
