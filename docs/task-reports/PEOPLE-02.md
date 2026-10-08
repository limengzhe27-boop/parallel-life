# PEOPLE-02 · 聊天引导与现实人物整理

状态：待验收。Agent `codex-f-01a0c7c8-people02-20261008`，基线 `8969278`，分支 `codex/people02`，独立工作树 `/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/people02`。资源 PostgreSQL 55437 / 预览 3227。主表已短锁领取；0036 迁移独占。未经主任务集成、生产迁移和公网验收，不能标已完成。没有推送或部署；当前线上版本未因本交付改变。

## 实现范围

- 统一人物入口为“我身边的人”，详情和编辑字段为最新要求“我的描述”。可记录用户对性格、习惯、能力、经历、看法和互动的描述，标明是用户描述，不是客观诊断或模型推断。具体共同经历和来源单独展示。
- Person 保留原四字段和旧 Profile / 世界兼容，新增可选 knownName、temporaryLabel、interaction（旧契约中的存储名，UI 为“我的描述”）、experiences、来源 IDs / 原话及更新时间。只有临时称呼也可保存，不强制姓名、关系、照片。旧姓名不自动猜成正式姓名。
- 人物列表显示称呼、现实关系、一行摘要、可选头像；已有记录先看详情，再补充/纠正。每人一张普通展示头像，通过现有真实私有上传/读取 API；不用于生成图像，不从照片推断身份。
- Profile 编辑增加向后兼容的可选 commandId；账号锁、版本检查、Profile 和不可变回执同事务。重复命令返回原响应，改同一 commandId 的内容报冲突。客户端保存失败重试保留命令 ID。手工更正保留历史聊天证据，标为手工；详情明确旧原话不代表本次手工改动的证据。
- 现有 InterviewPlanner 的同一次调用增加人物提案，不追加模型调用；流式和 Task Queue 后台路径均在原保存事务中调用同一人物校验/持久函数。来源在 SQL 中再次查当前 owner / interview / user / 当前输入 ID，头像只从本条真实用户附件获取，模型不允许返回 assetId。
- “我的描述”保存核验过的用户原话，丢弃模型的概括/诊断文本，避免把“对我好但干涉职业”缩成单一负面标签；共同经历仅接受原话的字面片段，已有同文经历不重复追加。原话和来源保留，界面可追溯。
- 人物整理先锁 Profile 并核对模型开始时的版本；期间手工修改/删除导致版本改变时跳过旧人物提案，不重建删除记录。事务随后失败时人物、助手消息、访谈版本和任务成功状态一起回滚。
- 常见明确现实关系才能自动整理；假设/故事、引述、疑问、同名多人、另一个人、歧义指代、不同名字或旧数据身份不清时保守不写，不按名字或照片合并。追问由同一向导自然提出；流式及保存回复都只保留一个问题，并使问题元数据与实际问出的句子一致。
- 修复流式回调异常被当成不完整 JSON 吞掉的问题；消费端中断能传播，阻止随后提交人物资料。既有 unknown / 回执 / 重试规则继续沿用。

## 文件

- `src/contracts/api.ts`
- `src/modules/profile/domain/person-record.ts`
- `src/modules/profile/application/person-extraction.ts`
- `src/modules/profile/infrastructure/profile-repository.ts`
- `src/modules/profile/infrastructure/interview-planner.ts`
- `src/modules/profile/infrastructure/interview-handler.ts`
- `src/modules/profile/infrastructure/interview-repository.ts`
- `src/features/interview/life-events.tsx`
- `src/features/interview/person-editor.tsx`
- `src/features/interview/person-editor.module.css`
- `src/features/interview/interview-app.tsx`
- `src/features/discovery/draft-editor.tsx`
- `db/migrations/0036_profile_person_records.sql`
- `tests/person-record.test.ts`
- `tests/interview-agent.test.ts`
- `tests/integration/person-record.test.ts`
- `tests/integration/interview-people.test.ts`
- 本报告；主目录 `docs/DEVELOPMENT.md` 仅更新本人行，未将旧工作树任务表提交。

