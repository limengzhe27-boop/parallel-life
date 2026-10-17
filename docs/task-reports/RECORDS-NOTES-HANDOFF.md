# 备忘录 / 人生记录 优化交接说明（给实现者）

> 交接方：dsh-main-20260923（与用户讨论后整理）
> 目的：把「备忘录」与「人生记录」两个界面的归属拆分与优化，整理成可直接开工的实施说明。
> **重要前提**：本文件里的行号来自一份**落后 origin/main 350 个提交**的旧副本，**行号不可信**；所有定位一律以**符号名**在最新代码里重新搜索。基线：`origin/main 93b8773`。

---

## 0. 一句话目标

把玩家手机里的「备忘录」还给玩家（**只有私人便签**），把"这段人生"的内容收进一个**独立 App「人生记录」**（**只读 + 跳转**）。名字已由用户确认：**人生记录**（不是"这段人生"）。

---

## 1. 根因（先看懂这一条，再动手）

**不是样式问题，是"同一份内容没有唯一归属"。**

- `records.about`（人生起点 / 世界背景）**同时**渲染在两处：备忘录里（`backgroundRecords`）与记录视图里（`notes-records.tsx` 里 `data.about.filter(isNotesBackgroundRecord)`）→ 玩家看到重复内容。
- 剧本开场（`PublicationOpeningSchema`：`identity` 身份 / `situation` 处境 / `setting` 世界设定 / `experienceNote`）被当作**便签**塞进备忘录（`openingNotes`，`origin.kind === 'publication_opening'`）。
- 「处境与选择」（`data.choices`）也渲染在备忘录里。
- **「人生记录」目前根本不是 App**：`phoneApps = ['messages','moments','photos','calendar','notes','scenes','map']`，没有 records；它只是备忘录 `section === 'todo'` 时渲染的 `<NotesRecords/>`。

结论：玩家无论打开哪个界面，看到的都是"我的东西 + 后台投射"的混合物，所以怎么排版都消不掉"后台感"。

---

## 2. 问题清单（按四层，含证据与解法）

### 2.1 归属错位（根因层）

| # | 问题 | 解决 |
|---|---|---|
| 1 | 「人生记录」不是 App，是备忘录的 `todo` 分区 | 提升为独立 App（`phoneApps` 增加 `'records'` + dock 入口 + 渲染分支），备忘录删除该分区 |
| 2 | 世界设定/身份/初始处境以"便签"形式在备忘录（`openingNotes`） | 迁入人生记录首屏「关于这段人生」；备忘录只留一个跳转入口 |
| 3 | 同一份 `about` 渲染两次 | 只保留人生记录一处；用测试锁死"`about` 不得出现在备忘录" |
| 4 | `choices`（处境/选择）在备忘录里 | 迁入人生记录「处境」 |

### 2.2 备忘录（`src/features/phone/apps/notes.tsx`）

| # | 问题 | 解决 |
|---|---|---|
| 5 | `notes:section` 的 notes/todo 二分；有 `useEffect` + `navigate` **强行切换分区**，返回时停在错误分区（所以到处补"返回便签"按钮） | 删掉二分与那套状态机；**待办 = 私密便签里带勾选项的视图** |
| 6 | 搜索按分区各存（`notes:search:${section}`），切分区丢查询 | 备忘录内**单一 query** |
| 7 | 私密便签与投射便签共用 `data.notes` 与草稿/操作命名空间（`noteDrafts[id]`、`operations['note:'+id]`） | 草稿/操作键按种类加前缀；**投射内容不进草稿系统**（只读不写） |
| 8 | 越权守卫只在 UI（删除按钮条件 `note && actions.deleteNote`；只读分支 `if (note && !isPrivateNote(note))`） | UI 守卫保留，**服务端 `saveNote`/`deleteNote` 增加同断言**（`origin === undefined` 才允许写） |
| 9 | 列表混排系统投射 → "后台投射感" | 列表只留 `isPrivateNote` |

### 2.3 人生记录（`src/features/phone/apps/notes-records.tsx`）

