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

## 共享 schema 引用收口

root 将 actorTasks 提取到共享 `$defs`，减少多角色 anyOf 重复体积。本子任务仅将两份原测试的四处 shape 读取改成 `$ref` 解引用；非空、完整分区、非法人物及 24,000 字符上限断言均保留。临时最新 protocol 下两套 **30/30 通过**，包括 6/12 人预算样例。未重复 PG，未修改公共实现或原档。

## 不相交周期 unknown 隔离旅程

原领域测试补同 world/epoch/source、非 native、版本不后退、旧两槽零候选、新节点合格且不重叠的边界。原 PG 周期用例参数化两条分支：真实 runner 产生无 raw unknown，真实短 lease 等待过期；live 保持阻塞，过期后剩余独立节点可领取提交，旧 command 重放拒绝且调用计数不增，sent/hash/snapshot 原样保留；旧结果晚到仍保存在 stale_discarded，不能重新获得执行权。另一分支在隔离前通过原 saveResponse 保存晚到 raw，确认无新周期资格。

边界观察：若独立 snapshot 读取后、claim 前旧 raw 晚到，原 claim 正确拒绝 `DIRECTOR_EVALUATION_CAUSE_CONFLICT`，不能用旧快照绕过重新出现的付费结果。测试最终成功旅程在独立提交后才保存旧晚到结果；没有修改 immutable lease 或删除 raw。

最新 root WIP 下领域+真实 PG **10/10 通过**，typecheck 通过；隔离55743，0真实模型、0原档、0主运行进程修改。测试只证明独立执行资格及旧付费请求保护，不证明模型必然发消息。

## 已收到 quiet 的原结果恢复

新增领域和既有 PG 旅程：无 opening authority 的 v15 省略机械 null 可解析，显式 null 保持兼容；有 authority 仍必须提供判断，缺 candidates 等业务字段不修补。完整零副作用 quiet 可使用原快照观察作审计来源，来源/cast/边界/选择保护不放宽。

隔离 PG 应用 root 0125 后，以真实原 runner 完成 bootstrap，再原 claim/send/saveResponse 保存缺机械 openingContext 的 quiet raw，标 invalid_output 模拟旧 decoder；原 world.saveNote 前进世界后，revalidateKnownHandoff 直接 committed。原 raw/input hash/sent_at 不变，proof opportunity_ids=[]，0 episode/request；重复恢复不新增 proof。live 未发送、unknown 无 raw、缺业务字段的已保存 invalid_output 均不冒充 quiet。没有恢复模型调用。

三套合计 **48/48 通过**；typecheck 通过（补齐测试观察的 knownByActorIds）。仅提交三份测试和本报告；0125 与公共源码临时复制验证后移除/恢复。0 原档写入、0 真实模型、0 主运行进程改动。
