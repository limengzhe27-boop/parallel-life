# LATENCY-SCHEMA-22：固定空变化省略验证

- 负责人：latency22-schema-tests；root 唯一集成。
- 基线：a8d8386b；分支 codex/latency22-schema-tests。
- 独占：tests/npc-agenda-review-wire.test.ts、tests/npc-model-protocol.test.ts、tests/npc-plan-wire.test.ts、本报告。
- 公共 npc-model-protocol.ts 复制 root WIP 仅用于本地测试，不包含在交付提交中。

## 修改

六处旧 schema 测试调整：当前请求 changes 第一层固定 null 字段现在不出现在 properties/required；仍有资格的 agendaReview、consideration、goals 继续检查其结构与可选对象范围。

新增一项当前 v16 回归：省略 consideration/goals/agendaReview 与显式 null 解码逐字段等价；不产生目标或事件选择；新 schema 保持 additionalProperties:false 且 required 不包含已删除键；伪造事件参与、把普通聊天冒充自主复盘、更新他人的不存在目标仍被原 parseAgentProposal 拒绝。

## 验证

对 root WIP 公共协议执行三个受影响文件：57/57 通过，无 skip/todo。命令：

```sh
node --experimental-strip-types --test tests/npc-agenda-review-wire.test.ts tests/npc-model-protocol.test.ts tests/npc-plan-wire.test.ts
```

仅测试与报告交付；0 真实模型、0 DB 写入、0 进程修改、0 部署。未重复全量 check/build，集成由 root 执行。测试不能代表真实模型延迟改善或本地产品体验已通过。
