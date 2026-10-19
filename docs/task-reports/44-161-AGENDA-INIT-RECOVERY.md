# 44-161-AGENDA-INIT-RECOVERY

待集成；独立 agenda-init161，自 b1d22790。root 唯一集成/部署负责人。

## 断点与修复

初始化原 grant 固定绑定 genesis/actor/definition，零发送取消仅允许原世界版本恢复。其他合法变更一旦推进世界版本，即使人物从未发送过模型请求，初始化也永久消失；没有成功锚点时 own-agenda review 不能接管。

现在仅对完整原 receipt、输入哈希、command、人物、频道、定义、genesis 与零发送证据认证的历史，派生稳定续接 transport candidate。派生以同一初始 family、上次 command、新世界版本为依据；多次读取不会产生新身份。同版本仍恢复原 attempt，旧取消记录保持不动。人物版本改变不续接；实际私聊成功锚点存在不重新初始化；paid/raw/unknown 不可跨越。

无新协议、SQL、模型入口或固定台词。每次 claim/send 继续通过原资格认证与内核。

## 验证

真实本地 PostgreSQL 55587，仅合成数据与模型适配器：初始化测试文件 11 子项中 10 通过（包括新增同CAS/跨CAS旅程、未知与付费失败不重买）。跨CAS旅程使用真实 saveNote 事务推进世界，验证新初始化随后通过原 advance/attempt/kernel 提交，旧取消仍保留，quiet 后不重新初始化。

剩余旧 waiting-plan 子项报 UNKNOWN_SOURCE。临时切回 b1d22790 原文件单项复现完全相同失败，随后恢复本次源码；不是本改动引入。未篡改夹具或公共 parser，已交 root 处理。TypeScript 与边界检查通过。0真实模型/生产写入。

## 后续风险

确定性 NPC_AGENT_SNAPSHOT_LIMIT/INVALID_SNAPSHOT 零发送失败缺少按输入指纹的退避，可能重复取消而不执行，需取得实际安全诊断再做预算/上下文修复，不能借此重买 paid/unknown。

合法 quiet 提交仍有后续 own-agenda 锚点与退避窗口。defer 若只有文本 missingConditions、无结构化条件，条件调度不应猜造期限；自主议程可以重新考虑，但事件参加权仍需原事件协议，不能把本人议程当作重发相同事件的权限。
