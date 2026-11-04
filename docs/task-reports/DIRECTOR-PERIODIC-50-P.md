# DIRECTOR-PERIODIC-50-P — 周期作者窗口领域回归

负责人：proactive43。集成人：root。专属范围仅两份既有领域测试和本报告。

## 修改

- `director-deliberation-window.test.ts`：周期 cause 保留认证 qualifications 的公平顺序，最多两项；语义唤醒仍按原字典序。占用、blocked、nodeHash 或 qualificationKey 不匹配排除。native/opening_context 空窗口；没有 cause 的历史快照不升级。
- `director-review.test.ts`：新全局周期五分钟的到期前一毫秒/准确边界；已持久化旧一小时边界原样保留；known failure 的十五秒恢复及 unknown 原恢复分类保留。

## 证据与边界

使用旧实现先运行出现预期红灯：周期排序仍 a/b（目标 c/a），默认时间仍一小时（目标五分钟）。旧快照、占用/来源和恢复保护断言未删除。

本任务只验证领域窗口选择和时间计算，不证明仓储周期授权、unknown 防重买、原档导演选择或真实主动消息。公共源码、原档、模型、运行进程均不改；root 负责仓储真实 PG 和最终运行验收。

## 真实 PostgreSQL 接续

复用 `director-frame-lifecycle.test.ts` 原发布/创世/runner 夹具，仅增加一个周期旅程和三个无前置合成作者节点；不复制新测试框架。

- bootstrap defer → 原语义资格评估另外两个节点，全部未呈现。
- 仅测试库把最后 attempt 的更新时间移到六分钟前，原 reader 产生 `periodic_review`，重复读取相同。
- 原 `runDirectorAgent` 经 claim / request_sent / saveResponse / commit 成功，证明自己的 allowAttemptId 重验没有使资格消失。
- 每个原 command 重复调用返回原 decision，受控 model 调用计数不增加；旧 response / sent_at / input_hash 不变。
- commit 后无立即新周期；没有共享事件或完成结果。
- 再到下一周期，上一窗口未评估节点排在前面。

最初暴露真实失败：以 `snapshot.worldVersion` 衡量最近评估，三次 quiet 都在 v0，公平排序始终选择原前两项。root 修复为按既有 `created_at,id` 顺序计算认证评估先后，仅内存读投影；保留世界版本用于证据边界。修复后本套 **5/5 通过**（新周期旅程+三项原 unknown 保护+父项），隔离 PostgreSQL 55743，约5.7秒。此前 typecheck 通过。公共实现只临时复制验证，不包含在本提交。

0 真实模型、0 原档写入、0 运行服务更新。本测试不证明真实导演选择质量或用户收到主动消息；这些由 root 原档验收。

## actorTasks schema 与 decoder 一致性

复用 `director-unified-actor-tasks15.test.ts`，新增一项循环覆盖单参与者/多参与者作者事件：单参与者必须是非空 task 引用，其余 cast 强制 null；多参与者 anyOf 各分支保持完整 required/禁止额外字段并要求至少一个非空 task。defer 仍无需任务；全 null consider 仍由原 decoder 拒绝；合法 task 可解析；未绑定人物任务被拒绝。

临时复制 root 公共 protocol 修复后本套 **6/6 通过**。恢复旧公共实现，新增测试明确失败在单参与者 $ref 缺失（旧实现仍允许 null），原五项通过。typecheck 通过。没有增加 validator 依赖、协议版本、字段或模型调用，未重复 PG。公共源码已恢复，不在提交内。
