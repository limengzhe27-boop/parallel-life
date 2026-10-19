# 44-165 UNKNOWN 隔离聚焦验收

状态：待 root 集成。基线 145b2ab3；独立工作树 unknown-isolation165。仅提交既有 PostgreSQL 旅程测试和本报告，root 的 npc-agent-advance-services.ts 临时副本只用于验证，不提交。

## 证据

在原 `independent-opening-observation.test.ts` 的真实发布/实例化、开场信息确认、双 NPC 原始观察与共享责任混合候选链中：

1. Director reserved 时，NPC 与新 Director 模型调用均为 0。
2. 原 Director 转 request_sent，仍是 NPC 与新 Director 调用均为 0，保护在途读取帧。
3. 同一 Director 原仓储转 unknown_after_send，确认 response 为 NULL。
4. 第一个 NPC 确定性零发送失败后，第二个 NPC 仍正常提交；下一批第一个 NPC 接续。
5. 两个 NPC 各 commit 一次并各 ACK 本人的消息来源；没有重买 Director。
6. Director unknown 记录前后逐字段完全相同，不清除、不覆盖、不重发；原零发送 NPC 记录也保持不变。

聚焦真实 PG：1/1 通过，2.77 秒。受控适配器，不是商业模型或真实浏览器主动体验验收。无生产修改、无新迁移。

## 审查建议

root 新 independentActorWork 应限定 private / threadId=actorId，除了现有 requiresCoordination=false 和仅 wake 资源，避免误把群聊/现场候选作为个人独立工作。原 eligibility、blocker、source 和 kernel 仍不可绕过。

`response_received` 延迟提交保护已有 `director-semantic-wake.test.ts` 的 “v4 paid filtered bootstrap resumes its exact saved scope after attention deferral without another director call” 完整旅程可复用，本次不复制第二套断言。
