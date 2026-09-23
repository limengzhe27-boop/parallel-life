# Parallel Life 记忆与访谈合并方案

更新：2026-09-23。本文是 `parallel-life-kit-source` 能力进入主项目的实现基线。主项目继续使用 Next.js、TypeScript、Supabase 托管 PostgreSQL、Supabase Storage 和现有持久任务队列；Python Kit 只提供经过审阅的领域规则、数据边界和算法参考，不作为第二套线上后端。

## 1. 合并目标

用户通过个人 Agent 自然聊天，Agent 逐步理解用户并提出一个问题；用户确认后的事实才能进入现实档案。用户选择“如果”后，只把明确授权的资料带入分支。分支内的角色拥有独立会话和记忆，角色的推测不能变成世界事实。分支里的新愿望只有经过两次明确确认才可以写回现实档案。

```text
原始消息 → 候选资料 → 用户确认 → 现实档案
                                ↓ 仅带入已授权内容
                         平行分支 / 角色会话
                                ↓ 用户明确同意写回
                         现实档案候选 → 再次确认
```

## 2. 不合并的内容

- 不运行 Python FastAPI、SQLite 或原生 HTML 前端。
- 不建立第二套用户、世界、任务或媒体数据库。
- 不把 Python 的内存 Store 当生产 Repository。
- 不把 `interact-turn` 测试编排器当作生产世界写入口。
- 不让模型直接修改 Profile、World、Memory 或任务状态。

## 3. 四种数据状态

### 原始证据

`interview_messages`、`world_messages`、`world_events` 和用户明确编辑。原文只增不改，模型不能覆盖原文。

### 候选资料

模型从原文提取的事实、事件、愿望，状态为 `suggested`。未确认前不能生成分支、不能写入正式档案。

### 正式档案与世界事实

用户确认后的现实 Profile，以及事务确认后的 World event。两者都必须有来源和版本。

### Agent 认知

角色对用户的推测、印象和摘要。它们属于角色或分支作用域，必须标明 `agent_inference`，不能升格为用户事实。

## 4. 作用域

记忆使用统一记录，但必须明确作用域：

- `profile`：个人 Agent 已获得授权的现实信息。
- `branch`：一个平行世界中的经历、愿望和选择。
- `character`：某个角色在某个世界里的认识、推测和关系记忆。

上下文编译必须先按用户、世界和角色过滤，再按来源状态过滤，最后做相关性和预算排序。不能把完整 Profile 直接传给角色。

## 5. 访谈状态机

每个个人 Agent 访谈最多一个 `open` 问题。问题状态为 `open / answered / skipped / dismissed`，但“跳过当前问题”不能永久封锁整个主题；只有用户明确表示不希望再次讨论时才加入主题屏蔽。

每轮模型输出结构化提案：`reply`、可选的一个 `question`、候选 `facts`、候选 `events` 和候选 `wishes`。所有候选都带原始用户消息 ID。Handler 事务保存消息、问题状态和候选资料；用户回答、跳过、拒绝使用独立幂等命令。

## 6. 记忆算法

保留 Python Kit 中经过审阅的规则：

1. 来源先过滤，排序后进行。
2. 最近原文和长期记忆分开，不能把同一段话重复塞入上下文。
3. 只有用户原话或已确认事件可以形成高可信事实。
4. 全部来源来自 Assistant 时，最多形成 `belief / agent_inference`。
5. 用户纠正优先于历史推测。
6. 遗忘沿来源、同一请求的助手回声和下游派生摘要级联屏蔽。
7. 最终模型上下文必须包含系统约束和最新用户消息；超出预算时明确失败，不能静默截断关键设定。

## 7. 分支写回护栏

分支内的用户表达先只写入分支记忆。只有以下完整链路都完成，才允许写现实 Profile：

1. Agent 在分支内提出“是否记录到现实档案”。
2. 用户在分支内明确同意。
3. 系统创建现实档案候选，状态为 `suggested`。
4. 用户在“我的”中再次确认。
5. Profile Repository 使用当前版本事务写入，并保存来源分支和来源消息。

候选和确认必须持久化、可重放、可拒绝，不能用进程内数组。

## 8. 生产调用顺序

```text
Route Handler
  → authenticated session / CSRF / owner scope
  → Repository 保存用户消息和 command receipt
  → Task Queue
  → Planner / Memory Handler / Dialogue Reviewer
  → 事务校验版本、来源和权限
  → 保存 Assistant 消息、候选、记忆、事件和 outbox
  → 返回可恢复的 task / receipt / current state
```

