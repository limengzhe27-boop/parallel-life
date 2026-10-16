# MA-ARCH-44 · 阶段九：有依据的时间资格唤醒

唯一集成人 codex-root-ma-arch44-i；源码 history-chat-media / codex/ma-arch44-integration。主目录 DEVELOPMENT.md 是唯一任务状态源。本批为44-66后端限定交付，整体架构重构仍未完成。

## 实际接线与归属

统一 npcAgentAdvanceServices → 原持久 Director runner / snapshot / attempt / kernel。新增 narrative-wake 只读仓储组合原显式 admission、当前绑定作者目录、资格、占用、业务焦点和历史调用；没有新建调度引擎或付费队列。DirectorEvaluationCause 增 authored_eligibility，发送前和提交时核对当前资格三元组及稳定原因。

条件满足只授权导演考虑，不等于事件发生、人物知情、玩家答应或目标完成。普通时间秒数、无关世界版本、资格集合减少不生成新身份。逐资格检查所有历史实际决策；原稿源/节点/资格相同且已实际考虑，或已付费无效/过期，不因轮询再买。普通全局协调已捕获的资格也不再额外买一次时间评估。

暂停、离开/租约过期、深聊焦点时延后新增时间机会；不消费资格，不全局封锁人物原有责任。原 pending/unknown 先走75恢复。恢复原因已经消失时只恢复，不顺手新增调用。零发送终态以实际原attempt引用改变重试身份；paid/unknown绝不进入取消重试集合。稳定资格排序与部署主机语言无关。

## 验收

D70独立真实PG17/17（原17专项含父项），root集成后相关真实PG **103/103，0 fail/skip**：真实发布/绑定/admission/快照/advance/保护调用/回执与恢复，并非仅调用纯helper。显式模型替身用于支付次数断言，0真实模型。

覆盖同V时间跨界只一次、跨秒与无关变更不重买、Y→X→Y全历史去重、普通global捕获、无admission不接管、深聊延后、unknown原身份、paid invalid/stale资格仍成立也不重买、窗口结束后的原结果恢复、pending深聊后零模型恢复、真实claim期间暂停后零发送恢复、实际多资格字节序稳定、占用排除。D只读审查未发现新增可复现问题。root源码与SQL仍唯一所有者。

首次联合命令遗漏各测试的专属端口变量，环境守卫拒绝两个组；另一个路径拼写不正确。未降低守卫或计入通过。修正命令后以上103/103全过。

全量 check **2936/2936**，build、format与diff检查通过。CI接入新语义唤醒数据库端口。2026-10-15T18:12:17.325Z生产只读核验81/81迁移及checksum不变，0081 fa16eb858ec5c5b18833fd57f18dc019e0e8c41f68a6652988967754b4c43dfb；保护原稿/副本/玩家world未变，production epoch2=0。本批无新SQL、无生产测试存档、无图片、无新浏览器会话。

## 未完成与接续

44-66实际手机首次进入仍待接入，不把后端资格闭环称为手机旅程完成。44-67具体事件的逐人物语义裁剪、44-68真实发生/结果/暂缓退出、44-53观察范围与消费回执、44-69普通wake/player/bootstrap暂停竞态与旧档接管/旧路径退役，仍是生产启用新引擎门槛。当前生产仍使用旧world epoch；完整真实模型连续旅程未验收，不宣称全架构完成。

部署READY与公网证据在实际发生后追加。

限定后端交付已上线：c52cf851c991242e81390b57eb75401230e1a6b8 / dpl_FiSqJVp9yjQ2Lq58JNEWVovpZJGi READY，精确SHA及Nu别名核实；公网health/workbench/published200、匿名publications/publisherworks401。0生产epoch2切换，完整手机旅程仍未验收。
