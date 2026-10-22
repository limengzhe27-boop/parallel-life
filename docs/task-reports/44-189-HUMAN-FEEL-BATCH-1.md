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

## 20 回合 burst 抽样（2026-10-22）

新域名、Grok 4.7、同一角色、20 条不同日常输入：

```text
samples: 20
successful: 20
multi-bubble (>=2): 18
ratio: 90%
```

明细：1 条 ×2，2 条 ×11，3 条 ×7；20 次发送全部 200 committed。  
这满足“至少一半回合 2 条以上”的第一批验收线，但仍需检查半句/废话比例，并避免测试世界版本继续膨胀。
