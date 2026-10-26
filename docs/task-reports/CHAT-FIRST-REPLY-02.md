# CHAT-FIRST-REPLY-02 · 私聊热路径往返精简

负责人 chat-hotpath-20261026（/root/chat_hotpath），独立tree chat-hotpath-20261026，基线main606927b4。parent授权范围：npc-agent-services、npc-stream-segment-repository、chat-context-read-repository及专属测试/报告，后追加原chat-context-bounded-read测试计数断言。0商业模型、0原档写、0端口3218/3219操作；root统一main集成。

## 第一批：有界上下文投影合并

既有readChatContextWorld已持world FOR SHARE并确定actor/世界版本；消息、事实、日程查询彼此无依赖，合成一次SELECT的三个有界JSON数组。保留owner、event版本、人物知情、最新窗口+1、精确旧引用、关联证据、排序、回退和邀请响应后置回放。不在同PoolClient并行，不新增业务字段/缓存，不裁人物记忆。

独立真实PG18.4端口55652：原chat-context-bounded-read完整用例修改前后均通过。短档和长档业务SQL从5→3（底座BEGIN/owner/COMMIT不计此计数）。原长档返回336行、76098字节、203消息、83事实、50日程；改后相同；短档4行2196字节相同。多轮身份/可见范围/旧引用/活动责任/邀请回放/回退断言全通过。在原测试加入每次最多3条业务查询的性能回归上限。

本地PG长档94.21→97.73ms、短档8.12→8.06ms是单次测量，不能宣称CPU更快或用户首句已达标；本批收益是少2次远程往返。当前其余stream提交读合并仍在审计，优先保留所有判定早退/锁顺序/活动freshness，不能证明就不提前读取。
