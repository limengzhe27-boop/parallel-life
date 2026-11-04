# DIRECTOR-PERIODIC-50-P — 周期作者窗口领域回归

负责人：proactive43。集成人：root。专属范围仅两份既有领域测试和本报告。

## 修改

- `director-deliberation-window.test.ts`：周期 cause 保留认证 qualifications 的公平顺序，最多两项；语义唤醒仍按原字典序。占用、blocked、nodeHash 或 qualificationKey 不匹配排除。native/opening_context 空窗口；没有 cause 的历史快照不升级。
- `director-review.test.ts`：新全局周期五分钟的到期前一毫秒/准确边界；已持久化旧一小时边界原样保留；known failure 的十五秒恢复及 unknown 原恢复分类保留。

## 证据与边界

使用旧实现先运行出现预期红灯：周期排序仍 a/b（目标 c/a），默认时间仍一小时（目标五分钟）。旧快照、占用/来源和恢复保护断言未删除。

本任务只验证领域窗口选择和时间计算，不证明仓储周期授权、unknown 防重买、原档导演选择或真实主动消息。公共源码、原档、模型、运行进程均不改；root 负责仓储真实 PG 和最终运行验收。
