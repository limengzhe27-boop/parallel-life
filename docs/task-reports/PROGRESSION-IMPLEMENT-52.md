# PROGRESSION-IMPLEMENT-52：导演任务可演与计划驱动主动消息

2026-11-05；实现人 `astra-progression-implement52-20261105`；基线 `3ad5048e`，接续 root 未提交的 EVENT-STAGE-CONTINUITY-51 工作树。

## 1. 本轮目标

把“人物收到导演任务后只回一句话”改成可继续推进的链路：

1. 导演任务写清当前情况、当前第一步、压力/代价和拒绝后的下一拍；
2. 人物接受任务但没给下一步时，生成一个持久计划，而不是只留下“等待责任”；
3. 计划进入现有计划复查调度；到期/复查时要求形成具体下一步，不能只发消息；
4. 保留人物拒绝/调整权，不强制台词；拒绝必须由导演安排下一拍，不能把同一任务无依据重派。

## 2. 实现内容

### 2.1 接受任务自动形成持久计划

`npc-model-protocol.ts` 的 `bindNpcConsideration`：

- `engage` 且没有任何属于该任务的 plan/action/responsibility 时：
  - 若人物提出了真实问题，仍建立 `waitingOn:'player'` 责任；
  - 若没有真实问题，建立 `id = requestId + ':plan'` 的 active 计划；
  - 计划只引用当前输入和认证的 `episode-intent:` 来源，不发明目标、动作、期限或玩家同意。
- 计划没有 nextAction/triggers，进入现有 `planReconsiderations` 的“无行动持久计划”复查路径。
- 不新增数据库表/列；计划仍在人物状态 JSON 中，历史快照保持可读。

### 2.2 计划复查明确“消息不算推进”

`agent-schedule-collectors.ts`：

- 无行动计划的复查候选增加 wake cue：必须形成具体计划/执行步骤或真实等待；只发一条消息不算推进；没有依据就明确暂缓或结束。
- 复查理由从“可以主动说明、等待、调整或结束”改为“必须形成具体下一步、真实等待或明确结束”。

### 2.3 导演任务质量约束

`director-agent-model.ts` 提示：

- `description` 必须写清“现在发生什么、为什么现在、不处理会怎样”；
- `playerImpact` 必须写“人物拒绝/不处理时的下一拍”；
- `topic` 是当前具体事项/变化，不能只写“关心/询问近况”；
- `proposedInteraction` 是现在可执行的第一步；
- 泛化关心不能当独立剧情事件填预算；没有合格事件时 quiet，或推进已有事件。

这不是新增 schema 字段，避免改历史 wire 协议；质量仍由模型遵循和后续验收约束。

### 2.4 人物提示与任务解释

- `npc-agent-model.ts`：接受导演/作者任务后必须形成自己的下一步；一条消息不是承接完成，不能把“已回应”当“已推进”。
- `actor-opportunity-context.ts`：任务解释明确“可拒绝/调整，但不能当没发生；接受后要记录具体下一步”。

## 3. 验证

- 聚焦单测：`npc-model-protocol`、`npc-agent-model`、`agent-schedule-collectors`、`agent-state-context`、`director-deliberation-window`、`npc-scene-expression44` 共 **180/180** 通过。
- 真实 PostgreSQL：`tests/integration/player-episode-manifest.test.ts` **12/12** 通过，含：
  - 接受任务无下一步生成 durable plan；
  - 计划进入 scheduler review，wake cue 含“只发一条消息不算推进”；
  - 同一 HTTP 请求不重复购买/重复计划；
  - 已有 actionless 计划复查路径仍通过。
- 全量 `npm run check`：**4260/4260** 通过（boundaries/typecheck/unit）。
- `npm run build`：通过。

本轮没有新增真实模型调用；没有改原用户存档、付费回执、权限或数据库结构。

## 4. 仍未验证

- 真实模型在新的导演提示下是否稳定写出“当前第一步”，而不是继续泛化关心；需要一次有界真实原档验收。
- 自动计划生成后，下一次计划复查是否实际产出动作/计划，而不是又一条消息；本轮只验证了 scheduler/commit 机制和提示，未用真实模型跑新行为。
- 导演拒绝后的下一拍仍主要靠提示，不是强 schema；若真实输出仍重复，应把“当前步骤/拒绝后果”升级为显式协议字段并处理历史版本。
- 本地 3218/worker 切换与页面验收见下节；不以 health 200 代替剧情验收。

## 5. 合并与本地运行

- 实现提交：`f3498dc8`（`codex/progression52`）。
- 合入 main：`35e11829`（`--no-ff`）。
- 本地构建：`.local/build-progression52`，`BUILD_ID=hrlE4s7Wjgcezpjdkf0Dg`；关键源码与 main 逐文件 SHA 一致。
- 3218：PID `22052`，`/api/health` 200；旧 `build-stage51` web 已停止（其中一个已释放端口但 TERM 后仍存活的进程，核实无监听后 KILL，无数据写入）。
- 队列 worker：PID `22094`，health ready，`tasksRun=0`。
- 主动 worker：PID `22113`，health ready；首 tick 遇到已有 `advance-lease-busy`（lease 至 03:18:22Z），尚未产生新模型调用/新消息。
- 未启动 3219、未部署 Vercel；原用户存档、付费回执、迁移均未改。
- 页面只验证了 `/` 与 `/api/health` 200；完整手机 UI/通知/键盘未做浏览器目视。health 200 不等于剧情验收。
