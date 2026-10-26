# ACTOR-RETRIEVAL-12

基线a5cc178e，独立codex/actor-retrieval12。0模型/原档写/端口。公共NPC模型和Director-only continuation投影由root负责，本任务不改。

## 真实断点

原4953林白语aecd的v350消息来自attempt2bce73…（snapshot349）。初始12条已说过的历史对话均不在sources，e714“我周末可以带你去见我爸爸”以及运行v55 b94“周末那个见爸爸的计划…”未入选；只有开场本人报告还在。原9个durable questions都是工作/照片，初始Message本来没有requestsPlayerReply结构，不可凭自然语言追认责任/承诺。actorContext只以自主wake机器JSON做历史关键词检索，近期12条已被索图对话占满；历史8槽须相关分>0，因此真实旧邀约消失。模型据此称“没跟他说过”，不能把有自主新消息称为完整自然连续性验收成功。

## 最小共享修复

- 新纯application helper从已认证的本人物料取独立检索提示：收到的开场report、有效goal/plan、当前私聊open问题。拒绝全局原稿输入，不推导人物新决定；忘记/不可见来源不参与，玩家输入不生成额外提示。
- 原snapshot reader已有本人的narrative读取后窄hook；不新增查询/模型/持久字段。
- 原actorContext多一个内部可选检索提示参数。原recent12保留、8条历史槽、18k上下文和11.5k消息预算保持。每个主题有界检索；相关的已认证创世对话与运行后续各有候选位置，避免单一近期闲聊桶抹掉“曾说过”证据。所有记录先按原actor/forget过滤，原文、来源、排序和来源认证流程不改。无额外提示时原算法排序不变。

## 证据与边界

- 只读原档保存材料离线复现349：旧e714由未入选变为入选，仍原话/原publication-genesis来源；最终20条消息、5834字符。b94本轮未占历史8槽，未宣称两条都保留；已经恢复的一条真实初始发言足以让NPC看到已提出过该邀请。
- 15/15聚焦unit（含原actorContext全部回归）通过，typecheck0。覆盖普通玩家完全不变、其他人物私聊排除、忘记来源排除、原quote/source保留、预算和槽位不变、有效主题与终态过滤。
- 未调用真实模型，未修改初始消息或补questions，不声明已彻底解决长期人物自然表达。上下文候选有界仍非完整历史，最终真实体验由root验收。
- 只读另确认actorStateContextPayload缺continuation而保留questions.resolution；root已负责Director-only显式投影，不在本提交重复修改。