`src/features/api/client.ts` 沿用已有 ProfileEdit 类型，不需要改。没有修改主目录 LIB-04B 在途代码、BRANCH-01Q 文件、公共布局或 world/discovery planner。

## 验证证据

- `npm run check`：292 项通过，204 文件架构边界、类型检查通过。日志 `.local/people02-check-final.log`。
- `npm run test:db`：49 项通过，1 项真实模型验收默认跳过（需显式启用）；没有失败。日志 `.local/people02-db-final.log`。
- 真实 PostgreSQL 18.4 / 独立 55437：真实上传字节、Repository 重建读取、跨 owner RLS、照片归属、owner/interview/user 原话触发器、并发版本只一方成功、不可变幂等响应、插入回执失败整体回滚、两条访谈路径、旧结果不覆盖手工修改、重复人物/经历、中断 unknown 无人物写入、助手插入失败回滚。模型输出为明确标注的 fixture；这组测试证明持久化规则，不证明模型质量。
- 显式运行 `PEOPLE_MODEL_EVAL=1 node --env-file=.env.local --experimental-strip-types --test --test-name-pattern='opt-in real model' tests/integration/interview-people.test.ts`：真实 gpt-4o-mini + PostgreSQL 四场景通过，每场景一次调用。表姐描述有用户原话；虚构领导成为下属、仅真实附件、同名未明三场景人物零写入。第一场走真实流式 adapter，后三场走真实队列 lease / handler。合成输入，不使用真实用户私人访谈。日志 `.local/people02-model-eval-final.log`，输出 `.local/people02-model-eval.json`。
- 真实模型初次漏 `people`、漏 facts/events 和改写摘要导致验收失败；没有把失败算成功。补全输出提示/兼容空数组、将描述保存限定为核验的原话后复验通过。模型仍可能漏提共同经历，最近表姐样本未写入 `people.experiences`；不声称全量语义整理已经可靠，集成验收应继续考察此点。
- `npm run build` 通过；日志 `.local/people02-build-final.log`。本轮修改文件 Prettier 检查通过，`git diff --check` 通过。
- ego-browser 实际 390×844 / 1440×1000：临时称呼无姓名保存、真实文件上传、更换头像、我的描述输入性格/习惯/能力、共同经历、保存后刷新恢复、私有图片加载，PC 无横向溢出。测试浏览器的语义自动滚动偶有定位失败，观察截图后用真实鼠标点击保存；未用 DOM click 或 fake handler 代替。
- 截图（本地证据，不随代码上线）：`.local/person-details-mobile-final.png`、`.local/person-details-pc.png`，位于上述独立工作树。均已目视检查。浏览器测试已结束。

这些不是生产 PostgreSQL 验收或公网验收。纯函数/固定模型测试仍属于有限规则验证；生产 Repository 是 PostgreSQL，未接内存仓储、第二套数据库或 Python 服务。

## 接续与限制

1. I 合并本提交，重点协调 `interview-app.tsx` 与主目录 LIB-04B 在途代码。公共契约和0036按登记归属只合并一次；本执行者不接管集成角色。
2. I 确认生产0036迁移应用，集成 check / build、真实访谈保存/更正/头像读取及四类负面样本，再按已有部署流程等待 READY 并公网实测。当前只标待验收。
3. 更丰富人物资料带入草案/世界由 PEOPLE-02B 消费经过用户授权的资料；此处未将完整访谈给世界，未实现剧情/任务引擎、既有世界加人、同人多图或图生图。
4. 自动人物识别是保守常见关系集合，不保证任意称呼、所有语言或跨轮代词消歧；未命中资料留在对话，可手工补充。共同经历真实模型分类存在漏提，不能把本次四个有限样本解释成完整语义能力验收。
5. 历史证据最多40条、具体经历最多10条；证据满额时停止自动追加，不截掉旧证据。完整资料删除/来源遗忘级联未在此扩展；后续任务涉及人物证据时须由I统一协调。