普通聊天不增加 `world.version`；图片是独立任务；明确的 `userAction` 才能进入已有 World reducer 和 command repository。任何新的测试编排器不能绕过已有事务入口。

## 9. 可并行任务

所有执行者必须先在 `docs/DEVELOPMENT.md` 领取对应任务，再修改专属文件。任务之间共享的 Zod 契约、数据库字段和任务状态由 MEM-01 先定稿；只有 I 集成人修改公共契约。

|任务|负责人|依赖|专属范围|交付标准|
|---|---|---|---|---|
|MEM-01 统一领域契约|I / 主集成人|—|`src/modules/memory/domain/**`、`src/contracts/memory.ts`、重复实现清理建议|统一 Memory、SourceRef、Question、scope 和错误；删除或适配 `world/domain/memory.ts` 的重复契约；领域测试通过|
|MEM-02 数据库与持久化|B|MEM-01|`db/migrations/0009+`、`src/modules/memory/infrastructure/**`、`src/modules/profile/infrastructure/*question*`|迁移含 RLS、来源所有权、scope 约束和版本索引；Memory/Question/候选 Repository 可重启恢复；真实 Supabase PostgreSQL 测试通过|
|MEM-03 访谈问题接线|F|MEM-01、MEM-02|`src/modules/profile/infrastructure/interview-*`、`src/app/api/v1/interview/**`、相关 contracts|真实 Agent 提案保存一个问题；回答/跳过/拒绝幂等；候选资料不越过 suggested；并发版本冲突可恢复|
|MEM-04 上下文编译器接线|B/F|MEM-01、MEM-02|`src/modules/memory/application/compile-context.ts`、`src/modules/world/application/actor-context.ts`、角色查询适配|角色、世界、分支、现实带入资料和私聊严格隔离；最终 Prompt 总预算验证；不可见来源测试通过|
|MEM-05 记忆提取与纠正遗忘|B|MEM-01、MEM-02|`src/modules/memory/application/derive-memory.ts`、`edit-memory.ts`、`memory-handler.ts`、任务 handler|记忆任务可恢复；assistant-only 降级；纠正优先；遗忘级联；超时 unknown；原始消息保持不变|
|MEM-06 分支写回|F|MEM-02、MEM-03、MEM-05|候选写回 Repository、Profile command、`src/app/api/v1/profile/**`|两次明确确认；跨用户/跨分支拒绝；版本冲突和重复提交可恢复；真实 Profile 更新有来源|
|MEM-07 角色回合整合|I / 主集成人|MEM-01、MEM-04、MEM-05|现有 `world` reducer、`resolve-turn`、AI adapter、outbox；不新增第二写入口|普通聊天、索图、世界行动均接入现有事务；删除式校稿只做过滤；不绕过 command、版本和权限|
|MEM-08 集成验收与线上启用|Q / I|MEM-02 至 MEM-07|`tests/integration/**`、浏览器验收、部署报告|Supabase 迁移、pl_app/pl_worker、真实合成 Agent、记忆恢复、照片和分支隔离通过后，才关闭预览模式|

## 10. 并行关系

```text
MEM-01
 ├─ MEM-02 ─┬─ MEM-03 ─┐
 │          ├─ MEM-04 ─┼─ MEM-07 ─┐
 │          └─ MEM-05 ─┘          ├─ MEM-08
 └────────────── MEM-06 ──────────┘
```

MEM-02、MEM-03、MEM-04、MEM-05 不能全部同时开工：MEM-02 需要先确定数据库契约，MEM-03/04/05 可在 MEM-01 的领域契约冻结后并行；MEM-06 和 MEM-07 必须等待各自依赖。一个执行者只能领取一个主任务，不能多人同时改同一迁移、公共契约或 World 写入口。

## 11. 验收门槛

单元测试通过只代表领域算法通过。任务完成还必须包含：

- `npm run check`
- `npm run build`
- 真实 Supabase PostgreSQL 迁移与 RLS 测试
- 跨用户、跨分支、跨角色来源测试
- 任务超时、重试、unknown 和幂等测试
- 合成用户的真实模型访谈和角色对话
- 浏览器刷新恢复和手机端操作验证
- 部署后再次检查 API 和数据持久化

没有 Repository、API、任务接线和真实数据库证据的代码，只能标记为“领域原型”或“待验收”，不能标记为已完成。