| # | 问题 | 解决 |
|---|---|---|
| 10 | **缺「关于这段人生」**：世界设定(≤1600)/身份(≤300)/初始处境(≤1000)/体验备注(≤300) 只在备忘录 | 首屏置顶**只读卡 + 详情页**，数据来自 `publication_opening` |
| 11 | 段落混杂：`about / current / opportunities / otherCurrent / pursuit / world_matter` 混在一个滚动流 | 收敛为**四段**：① 关于这段人生 ② 现在 ③ 过去 ④ 处境 |
| 12 | 空态不统一 | 每段补空态，并区分"没有记录"与"搜索无结果" |
| 13 | 长文不折叠（setting/situation） | 摘要卡 + 详情页展开 |
| 14 | 行动项只有展示 | 需要行动的内容给**跳转**（去日历确认邀约、去消息回复、去相册看照片）；**记录 App 不就地编辑** |
| 15 | 来源标注零散（`recordAttribution`：你的讲述 / 人物建议 / 日程记录 / 人生起点 / 世界核实 / 虚构起点来信） | 标注**常驻**在列表行与详情（诚实层，不可省） |
| 16 | 一次渲染全部记录 | 分段渲染 + 懒加载 |

### 2.4 契约与工程

| # | 问题 | 解决 |
|---|---|---|
| 17 | 世界观两套建模：`publication_opening` 与 `PlayerRecords.about/current/history` 未归一 | 在记录契约里明确「人生背景」条目来源（映射 opening），避免同内容两处建模 |
| 18 | 一个屏幕用两个 CSS（`apps.module.css` 986 行 + `notes-records.module.css` 585 行），后者含只为错位内容存在的分区样式 | 记录样式集中到 records 模块；删除多余分区样式 |
| 19 | 缺守门测试 | 补：`about` 单一渲染点、投射只读、私密可编辑、分区/滚动恢复、草稿命名空间隔离 |
| 20 | UI/代码命名混乱（系统记录/背景/处境/待办） | 统一玩家语汇：**备忘录** · **人生记录**；段名固定「关于这段人生 / 现在 / 过去 / 处境」 |

---

## 3. 目标形态

```
备忘录（我的）                          人生记录（这段人生，独立 App）
├─ 我的私密便签：列表 / 搜索 / 新建        ├─ ① 关于这段人生：世界设定·我的身份·初始处境 [只读·详情]
├─ 待办勾选（同一堆便签的视图）            ├─ ② 现在：进展·机会·邀约状态·两步交付清单 [只读·跳转]
└─ 入口：关于这段人生 →                    ├─ ③ 过去：起点来信·世界核实·起点背景 [只读]
                                          └─ ④ 处境：选择时间线 [只读]
规则：所有"读 + 跳转"在人生记录；所有"写"在备忘录 / 日历 / 消息
```

**归属表（唯一渲染点）**

| 内容 | 归属 | 可编辑 |
|---|---|---|
| 私人便签 / 待办勾选 | 备忘录 | ✅ |
| 世界设定 / 我的身份 / 初始处境 / 体验备注 | 人生记录 ·「关于这段人生」 | ❌ |
| 进展 / 机会 / 邀约状态 / 两步交付清单 | 人生记录 ·「现在」 | ❌（跳转） |
| 起点来信 / 世界核实 / 起点背景 | 人生记录 ·「过去」 | ❌ |
| 处境与选择 | 人生记录 ·「处境」 | ❌ |

---

## 4. 实现清单（按三步提交）

### Slice 1 · 归属搬家（先做这个，"乱"感立刻消失）

1. `src/features/phone/navigation.ts`：`phoneApps` 增加 `'records'`（dock 文案「人生记录」）。
2. `src/features/phone/phone-shell.tsx`：应用标签/图标映射增加 records。
3. `src/features/phone/apps/index.tsx`：`PhoneAppView` 增加 `context.app === 'records'` 分支，渲染从 `notes-records.tsx` 抽出的 `RecordsApp`。
4. `src/features/phone/world-phone-app.tsx`：把 `records`（`about/current/history`）与 `choices` 传给 records App；移除备忘录内渲染 `NotesRecords` 的路径。
5. `src/features/phone/apps/notes.tsx`：删除 `notes:section` 二分与强制切换的 `useEffect`/`navigate` 逻辑；移除 `openingNotes` / `backgroundRecords` / `choices`；顶部加唯一入口「关于这段人生 →」。
6. 样式：记录相关样式集中到 `notes-records.module.css`；删除只为错位内容存在的分区样式。
7. 测试：`about` 单一渲染点；投射内容只读；私密便签可编辑/删除；分区与滚动恢复。**同步更新因去重而失效的旧预期**（备忘录侧当前有测试依赖这些内容的渲染位置）。

