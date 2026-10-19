# 44-161 · Director 已证实零发送预检拒绝不再吞掉事件唤醒

负责人 codex-director-zero-send161；2026-10-19。复用独立safe-diagnostics161工作树，分支codex/director-zero-send161，自root指定e724176a。源码冻结 **4a6d66f5**。root唯一公共集成/生产/模型/SQL/部署。

## 原因与修复

原runner在adapter.complete前已写request_sent。adapter发现输入不合法且明确responseOutcome=not_sent时，原runner持久保存服务器对象 `{kind:'model_preflight_rejection',schemaVersion:1}`，最终标invalid_output。实际未HTTP，但原bootstrap/narrative以sent_at/response_hash判断付费，事件评估被长期抑制；普通无cause frame也漏掉这个零发送证据。

新增director-preflight-evidence.ts仅在以下全部成立时识别：

- 原owner/world/epoch授权查询返回的status严格invalid_output；
- decision_id严格null；
- response必须对象且只有kind/schemaVersion两个字段，值精确匹配；
- response_hash等于原canonical序列化的SHA256。

模型返回的同名JSON字符串、真正model_request_rejection、额外字段、不同hash、有decision、unknown/request_sent/response_received/stale等全部不能获得这项资格。

按原取消前发送机制接三处：

1. bootstrap：严格认证sentinel不算付费终态，将其id加入原cancellations形成稳定后继cause；
2. authored wake：不将该帧加入paidReviewContexts，其id加入原preSendCancellations，仍需当前事件资格和来源；
3. ordinary frame：readUnsentFrameAttempts同owner/world/epoch/version/frameHash筛选后包含此类id。

旧attempt/raw/hash/status完全不改。不重解原模型失败，不恢复旧invalid为成功，不给unknown重新购买权限；新执行仍原调度、claim、预检、权限与内核链路。模型预检预算问题由另一Agent处理，本包只修已证实零发送的资格消耗。

## 验证

- 纯helper2/2，含对象键顺序、sent marker非HTTP证据、各终态/hash/decision/字符串伪造反例；函数不改输入。
- 原真实PostgreSQL55667，追加3条原semantic-wake旅程，聚焦3子+父4/4通过：
  - bootstrap预检拒绝→稳定新cause→原调度恰好一次评估→原拒绝行全量不变；
  - authored预检拒绝→资格不被消费→稳定后继→恰好一次评估；真正模型字符串拒绝继续抑制，unknown原尝试不变且0新增调用；
  - 无cause ordinary帧原readUnsent只返回本帧/本world认证ID。
- 这里模型为受控adapter；未调用商业模型，不当作真实叙事验收。
- tsc0、架构边界666、Prettier/diffcheck通过。
- 首轮运行原semantic全文件有3个旧attention断言失败，另一个新增夹具cursor初始化缺失已修。随后用精确e724原三个source短跑那3个旧例，完全同失败：ordinary focus评估、deep conversation deferral、pending response focus。原断言未改，不把整套称全绿。root正在统一focusgate，这些属于其集成门禁。
- 无SQL迁移、无生产读写、无模型、无全量check/build/部署。测试fixture均原after暂停，专属PG已发正常fast shutdown；最终端口复核另记。

## 文件归属

NEW helper、三原仓储仅指定方法、pure测试、原semantic测试仅追加三子例。director-runtime其他方法保持e724原样；root未提交focusgate可方法级合并。统一上线需root完成check/build/必要PG、实际零发送证据下原调度恢复及真实聊天/主动推进验收。
