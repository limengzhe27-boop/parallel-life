# 44-161-DIRECTOR-WINDOW

待集成；独立 director-window161，自 155cd3ad。root 独占集成、真实模型与生产部署。

## 实际断点

授权只读新试演证明 bootstrap 同时装入18个完整作者事件、18个必填 authoredChoices、1个 opening、0候选、6人物。旧 schema 同时要求非opening只能defer，assessment又要求覆盖全部eligible，导致一次开场quiet把未真正考虑的其余事件也纳入付费评估封锁。系统末尾提供可复制quiet结论，实际返回复制了该例子。

## 统一架构改动

新 snapshot 增加版本化 deliberationWindow，完整作者目录、资格、来源仍保留在原保护快照，原完整catalog比对不放宽。窗口从已认证 wake/eligibility 确定：bootstrap优先合格opening，后续从同上下文尚未评估的qualification按nodeKey稳定取最多2个。没有作者唤醒的普通协调窗口为空。

模型仅获得本窗口完整事件文本与资格，wire目录/schema/显式assessment对应同一窗口。claim/send/commit的原current验证重算窗口；越界窗口拒绝。paidReviewContexts只消费实际窗口中的评估，未展示事件继续保留unseen资格；不会随actor revision/刷新重新生成已消费资格。旧snapshot无window严格沿用旧解释，不重解旧付费输出。

同步删除可直接复制的完整quiet范例和占位reason；仍允许有依据quiet/defer，无字符串黑名单，不强制consider，不插消息。

## 必要验证

- 34纯模型/协议与窗口测试通过；原prompt测试改为断言不提供可复制结论，保留无效audit不修补测试。
- 一条真实本地PG原出版→snapshot→Director runner→commit连续旅程通过：保护目录7节点完整；opening窗口1个，随后2+2；bootstrap不消费余4项；各窗口仅返回对应assessment；伪造窗口claim拒绝；所有实际窗口评估后wake=null，无模型重买。模型为受控适配器，0真实费用。
- TypeScript通过；边界检查675文件通过。无SQL迁移/生产改动。

## 集成注意与剩余

新窗口要求显式assessment，真实v8协议自动生成；旧snapshot继续接受旧协议。旧集成测试若用没有protocol/assessment的老quiet夹具驱动新snapshot，需要更新夹具为当前wire格式，不能因此放开新窗口评估边界。

窗口降低负担并保留后续资格，不保证模型必选开场；必须由root最终真实试演验证交接与NPC主动演绎。旧付费全defer的18项记录不被本提交重写或自动重买。
