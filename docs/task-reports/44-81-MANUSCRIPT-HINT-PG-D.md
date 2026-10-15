# 44-81-MANUSCRIPT-HINT-PG-D

状态：待 root 集成验收；不宣称整项剧情重构完成或已部署。

Owner：codex-ma44-manuscript-hint81-d，session `/root/authored_eligibility_63`。独立工作树 `/Users/limengzhe/.codex/worktrees/author-eligibility63/人生剧本`，branch `codex/manuscript-hint81`。

基线 `f0d097abdf43af40e7458112e0b538db9addd6f9`；root 类型依赖 `232ac6d2` 在本树等价提交 `651e84b0`。测试冻结 **`4ed6e0aac2dae4d3b32dd00dd81809f785d3390c`**，仅新增 `tests/integration/actor-manuscript-hint.test.ts`。无需再次 cherry-pick 等价 source 依赖；root 仅取测试与报告提交。

## 实际证据

- 专属真实 PostgreSQL 55505，应用最终现有迁移；真实 PublicationRepository check/publish、compiler、player binding、epoch2 admission、DirectorSnapshot/Director runner 的实际 committed authoredEventKey、81 episode request、私聊 snapshot/NpcAgentModel/runNpcAgent/kernel。仅 TextModel 和明确本地 publisher-review evidence 是合成替身，不调用模型服务、不碰生产或原稿。
- 首段 `:::人物演绎提示` 给甲/乙不同原文：每人只收到自己精确原文（甲含前后空格）且为 `plan/task_suggestion`。其他人文本、全局 script/editorial/sceneText、Director description/audit 哨兵均不进角色 snapshot/model；来源 kind/recordId 与实际绑定稿件 ref、原文字段偏移、protocol 的 contentHash 逐项重算匹配。
- actual npcAgentAdvanceServices 连续派发两份真实 request，只调用对应 NPC 两次，Director 仍一次；均生成实际 receipt，无重复 Director 购买。角色保存自己的独立策略；后续私聊与实际 group snapshot/model 保留 private_strategy handle 和本人目标，不重新复制原文或全局正文。群输入与 NPC kernel 实际提交，不伪造 queued/succeeded。
- fenced/quote/preamble、重复人物条款、单条超 2000 字、无标记、初始重名均不交提示，创建 snapshot 不另起 actor attempt。有效 editorialIntent 仅在 script 缺省时使用；script 存在但无标记时不回退另一字段。typed offer_message 即使 script 有提示也保留旧 typed 精确路径（按 root 明确范围）。
- 当前姓名互换或重名时整块拒绝，不按新名重路由。SQL 验证初始 snapshot 名称甲/乙及 IMMUTABLE_SNAPSHOT；只对合成世界当前 display names 做 scoped admin 对抗性夹具修改，设置既有 epoch guard 后写入，原始快照/原稿不改；这不是新产品改名入口的验收。
- hash/actor/request/正文、plan→fact、伪 private_strategy、伪 actor state、删全部来源/观察、连同 input.type 替换，实际发送 gate 在模型前拒绝；sent/raw NULL，完整业务行不变。直接普通 mark 不能绕 canonical episode receipt；缺 source gate store、跨 owner/worker 均拒；保护来源超预算 fail closed，不静默删除。
- 实际 MemoryRepository active belief + forgetMemoryInStore 在付费回复期间遗忘，最终提交拒绝，paid raw 保留且原 command 不重买。unknown 原命令 ATTEMPT_UNKNOWN，换新命令由现有 pending fence ATTEMPT_PENDING 提前拒绝、无新 attempt；consumed 和 paid-invalid request 换新命令 INPUT_SCOPE_FORBIDDEN/0 新模型。
- 临时 scoped SQL receipt 触发器制造最终事务故障：业务行完整回滚，attempt 保持 response_received；删除触发器后同原 raw 免费恢复 committed，重复重放仍零新增模型。没有用假 incident、目标完成、到场或角色同意冒充进展。

## 验证与清理

最终专项真实 PG **35/35 通过**（34 子例 + 父例），日志 `.local/hint81-pg.log`。`tsc --noEmit` exit0（`.local/hint81-type.log`）；boundaries 568 files 通过（`.local/hint81-boundaries.log`）；新测试 Prettier check 与 staged diff check 通过。没有运行 fullcheck/build/UI。

PG 55505 正常停止：本任务 local-db parent PID49192 收到 TERM，原 session44115 exit0；随后 lsof 无监听。所有触发器均 finally 删除，合成世界退出时 paused/active_until=NULL。无密钥输出、无生产操作。未发现需 root 修复的公共产品 bug；开发中失败均是夹具设置/选择问题，已经按真实保护规则修正并全量复跑。

边界：自由正文的语义授权、自然语言质量和真实模型多轮行为不由本测试证明。scene 无 actual position，未伪造在场，也未宣称 scene 旅程已验收。该补充只验证明确首段作者许可的现有桥接，不把未标记原稿或参与名单变成知情授权；普通 NPC/player/wake 的其他能力不在此范围。root 负责最终联合门槛、生产状态、部署 READY 与公网验证。
