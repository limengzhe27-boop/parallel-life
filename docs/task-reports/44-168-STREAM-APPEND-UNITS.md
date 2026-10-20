# 44-168 第七批：不可变流式执行单元

负责人：root/append_units；集成人：root-simplify168。基线 8c4cb3d8，独立工作树 `.local/worktrees/stream-append168` / `codex/stream-append168`。公共 HTTP/回执/客户端由 root 接线；小迪的专属测试未修改。

## 实现

- 原 paid attempt/input/model snapshot 基线不变。新流式文字、早期媒体使用确定性 child command/event；最终结算仍用原 parent command。
- `data.stream={attemptId,parentCommandId,unit,inputMessageId,replyMessageId?}` 仅内核创建。SQL102认证当前 attempt/input/actor、唯一 unit、用户输入锚点与媒体文字来源；新 unit event 与已提交 segment 来源不可改写。
- 每个文字单元只追加本段 effects，用户输入只在首次单元投影。最终状态验证完整模型输出，但只追加尚未保存的 effects，不重复历史文字/媒体请求。
- 同 attempt 已提交单元可作为合法后继；其他人物独立纯交流仍通过原有保守证明。人物版本、新输入、权限、来源、租约保护保留。并非放开任意共享世界变化。
- 早期媒体单元按真实 event/sourceVersion 保存执行结果。最终复用已认证结果、不重新执行生图、不回写 worker 已更新的媒体状态。独立媒体通过真实 `replyMessageId` 关联先前文字，原图片独立气泡继续投影。
- 中断封存追加独立 final event，保留真实已存文字、已执行媒体与 continuation；不能凭封存生成新的计划或动作。原请求可查询部分完成；UI展示由 root 负责。
- 同人物新输入允许跨过“仅结算已可见 prefix”的 superseded 事件；仍拒绝新消息、新行动或新决定被当作无关变化。
- episode 呈现证明、议程来源、媒体结果读取按同 attempt 的实际单元聚合。own-agenda 修复了剩余 expected+1 假设；awareness 的计划/决定比较只认 final 状态，媒体真实结果仍可观察。

## 验证

独立本地 PostgreSQL 数据库 `parallel_life_append168_test`，受控模型，无真实模型、生产写或部署。

增强原 `chat-latency-stage2.test.ts` 的同一连续旅程（开发时独立副本，冻结时并回原测试，不保留重复套件）：

- 两条文字分别追加，最终结算；用户输入恰一次。
- A 首段前 B 提交；A 首段后 B 提交、A 后续段及 final 成功；首段原始 event 内容不变。
- 媒体在模型尾部之前进入队列；正常完成/尾部中断均保留一个媒体请求、一个 outbox、一个真实结果。
- 媒体 ready 的原投影恰一个图片气泡；后续上下文仍认证旧媒体 unit 结果，不冒充真实图片生成。
- 同人物新输入打断旧流，旧后段不覆盖新回复。
- 原命令重放不增加模型调用或重复消息/媒体。
- 全部 world_events 重放与恢复消息完全一致。
- 最终自主议程证据读取成功；新 unit event / segment 来源篡改被 SQL 拒绝。

独立 PG 连续旅程 1/1 通过（约 2.1 秒，不是产品时延）；domain 聚焦 29/29；boundaries 696；typecheck 0 errors。root 负责集成后的 check/build、真实模型、公网和部署。

## 兼容与剩余

- 已存无 stream 元数据的旧 prefix 仍由原完整 response 恢复路径结算；不应重开旧 attempt 的模型流，不支持给旧 prefix 混入新式 segment。
- 新已提交单元不可变，回滚旧业务前应排空新式运行中的 attempt；保留迁移与历史，不撤销已执行结果。
- 群聊/现场 0074 迁移、共享条件变化后的细粒度行动重验不属于本次完成范围，仍保持严格失败保护。
- 口头同意未记录 episode choice、长期自主内容质量仍未完成，不以这批保存改造宣称事件演绎完整。
- 真实模型/图片与生产验收未由子 Agent 执行；没有把本地受控适配器当作真实体验成功。

### 集成前补充：独立消息的记忆来源

根集成检查发现首段继续跳过记忆写入，而 final 已不重放旧消息，导致原事件记忆遗漏。已在 final/seal 的原事务内读取同 attempt、同 parent command 且具有成功 command 的既存 unit，按每个不可变真实 event 调用原 `storeTurnMemories`。不把来源改成 final，不增加首条文字路径开销；来源去重复用原 memory_source_refs。增强原 stage2 断言：所有 statement unit（含中断封存）均存在真实事件记忆来源。独立本地 PostgreSQL 旅程重新通过 1/1；没有模型调用或生产改动。
