# 44-161-CHAT-RECOVERY-CLIENT

- Agent: codex-chat-recovery-client161；唯一集成人 root。
- 基线：e724176a；独立工作树 chat-recovery-client161。
- 状态：待集成验收；不宣称已部署。

## 改动

1. `MessageReceiptClient.lookup` 协商 `X-Message-Recovery: 1`，接受服务端精确恢复状态。新增 `recover(worldId, originalRequest)`，仅调用 `/messages/recover`，保留 CSRF、原命令校验和响应 world/actor/command 身份核验；不调用发送或重试端点。
2. `reconcileRestoredSendReceipts` 新增可选第 5 参数 recover（签名同 lookup）。只有身份一致的 `unconfirmed/response_received` 才调用一次；pending、unknown、旧版无状态只查询。恢复失败、不确定或来源不一致，保留原消息和命令待查，不重发，不产生新命令。
3. BUSY 视为 unknown，避免误报确定失败后生成重复发送。

## 验证

- 三组聚焦测试共 23 项通过，覆盖原命令/version 不变、协商头、精确端点、身份不符、pending/unknown 不恢复、恢复中断与可选兼容。
- TypeScript 类型检查通过；diff 空白检查通过。
- 不重复数据库验收；0 模型/0 生产数据写入/0 部署。

## 接续

root 在 world-phone-app 接第五参数 `(id,input) => receiptClient.recover(id,input)`；新失败消息加入待查队列并有界查询由 root 负责。服务端恢复只重放已有受保护响应，不能通过此客户端入口重新付费或重发。最终集成、完整门禁与部署由 root 执行。
