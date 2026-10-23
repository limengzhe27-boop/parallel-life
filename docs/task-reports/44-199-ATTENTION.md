# 44-199-ATTENTION：注意力与执行分离

状态：代码冻结待主 Agent 集成；基线 51be078f；独立工作树 `.local/worktrees/attention199`，分支 `codex/attention199`。无生产操作、真实模型调用或部署。

## 实际断点及修改

已验证的 A 私聊焦点在当前基线其实已经允许 B 执行，不能再次宣称修复这个已解决分支。真正剩下的门槛是 `conversationWithoutTarget`：缺失/已撤销的页面焦点被当作全局停止执行的依据，导致 episode 请求、已生成结果保存及 phone entry hint 被挡住。

- `agent-episode-attention.ts` 删除两个注意力许可函数及提交时复杂 focus 查询。仍按 world→clock 的短锁顺序核验准确版本和时钟；真实暂停保持 `EPISODE_DELIVERY_DEFERRED`。
- `agent-episode-dispatch-eligibility.ts` 删除 attention 参数和全局 veto。原 actor in-flight/unknown、exact request paid terminal、稳定工作 ID、zero-send 接续保持不变。
- `npc-agent-episode-dispatch.ts` 删除仅服务上述门槛的 attention 查询及参数。人物输入/episode 请求的原权威验证不变。
- `agent-phone-entry-probe.ts` 删除 attention 查询及 unresolved focus early return。保留真实进入的活动确认、暂停、每人物 blocked 集合、已付费结果和导演去重。
- `notification-projection.ts` 删除 `isGenericProactiveLine` 引用及锁屏文字主观过滤。仍只读原持久消息投影，历史消息/已读/重复 ID 过滤与每目标展示上限、顺序保持原样。情绪或简短关心不会仅因文案被吞。
- `agent-delivery-activity.ts` 无需修改：其当前实现本来就只检查 owner/world/clock，不检查用户正在看哪位人物。

没有新增字段、表、评分或审批。删除两个无独立作用的函数与 attention 参数，避免新的兼容分支。

## 实际主动模型输入审计

原 `npc-agent-advance-services.ts` 自主候选经 accepted receipt → `readPrivateAgentSnapshot` → `runNpcAgent` → `npc-agent-model`。人物事件请求经 `npc-agent-episode-dispatch.ts` 使用相同 snapshot 入口。

`agent-snapshot-repository.ts`：
- actorContext 读取本人 persona/relationship、近对话、可见事实与约定；
- loadActorMemories + forgotten sources 控制本人记忆及已忘记来源，旧持续状态引用另行精确读取；
- actorSnapshotPersona 合并本人 persona、relationship 与获准作者模块；
- authorizedAgentState 提供可见 viewState，目标/计划/责任保持结构化；
- observations 带事实/看法/说话人的区分，不能把他人私聊塞入。

`npc-agent-model.ts` 实际 gateway payload 含 actor.persona/boundaries、state（viewState优先）、planNextSteps、selfAgendaContext、observations、recentSelfMessages。现有受控模型捕获测试验证真实发给 adapter 的 payload，不只是检查 DB 是否有记录。情绪用已有 persona、记忆/观察表达，无新 mood 状态。

公共内核/stream 的提交入口 `requireActiveAgentDeliveryInTransaction` 没有 focus 门槛，现有 input authority、source、actor revision、episode 权威与实际结果校验保持原样。普通输入另一人物不会因为页面焦点由这里拒收；调度批次及全局 sending 的其他限制由 root/PHONE 子任务处理。

## 必要验证

- 注意力提交保护、episode dispatch、manifest、消息投影、锁屏：85/85 通过。
- 现有 npc-agent-model payload 捕获：45/45 通过（涵盖自主 own motivation、不可见状态裁剪、最近消息及人格/源引用协议）。
- boundaries：719 files 通过。
- typecheck：通过，0 errors。

注意力提交测试使用可控 SQL 接口，断言不再加载 focus 且 world/clock 锁、版本及暂停仍有效；不是生产/真实 PG 演绎证明。无 SQL/权限规则修改。root 负责集成真实数据库连续旅程、手机/PC通知不抢焦点、既有渣男体验真实模型与公网部署验收。本子包未声称已经上线或人物持续来信已经实测成功。

## 续接：自主消息挤掉玩家原话（2026-10-23）

在 root 授权下对当前正式存档一次已保存 snapshot 做受控模型输入捕获（0付费）：最近6条本人消息确实进入 payload，persona 没有裁剪、observations 没有省略，但12条近话全部是 NPC 自己的来信。`actorContext` 最近12条按消息取样，历史检索以本轮机器 wake input 做关键词匹配，故旧中文玩家原话可能一直无法回来。不是“模型不知道自己说过什么”，而是缺少玩家实际说法来校正持续的自言自语。

最小修复仅 `actor-context.ts` 与对应测试：从既有本人授权、未遗忘的消息集合找到最近玩家原话，若近话窗口未包含，在其他材料装入前完整保留；必要时减少较旧NPC近话，保留最新消息。总预算与既有11500历史消息预算不变，历史语义检索不重复加入同一条来源。若玩家旧话本身超预算，回退既有最新消息，不截断原文、不扩大协议。

原8项+新增4项聚焦测试12/12通过，覆盖20条NPC连续来信、他人私聊/遗忘来源隔离、转义长文预算与去重、超预算旧话不覆盖最新消息。实际生产自然表达改善仍由root真实体验验收；本文不复制用户虚构存档整包。
续接最终检查：typecheck 0 errors、boundaries 719通过；初次findLast因项目目标lib不支持，改用现有语言目标可用的reverse/find后重跑通过，没有改tsconfig。未跑全量check/build，交root统一集成门禁，未上线。

## 紧急续接：0110 legacy offer 空读取真实 PG 验证

只新增 `tests/integration/publication-offer-empty199.test.ts`；0110 SQL由root独占，本树仅复制其当前文件供本地migrate读取，不包含在本提交。独立本地PostgreSQL 18.4/55549，未访问生产。

测试借用旧 publication-story-followups 的真实发布/实例化/邀约事件夹具创建新合成世界，将0049原函数体以测试专用函数名冻结，再与0110当前函数逐字段比较，结束删除测试函数。不是仅检查SQL文本或伪造返回值。

- 5/5通过（父项+4旅程）：无nodes；claimed但无offer；failed且无邀约；合法原始offer；真实later invitation触发followup。
- 原始offer/followup完整JSON与0049相等；sceneEligible、editorialIntent、actorIds、真实invitationId/sourceEventId均保持。
- 空集仍首先执行授权：app跨owner参数/身份、worker无合法lease、非运行角色均42501，与0049一致。未放松授权、来源或scene条件。
- 本地一次对照空读取旧34.3/28.6/25.1ms，新3.35/3.29/2.42ms；有offer旧23.45/26.68ms，新23.78/25.29ms。只报告本地样本，不外推线上并发SLA。
- 原有publication-story-followups全文件19项中16pass、2个子项fail及父项fail：`full transaction rollback...`、`multiple qualifying actual invitations...`。把本地当前函数临时恢复0049原体后重跑，完全相同两项失败及16pass；之后恢复0110。故不是本迁移新增回归，未修改旧测试或削弱断言。
- typecheck通过。无真实模型、生产写入、部署；root负责迁移集成及上线。
