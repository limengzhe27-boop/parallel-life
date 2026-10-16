# 44-63-ELIGIBILITY-PG-D · 真实发布来源的作者事件资格验收

## 身份与范围

- Agent：codex-ma44-authored-eligibility63-d；会话 authored_eligibility_63。
- 角色：独立真实数据库测试执行者；root 唯一公共契约、源码、SQL、集成和发布负责人。
- 工作树：`/Users/limengzhe/.codex/worktrees/author-eligibility63/人生剧本`。
- 基线：`c419c54b`；root 预算错误码后继 `dcadb150` 仅作为依赖 cherry-pick 为本地 `35db317b`，不属于本人交付源。
- 独占新文件：`tests/integration/authored-event-eligibility.test.ts`、本报告；主目录仅本人登记行与报告镜像。
- PG：先确认 55505 无监听，独立 ignored `.local/runtime.json` / `.local/postgres`；node_modules 为已忽略依赖链接。没有接触 root PG55564、生产库或真实原稿。
- 更新时间：2026-10-15T17:31:20.924931+00:00。

## 当前接续点

- 状态：待验收，测试源已冻结；数据库已正常停止，55505 无监听。
- 精确测试提交：`5da83c144bb9466653a38603db955a0d83935f74`，仅 1 个新测试文件。
- 下一步：root 按该提交集成新测试，CI 使用 `AUTHORED_ELIGIBILITY_TEST_PORT` 显式指定根专用测试端口；本人默认 55505。之后统一 check/build、迁移、READY 和公网验证。
- 阻塞：无。本人没有发现需要 root 修复的新产品问题。

## 真实链路与断言

1. 复用既有 authored-agent-material 测试的真实 publisher repository、稳定合成 reviewer 及 `compilePublicationGenesis` 方式，实际 check/publish 后 `startPublished`，生成独立 owner 世界。使用真实 epoch 切换和显式 genesis admission；没有手写世界历史、伪造绑定、epoch2 事件、参与回执或 GUC。
2. 在 `REPEATABLE READ READ ONLY` 中调用实际 `readAuthoredEligibilityInTransaction`，再调用实际 `PostgresDirectorSnapshotRepository` 对比资格摘要。关键表完整行前后相等；读取不初始化旧计划。
3. 冻结原稿一天窗口保留 12 位小数 Z 字符串。等瞬时 +08 输入和 UTC 资格/哈希完全一致；次日 not_before、窗口结束半开区间按运行时毫秒语义验证。作者 schema 本来只接受 Z，因此未往源中注入不支持的 +08；+08 是实际 loader 的 storyAt 输入。
4. 三条同文 history 只有 a_bound/b_bound 被初始知识实际分配事实。两个合格节点分别精确绑定初始第 0/1 个 fact ID，第三 c_unbound 没有事实来源，仍 history_fact_missing。重复 text 不能冒充另一 key。
5. 无前提 start 的远处地点元数据/必须去的 prose 不添加隐式 gate。明确 shop at_place 合格，命名条件 away at_place 受阻。三轮实际 NPC kernel 聊天含玩家自报已到达/NPC听说与已完成台词，均不生成权威位置、不解锁 gate/after_presented/after_resolved，相关资格 key 不因无关 worldVersion 改变。
6. 调用真实 `PostgresWorldSpace.travel` 后，actual-position:player 证据来自成功 command→travel.completed event→权威位置投影；此时 away 才合格、shop 变受阻。NPC地点认知/普通消息不代替玩家实际位置。
7. 实际 Director persistence 提出 start 机会，得到 proposed episode 和真实逐人请求。实际 NPC kernel engage 与消息保存后，严格回执使 episode 成为 active；proposed 和 active 均占用 start key，但都不释放 after_presented/after_resolved，也不伪造 resultIds。占用的 start 不能再提出同机会。
8. 实际 owner、foreign owner、worker、错误 epoch/worldVersion 检查均精确断言错误码并对比完整数据行不变。worker loader 被 SQL 权限 42501 拒绝；worker Director snapshot 的首个 world 读取被 RLS 隐藏，明确 DIRECTOR_WORLD_NOT_FOUND。
9. blocked away_gate 带 key 或省略 key 但仍引用该 authored 来源都被实际模型解析拒绝；仅显式 mock 一次，保存 invalid_output，重复相同 command 精确 INVALID_STATE 且调用数仍 1。伪造 eligible 摘要在实际 claim 被 DIRECTOR_AUTHORED_ELIGIBILITY_CONFLICT 拒绝。
10. 额外绕过 parser 直接调用实际 director.commit；两种带/不带 key 的 blocked 来源都被最终仓储精确 DIRECTOR_OPPORTUNITY_BOUNDARY 拒绝。相关完整行保持相等，attempt 留 response_received，0 decision/episode。
11. 修改当前 draft 取消 gate 后，已发布世界仍旧 gate/原稿/哈希；新 draftVersion1 trial 合格，sourceHash/qualificationKey 与旧 published 分离；后来新建 publicationVersion1 世界仍用旧 gate。
12. 最后对本测试全部实际创建世界核实 6 个旧剧情计划/节点/进度/回执/开场批次/投递表合计各为 0；真实聊天、travel、Director、active 都不偷偷初始化旧链路。

## 验证证据

- 真实 PostgreSQL 18.4，`AUTHORED_ELIGIBILITY_TEST_PORT=55505 node --experimental-strip-types --test tests/integration/authored-event-eligibility.test.ts`：**11/11 pass，0 fail/skip**（父测试 + 10 专项）。最终日志 `.local/eligibility-pg.log`。
- `tsc --noEmit`：退出 0，日志 `.local/eligibility-type.log` 无诊断。
- `npm run check:boundaries`：**561 files passed**，`.local/eligibility-boundaries.log`。
- 新测试 Prettier check、git diff --check：通过。
- 正常 SIGTERM 本人 local-db 父进程，工具会话退出 0；随后 55505 无监听。没有安装/遗留临时 SQL trigger/function。
- 真实模型 0、生产读写 0、浏览器 0。只用明确 mock 返回，不以此宣称 AI 成功或完整剧情体验完成。
- 按 root 分工未运行 full check/build、未提交推送生产；新 SQL81 仍未上线，本任务不得标完整交付。

## 过程记录

- 首轮夹具把 director_event 的 after_resolved 限为 committed，真实 compiler 按既有 unsupported_director_completion_dependency 拒绝。仅改本人合成内容为正式允许的 committed/skipped 集合，保留真实 compiler，未绕准入、删断言或改产品。
- 初步 3 项本人期望修正：命名条件同时返回 at_place_not_met/condition_not_met；worker snapshot RLS 为空而非 SQL 权限先拒；首次 terminal invalid_output 会抑制 genesis wake，独立负例必须各取新世界和实际新 snapshot。没有把陈旧 snapshot 再用以掩盖因果校验。
- 最后全世界旧表检查最初把 text world_id 参数写成 uuid[]，真实 PG42883；仅修本人查询为 text[]，最终 11/11 全绿。

## 集成验收

由 root 填写；本任务保持待验收。root 的生产迁移、完整 check/build、关联提交身份推送、READY 与公网关键流程仍是交付门槛。没有取消多人、时间、多人生或后续完整叙事验收。
