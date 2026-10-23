# 44-141 导演交接与人物下一步真实模型复验

2026-10-18；codex-root-live141。部署9ffb40d0de4ec115d7a369e295339e4a5b3592af/dpl_86WULCmXSuREQonKeP8wYAzHqGz8精确Nu READY后，通过正式原试演入口验证。新授权最多6文字调用、沿用原档、不新增草稿/存档、不发布/个人资料/图片，结束暂停，unknown不自动重试。

实际5次（1导演+4人物），0unknown，全部paid attempt committed。原138五次attempt作为排除基线，未复用旧额度。仅沿用合成world07c377c2-2b37-4b02-8a85-417996b08697/trial4ade2b70-11dc-4bc8-9271-3add59628a0f；最终v7已通过原lifecycle暂停。本轮额度闭账，余1不沿用；没有手动补写任何角色状态、台词、计划、执行结果或事件。

## 通过：导演引用修复

一次明确已知失败重试，导演返回合法director-wire-v1并提交：真实eventRef绑定opening_plan作者来源；提出opportunity_1“讨论开业分工”，参与人物为原两人，shared_episode.status=proposed。候选与人物引用未再混淆，无纠错重买。原调度先承接已有责任产生一次NPC回合，随后分别给两人物原coordination事件输入。导演提出机会与人物参与、事件实际发生严格区分，不能以committed或API200宣称剧情已演出。

## 未通过：人物选择与下一步

1. 两人物确实各收到npc_episode_consideration，但商业模型均返回statements/goals/plans/actions/responsibilities/decisions全空，省略episodeDecision。原投影把这保存为unassessed并consume各请求。两人没有明确engage/defer/decline/quiet及原因；事件仍proposed，没有实际进入演绎。不是模型明确选择安静，不能冒充quiet或自动补engage。
2. 玩家相关修改“先约我今天18点在河边小店一起核对清单，收到邀约再确认”后，人物只对白答应；plan_material_check原样active、nextActionId=null、actionIds/triggers/missingConditions皆空，actions=[]，未创建正式邀约。新增planNextSteps分类与v17提示尚不足以让实际输出补合法下一步。不能宣称139已完整解决此项。
3. 协调输入只有requestId/activity/placeOptionIds和本人definition来源，不带明确的事件主题。B没有历史聊天或额外observations可用，需审核既有作者按人物授权的未来意图投影。不能因此直接下发导演全局description、其他私聊或秘密。

## 下一阶段核心任务（已回传小安只读定位，不并行改公共源）

- 专门coordination输出契约要求明确choice，quiet也要理由和合法来源；普通私聊的无关manifest仍可不消费。避免无决策空输出成功消耗交接资格；不得用默认参与/默认安静替人物判断，不能自动重买。
- 新增或修改的运行中计划，必须具真实action/nextAction或可解释的有来源等待/能力缺失；让domain/kernel阻止空壳计划冒充已处理。保留旧档，不强行给旧空计划插硬时间，不靠关键词把对白变成执行。
- 按原授权链提供有限未来意图和本人主题，标明建议而非事实；保持导演全局与人物知情隔离，先明确来源/接口归属，再改公共协议。

本轮为真实商业模型验收，不是受控适配器。未改应用/SQL源码，不重跑既有3299项检查；上线业务仍9ffb40d0。私有证据.local/ma141-state.json（含会话，禁止入库）、ma141-proof.json、ma141-baseline.json、ma141-result-*.json、ma141-phone.json。原手机数据接口可见真实消息，未另建演示对话界面；没有本轮浏览器视觉验收声明。

## 2026-10-23 人物下一步补验（44-145 正式邀约）

在合成验收世界用 1 次真实模型调用复验“人物只答应、不建正式邀约”的失败项：玩家明确请求“再发一个明天中午的正式邀约，地点你定”，林悦回复“我给你发个明天中午的正式邀约，地点就定我家吧”，并真实创建 `5260bf8a...`“明天的中午聚餐”（proposed，林悦家）。手机卡片接受后 v209、status confirmed、responseVersion 209。详见 [44-145 报告](44-145-NPC-WIRE-LIVE-ACCEPTANCE-I.md) 与截图。

这直接覆盖本报告“未通过 2：人物只对白答应、未创建正式邀约”的缺口；导演部分此前已 1/1 通过。仍**未重跑**“coordination 空 episodeDecision”的真实模型场景，但 44-172 的 manifest 必选选择 guard、44-161 actor opportunity/handoff 接线已在主分支/聚焦测试中收口。

因此 `44-141` 按“导演交接 1/1 + 人物下一步/正式邀约真实验证；coordination 空决策未重跑”限定收口。不能据此宣称所有 coordination 输出都已自然稳定，`44-138` 仍保持最后总验收。
