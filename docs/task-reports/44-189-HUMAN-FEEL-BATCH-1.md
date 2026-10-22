# 44-189 NPC 人感第一批 · 进行中

## 已上线

- 消息等待期间显示“{name}正在输入”气泡（截图 `44-183-typing-indicator.png`）。
- NPC prompt v53：日常回复尽量拆成 1–3 条短 statements，允许半句、补充、追问；正式说明可单条。
- send/receipt 仍为整轮成功或失败，单轮多条共用同一事件。

## 真实验证

新域名 `parallel-world-eosin.vercel.app`，世界 `f001350a-2b9c-4f81-a526-e9f26a4cc69e`，Grok 4.7：

```text
玩家：那你先忙吧
NPC：嗯，知道了。谢谢你理解。
NPC：等我这边有点什么，我会第一时间告诉你。
```

- world version 142；
- send 200 committed；
- 两条连续 assistant 气泡。

## 缺口

- 需要 20 回合抽样验证“≥50% 为 2 条以上”；
- 表情包（sticker）、撤回、分层记忆尚未实现；
- 旧世界仍含测试历史；不能据此宣称人感整体完成。
