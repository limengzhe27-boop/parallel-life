# 44-154-N7 本人自主议程活跃度的真实提交证据

状态：待 root 集成；负责人 codex-own-agenda-evidence154-n7。独立工作树 own-agenda-evidence154-n7 / codex/own-agenda-evidence154-n7，基线 2f1700dc。只改既有证据读取仓储、既有聚焦 PG 测试和本报告。

## 输出 API

`readOwnAgendaReviewEvidenceInTransaction` 原参数及既有字段保留，新增：

- `quietStreak: number`：连续、同 epoch/definition、同人物修订相接的真实 native 提交中，无实际对白、无执行结果/非消息效果，且目标/计划/责任/玩家决定/行动的实际 stateAfter 内容未变化的次数。不因事件类型是 `agent.state_committed` 就判 quiet。修订断档无法证明前后相同，保守归零；首次 revisionBefore=0 且上述状态为空时可认证初始 no-op。
- `lastPresentedRealAt: string | null`：经原 native 提交与实际消息投影认证的本人最新投递真实时间，不是客户已读回执、人物自称发送或故事时间。

private `turn.resolved` 与 `agent.state_committed` 均可成为原 own-agenda anchor。原 attempt、receipt、command、event、runtime stateAfter、身份/epoch/definition/修订/时间链逐项验证后才产生 anchor。普通消息单独存在不能成为 anchor；有说话事件但实际投影缺失会 fail closed。

## 通道与历史边界

- 私聊消息以原 event/message effect 的 ID、actor、内容、sourceEventId、sourceVersion 对实际 `world_messages` 投影认证，不向返回值加入内容或 raw。
- 合法 group/scene native 提交使用其真实原 command envelope/event 相等证明、receipt 和 runtime 链，不套用仅私聊的 receipt.commandId/command fingerprint 关系。群聊的原玩家 parent command 与 NPC attempt command 本就不同。
- group/scene 不被提升为 private anchor；其经认证的真实投递用于 `lastPresentedRealAt`，并终止“持续 quiet”的误判。实际原群聊 runner→kernel→projector 旅程已覆盖；scene 使用同原 projector 结构和实际 scene_items 投影条件，未重复搭建完整 scene 旅程。
- 所有 family、旧 policy、terminal paid evidence、其他 family/epoch 活跃 blocker、4096 上限、当前 definition 验证均保持。invalid/unknown 不提供新 anchor，unknown 仍原样阻断相应在途事项。
- 核心状态比较在只读 SQL 中对限定五组结构求内部 equality fingerprint，返回方不接触原聊天/模型 raw；该 MD5 只用于判断同一已认证状态内容是否变化，不充当授权凭据或替代原来源 hash。零 statements 的历史跳过消息投影扫描。

## 必要验证

独占本地 PostgreSQL 55588（开工前确认空闲），原聚焦旅程加反例 **12/12** 通过：

1. 初始真实 quiet anchor、owner/epoch/actor/definition 隔离。
2. 原 family 跨 policy/各种已付费终态保留。
3. reserved/request/raw/unknown 与其他 family 工作不被混淆。
4. envelope、跨角色、假借其他 command event 的拒绝。
5. 原玩家真实输入和人物实际私聊回复推进 anchor。
6. 0 条对白但真实产生 goal/blocked-plan 时 quietStreak=0。
7. 随后连续真实 no-op 提交 quietStreak=1、2。
8. invalid/unknown 不改变最后真实 anchor。
9. 原 native 群聊提交不封死读取、不冒充 private anchor，真实投递时间正确。
10. 只有伪造投影/自称无原提交时不提供 anchor/投递时间。
11. 原 speaking event 的实际消息投影缺失时拒绝；恢复投影后证据一致。

`tsc --noEmit` 无错误；格式、diff 和模块边界检查通过。0 模型、0 生产/SQL迁移/部署。全量 check/build、root 接口接线及公网验收归唯一集成人，未以测试数量声称人物已在生产持续自主运行。
