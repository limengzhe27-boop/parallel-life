# 44-185 Grok 五维人格验收

## 真实样例

输入：

```text
玩家：你现在在干嘛？
```

李之之回复：

```text
今天下班了，我正准备换鞋补个妆，等会儿可能还会去酒吧坐一坐。你想过来吗？
```

这条消息具备：

- lifeContext：下班、补妆、酒吧；
- relationships：主动邀请玩家；
- behavior：短句、手机聊天节奏；
- 没有客服式解释或后台规则汇报。

## 当前实现

- NPC prompt 引用 actor.persona 五维；
- 五维未合并成通用人格模板；
- 尝试把五维拆成独立 JSON 字段时，NPC 上下文返回 INVALID_STATE，已回滚；
- 因此当前仍以原始 persona 传递五维，未完成逐维字段级审计。

## 未完成

- 逐维对照（lifeContext/traits/drives/behavior/relationships）；
- 真实 1–3 条 burst；
- 重复邀请/汇报感的持续清理；
- 最新生产上的完整截图验收。
