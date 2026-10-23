# 44-200-STICKER-PERSIST

独立codex/sticker-persist200，基线7d7228c0；复制root core-stickers200当前src/db用于验收，但不提交这些借用源码。独占新增tests/integration/sticker-persist200.test.ts、本报告。PG55672独立数据目录。

## 真实PG + 受控模型 2/2

1. 原npcAgentServices非流式输入[[sticker:zan]]：用户原文持久保存一次；模型实际payload带欣赏/称赞语义；NPC普通长句、文字+zan、纯jiayou、非法ID+合法短句共4条完整保存。没有用末句替换其他对白。原command重放模型调用保持1，worlds.get重新读取消息完全相同。
2. 原流式入口：相同4条依次返回并final提交，最终恰有4条不同消息ID、1用户输入、纯表情和末句各1条。重复HTTP保持模型调用1，重读内容不变。

不新增字段/表/迁移。未覆盖手机页面、网络未知恢复、真实模型选择质量、全部60候选发布；现有恢复测试由root统一，不用此2条冒充完整验收。

只运行2条必要PG旅程与typecheck；全量check/build由root统一。0生产写、0付费模型、0部署。

类型检查发现借用root新runAgent签名与基线旧img-chat-flow夹具两处六参调用不匹配（110/438行）；未改越界旧测试。新测试自身可选下标已修正为确定存在断言。root需在完整集成树运行typecheck。
