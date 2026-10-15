# 44-84 · 真手机首次进入及既有机会承接

Owner codex-root-ma-arch44-i；唯一公共源码、契约、集成与发布负责人。依44-82只读调用图，在原opening GET与原advance接线；没有独立开场模型、队列或另一套导演。源9ea9c6ed、活动回执修正ff45513e、导演原结果租约修正7eaca82c。

## 实际变化

原手机遇runtime=agents仅跳过旧开场，随后仍等75秒。现在真实活动回执确认未暂停后，原opening读取可返回严格的ready/quiet/deferred/pending与不透明去重key。浏览状态下，明确admitted且未消费的genesis可立即走原advance；同一已提交机会剩余NPC请求和仍有效的原raw也可承接，不必每人再等75秒。

probe只SELECT，按world→clock短share锁读取；不初始化clock、不adopt、不写cursor/receipt/attempt，不调用模型。只用原bootstrap权威，**不在5秒检查里重读全文或生成新的时间资格**。普通人物责任及时间资格仍走75秒常规调度。原稿正文、节点/人物列表、genesis/全局审计都不进入公开摘要。

实际派发和probe复用同一eligibleEpisodeDispatches，原v2业务command算法不变。paid/unknown/invalid不改名重买；阻断按本人而非全世界，另一人物仍有独立请求。response_hash也算已付费。某pending请求已出现committed但没有消费回执时明确失败，不能吞为安静或补造结果。probe只提示，真正发送与提交仍由原runner/内核复核来源、权限、版本、活动与注意力。

真实Phone使用原advance，保留automatic=false的后台试演边界。它按后台opaque key作本地transport抑制；活动成功ack后首次激活、明确继续、conversation→browse生成本地entryKey，心跳不生成。该本地key不发服务端，不是模型command或付款凭证。进入深聊、离开、等待、发送和刷新时原保护保留，跨tab的实际focus可使probe deferred。5秒廉价节流保留，不再强制等75秒；quiet/没有气泡不自动重买，原結果恢复仍保持原身份。

## 修正与验收过程

C86独立新68纯测试与原契约3项71通过，原v2身份字面向量、付费/unknown阻断、actor隔离、坏回执错误与公开摘要严格白名单。只读复核发现预读后暂停且未claim时本地key会等75秒；ff45513e按实际ack激活代次修正。不是通过清空服务器付费历史重试。

root受影响实际PG：作者原文35及episode advance11通过；原HTTP子进程10项中一项旧exact shape因新增continuation.deferred失败，原负面断言未放宽，只补新可选字段的准确预期；最终真实HTTP子进程10/10和父入口通过。D85独立数据库专项正在验证0写、实际bootstrap、连续两人、paid/unknown、暂停/raw及隔离。

D85实际短租约原返回、暂停、自然到期再继续，复现导演raw也被probe误标ready。7eaca82c补原lease_until资格；过期结果只读pending，不在读取中延长租约或丢弃原raw。最终数据库反例、check/build/格式/生产核验与READY后续实际追加。

本轮无新SQL，0真实模型、0生产测试存档、0图片、0人类存档变更，生产epoch2仍0。旧浏览器202已结束且不存在，未悄悄新建；新会话许可待用户回应，手机/PC行为验收未完成，不能凭纯测试或API200称完整体验通过。

root最终check **3100/3100**、build、集成类型、聚焦格式/diff通过；D85实际18/18（含租约红→绿与真实出版trial绑定），root集成后同专项18/18。前述作者35、episode11与实际HTTP子例10分别记录，不将重复执行相加。2026-10-15T20:14:12.922Z生产只读82/82校验和及保护数据一致，epoch2=0。代码发布READY和公网核验接续中，84完整UI验收仍待；85/86只认可各自数据库/纯函数范围。

## 剩余边界

首入协调可能包含一次导演及分别的NPC调用，不承诺只花一次模型。原raw只有原版本/人物revision/租约等仍有效才可恢复；本项不扩大旧付费结果恢复权。普通未标记事件的逐人语义交接、实际事件发生与结束、观察和消费、旧档接管与旧路径退役及真实模型完整旅程继续在44主表。生产未启用新引擎，本批不代表玩家已经得到整套多Agent效果。