### Slice 2 · 人生记录四段化

四段（① 关于这段人生 ② 现在 ③ 过去 ④ 处境）+ 每段标题与一句人话解释；置顶卡采用摘要 + 详情折叠；来源标注常驻；行动项改为跳转；统一空态；搜索跨四段。

### Slice 3 · 边界与性能

服务端对投射内容拒绝写入的断言；草稿/操作键按种类加前缀；分段懒加载；可访问性（每段 `aria-label`、清单用真实语义角色、时间可读文本）。

---

## 5. 红线（不得违反）

1. **隐私隔离**：真实人设 / 私密访谈绝不进入前端玩家可见层；玩家只看到公开名片与授权投射内容。
2. **禁止伪造**：不得在静态 HTML 里手写假聊天气泡；真实试演只在左侧内嵌手机 `iframe` 中运行。
3. **只读投射**：`publication_opening` 与 `records.*` 一律只读；UI 守卫 + 服务端断言双保险。
4. **单一渲染点**：同一份内容只在一个界面渲染（尤其 `about`）。
5. **写操作归属**：玩家能写的东西只有备忘录（以及日历/消息各自的写入口）。

---

## 6. 验收标准

1. 备忘录第一屏只有玩家私人便签，且有一个明确入口去人生记录；
2. 人生记录能独立进入，备忘录里不再有"待办/记录"分区；
3. 人生记录首屏可见世界设定 + 我的身份 + 初始处境；
4. 同一份背景记录**只渲染一次**（`about` 不得出现在备忘录）；
5. 每条记录可见来源标注（你的讲述 / 人物建议 / 日程记录 / 人生起点 / 世界核实）；
6. 需要行动的内容是**跳转**而非就地编辑；
7. 空态、长文折叠、搜索、返回位置（分区与滚动）均正确；
8. 服务端拒绝修改投射内容。

---

## 7. 已知风险与坑

1. **行号不可信**：本文件行号来自旧副本；请以符号名（`isPrivateNote`、`openingNotes`、`backgroundRecords`、`choices`、`notes:section`、`NotesRecords`、`recordAttribution`）在最新代码里重新定位。
2. **`about` 去重会打破现有测试**：备忘录侧已有测试依赖当前渲染位置，需要一并更新预期（这是 Slice 1 的一部分，不要留红）。
3. **契约归一（问题 17）会牵动服务端**：若要把 `publication_opening` 映射为记录的「人生背景」条目，需与集成人确认是否需要迁移/兼容旧数据。
4. **性能与提示词预算**：`setting` 1600 字 + `situation` 1000 字不适合列表铺开；同时注意这些内容若进入模型提示词，需要预算控制。
5. **改动范围**：Slice 1 会动到手机壳、导航、应用渲染与备忘录四处，**建议一个分支只做一件事**，方便回滚与验收。

---

## 8. 已准备好的环境（可复用，也可另建）

- 工作树：`/Users/limengzhe/Desktop/projects/demo/人生剧本-records`
- 分支：`codex/records-notes-split`，基线 `origin/main 93b8773`
- 已写入登记：`.local/agent-board.lock/owner.json`、`docs/task-reports/RECORDS-NOTES-SPLIT-01.md`
- 已配置：`node_modules`（复用主目录）、`.env.local`、`.local/runtime.json`
- **基线验证**：`npm run check` → 边界 **440 文件通过**、单元 **2222/2222 通过**

---

## 9. 交付建议

- 一个分支只做一个 Slice；完成后跑 `npm run check` + `npm run build`；
- 报告写清：改了哪些文件、测试结果、验收对照（第 6 节 8 条逐条打勾/说明）、以及任何未完成的项；
- 交集成人合并前，请确认**没有在共享目录（主 checkout）里改动**，避免与其他人未提交的工作冲突。
