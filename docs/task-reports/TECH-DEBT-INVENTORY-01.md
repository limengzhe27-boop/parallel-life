# 《人生剧本》技术债（屎山）总清单

> 编制：dsh-main-20260923 ｜ 基线：**origin/main `312c3f8`**
> 来源：**本轮新排查** + 本会话中对代码的逐条核查（非复述推测）
> 性质：**盘点与修复方向**，不含实现。证据均为静态代码核对。

---

## 零、本轮新查到的"硬债"（之前没说过）

| # | 新发现 | 证据 | 为什么是债 |
|---|---|---|---|
| N1 | **巨型"上帝文件"成灾**：12 个文件 >900 行 | `messages.tsx` **2331**、`publisher-workbench.tsx` **2216**、`world-phone-app.tsx` **1772**、`interview-app.tsx` **1693**、`scene-repository.ts` **1302**、`publisher-plot-editor.tsx` **1154**、`publisher-import-dialog.tsx` **1152**、`scene-planner.ts` **1145**、`player-records.ts` **1025**、`publication-story-repository.ts` **969**、`publisher-importer.ts` **956**、`publication-source-review.ts` **913** | 一个文件承担 UI+状态+校验+文案；任何改动都高风险，测试也无法有效覆盖 |
| N2 | **官方 Demo 预设直接进产品代码** | `src/modules/settings/infrastructure/official-presets/county-yellow-hair.ts`（"县城黄毛"预设） | 通用产品里内置具体 Demo 预设，与"通用引擎"目标冲突 |
| N3 | **Demo 专属名词扩散到 8 个模块** | `official-presets/*`、`scene-planner.ts`、`space-repository.ts`、`scene-step-progress.ts`、`matter-progression.ts`、`scene-matter-policy.ts`、`life-art.ts`、`avatar-art.ts` | 修车店/R17/老周这类名词渗进领域层，换世界就可能踩到旧状态机 |
| N4 | **零 TODO/FIXME/HACK 标记** | `grep -rnE "TODO\|FIXME\|HACK\|XXX" src` = **0** | 不是没债，而是**债不留痕**：全靠人脑记、靠口口相传，新人无法接手 |
| N5 | **兼容/临时痕迹 45 处** | `grep -c "兼容\|临时\|暂时\|legacy\|deprecated" src/modules` = 45 | 兼容层没有集中收口，散落各处 |
| N6 | **55 个数据库迁移** | `ls db/migrations/*.sql` = 55 | 演进快不必然是债，但**缺少一次"契约归并"**，schema 与代码映射层会持续膨胀 |

---

## 一、架构与模型层

| # | 问题 | 证据 | 修复方向 |
|---|---|---|---|
| A1 | **同一实体多套模型与字段名** | `publisher-editor.ts:21-22/106-107`（`caresAbout`、`immediateGoal`）与世界侧 `lifeModules.drives` 并存；存在 `motivation: motivationText \|\| existingLifeModules.drives \|\| '按既定处境与玩家互动'` | 确立唯一 `Actor` 模型；表单/发布/世界/手机只做**显式映射**，禁止 `\|\|` 兜底 |
| A2 | 巨型文件（见 N1） | 同上 | 按"UI / 状态 / 校验 / 文案"拆文件；先拆最大的三个（messages、workbench、world-phone-app） |
| A3 | Demo 预设与专属逻辑沉入产品（见 N2/N3） | 同上 | 预设移出 `modules/**`（作为数据/内容，不是代码）；引擎只认通用动作模板 key |
| A4 | 兼容层散落（见 N5） | 45 处 | 集中到一个 `compat/` 且在契约版本升级时统一清理 |
| A5 | 契约字段过重且直接暴露 | `published-world-content.ts:244-279`（`prerequisites/conditionKeys/mutuallyExclusiveNodeKeys/timeline.*`） | schema 保留、UI 隐藏、由 AI 推断生成（与 A6 一起定） |

## 二、提示词与硬编码层

| # | 问题 | 证据 | 修复方向 |
|---|---|---|---|
| B1 | **提示词变成"负面警告裹脚布"** | `scene-planner.ts:636/649` 数百字、密集否定与格式补丁；模型耗时被拉长、互相牵制 | 结构化约束 + 关键规则 ≤N 字；设提示词预算并纳入评审 |
| B2 | 提示词里写死 Demo 示例 | 同处出现"核对 **R17 维修单**""**R17 钥匙和维修单**交给接收人" | 示例改占位符；禁止具体 Demo 名词进提示词 |
| B3 | 硬编码默认值 | `publisher-workbench.tsx:130` `startAt='2026-10-14T09:00:00Z'`、`tone='现实质感 · 情感波澜'` | 从世界设定/当前时间推导或让编导填 |
| B4 | 枚举硬编码 | `scene-planner.ts:44` `z.enum(['receive_r17','inspect_r17'])`；`:164` 同款 | 动作类型由世界内容定义 |

## 三、流程官僚化（产品心智）

| # | 问题 | 证据 | 修复方向 |
|---|---|---|---|
| C1 | **事项成了"对暗号"审批机** | `world-matters.ts:153` `inputQuote(1..4000)`；`scene-planner.ts:100/318` `observationIndex(0..7)`；prompt 里"completed 仅由 succeeded 支撑/blocked 只由 failed 支撑" | 降级为"线索/备忘"；证据字段改为**可选**；状态简化为 进行中/已完成/暂缓 |
| C2 | **现场"无人则禁止角色进入"** | `scene-planner.ts:724/731` 强校验一致 + prompt"不增删人物" | 由导演派驻决定在场者；无人时明确提示并给选项 |
| C3 | 后台把契约字段全铺成表单 | `publisher-plot-editor.tsx`（默认暴露前提/阶段/互斥/条件） | 默认只留：名称 / 概述 / 主要人物 |
| C4 | "待确认问题"面板（用户明确不要） | `publisher-workbench.tsx:893/964` | 删除面板，保留"检查"能力但改为行内/页脚摘要 |

## 四、界面与入口层

| # | 问题 | 证据 | 修复方向 |
|---|---|---|---|
| D1 | **角色试演不常驻**（"像纯填表"的根因） | `publisher-character-preview.tsx:92` `trial && !isDirty ? iframe : …`（而 `:71` 文案却说"试演运行的是已保存版本"） | 试演常驻 + 角标"以已保存版本运行" |
| D2 | **地点无法新增**（契约却要求 ≥1） | 契约 `published-world-content.ts:128-139` `.min(1)`；编辑器 `publisher-space-editor.tsx` 200 行**只有路线增删**，无地点增删 | 加"新增/删除地点" + 起点选择 + 空态引导 |
| D3 | **人物编辑静默丢弃** | `publisher-character-model.ts:22-25/40-41`：`uniqueActor` 要求恰好一条匹配，否则 `return content`（编辑无提示地丢失）；表单键来自 `workbench:1525` 的 `currentActorForm.key` | key 非法/重复时**显式报错并阻止编辑**；表单改按稳定 id 定位 |
| D4 | **保存失败不指字段** | `workbench:922-936`：除版本/权限/限流外，一律显示"请核对当前故事后重试" | 报错带**字段路径与原因**（服务端已能产出 references） |
| D5 | 入口冗余未收敛 | 导入（`workbench:1987`）/ 整理（`:1116`）/ 整理角色（`:1516`）/ 同步到展示字段（`:1120`）四入口并列 | 主路径留"整理"；导入降级为高级迁移工具；删除/折叠"同步到展示字段" |
| D6 | 长文本被拦不给存 | `workbench:243/247/249`："暂不能保存或整理" | 保存但不进提示词 + 字数提示 |
| D7 | 场景底色重放 + 行动无后果 | 用户实测（4 回合同一段描述；"烧店→并未成功"后无变化） | 底色只在进入/变化时展示；动作分级 + 可见后果 |
| D8 | ✅ 已改善：备忘录/人生记录归属拆分 | `notes.tsx:29/63/352/374/391`；`notes-records.tsx:556/574/591/600`（四段：关于这段人生/现在/过去/处境与选择） | 后续只需文案统一 + 行动项跳转 + 懒加载 |

## 五、测试、验证与协作

| # | 问题 | 证据 | 修复方向 |
|---|---|---|---|
| E1 | 测试固化实现细节 | `tests/group-client.test.ts:31/76`（`calls.length`）、`matter-ai-guidance.test.ts:90`、`nar03-phone-feedback.test.ts:400`、`experience-rules.test.ts:147`（错误码） | 守门测试聚焦用户体验契约；重写/删除实现细节断言 |
| E2 | 债不留痕（见 N4） | 0 个 TODO | 重大妥协必须写 `TODO(任务ID)` 或进主表 |
| E3 | **验收基线不统一** | 主 checkout 落后 origin/main **350 提交**（本地 653 测试 vs origin 2222 测试） | 主目录只做集成；执行者独立工作树；报告写明基线 sha |
| E4 | "全绿"不可复现 | 4 项测试因本地 PG 未起 `ECONNREFUSED` 失败（多份报告同样现象） | 门槛自动起库或显式跳过并标注 |
| E5 | 并行协作易互相覆盖 | 主目录存在他人未提交改动；公共契约改动曾两次打断全仓编译 | 契约变更必须补全构造点 + 跑 verify；一个任务一个分支 |

## 六、成本与运维

| # | 问题 | 证据 | 修复方向 |
|---|---|---|---|
| F1 | 缺成本硬限额/告警/备份演练 | 主表 `R-01` 系列仍进行中 | 服务端每次调用计数与限额、异常告警、备份恢复演练 |

## 七、功能性断裂（属于"没通"而不是"没做"）

| # | 问题 | 证据 | 修复方向 |
|---|---|---|---|
| G1 | **编导"必发事件"世界侧零消费** | `git grep candidates` 命中全在 `src/modules/settings/**`；世界/导演侧无消费点 | 按 `DIRECTOR-OBLIGATORY-BEATS-01.md` 落地必演绎队列 |
| G2 | 导演不"入驻"场景 | `advance-world.ts`/`agenda.ts` 只读空间（`currentPlaceId`/`positionSource`），无场景节拍类型 | 场景节拍 = 谁出现→发生什么→推进哪条必发事件→留痕 |
| G3 | 地点无入口 → 事件无舞台 | 见 D2 | 与 G2 联动 |

---

## 八、修复顺序（含依赖）

```
Batch 1（低风险、立刻改善体感）
  D1 试演常驻 → D4 报错指字段 → D3 禁止静默丢弃 → D2 新增地点 → C4 删面板 → D6 长文本

Batch 2（核心体验：先把"舞台"立起来）
  D2 地点（已完成）→ C2 在场人物派驻 → D7 场景分层与后果 → G2 场景节拍 → B4/A3 清 Demo 硬编码

Batch 3（把"官僚化"拆掉）
  C1 事项降级 → G1 必发队列 → C3/A5 事件表单瘦身（schema 保留 + UI 隐藏 + AI 推断）

Batch 4（治理与根治）
  A1 统一模型 → A2 拆巨型文件 → B1 提示词治理 → E1 测试策略 → E3/E4/E5 基线纪律 → F1 成本运维
```

**依赖提醒**：`C3/A5`（表单瘦身）必须与 `G1`（必发队列）**一起定契约**——被隐藏的字段正是队列判定依据。

---

## 九、验收总清单

- [ ] 编辑角色时试演不消失，且角标说明"以已保存版本运行"
- [ ] `grep -rnE "R17|维修单|receive_r17|inspect_r17" src/modules/world` 为空
- [ ] `official-presets` 不再位于 `src/modules/**`
- [ ] 有候选人物的场所至少 1 人可对话；无人时明确提示并给选项
- [ ] 随性自然语言可推进剧情，不出现 blocked 报错
- [ ] 3 个必发事件在受控推进中 100% 触发且不重复
- [ ] 事件表单默认只有：名称 / 概述 / 主要人物
- [ ] 后台不再出现"待确认问题"
- [ ] 连续 4 回合场景底色不逐字重复；越界动作有可见后果
- [ ] 人物 key 非法/重复时**显式报错**，不再静默丢弃
- [ ] 保存失败显示**字段路径与原因**
- [ ] 能新增/删除地点，且空地点时发布前有明确提示
- [ ] 单角色可试演；超长文本不被拒
- [ ] `grep` 无 `||` 兜底清洗残留；角色往返字段无丢失
- [ ] 提示词长度下降且无 Demo 专属示例
- [ ] >900 行的文件数量下降（至少拆掉 messages / workbench / world-phone-app）
- [ ] 重大妥协有 TODO(任务ID) 或主表记录
- [ ] 抽查报告均含基线 commit
- [ ] 成本限额/告警/备份演练落地

---

## 十、未验证 / 需实测

1. 未跑真实模型复现 R17 路径与"现场无人"；未做浏览器点击级走查；
2. "渣男体验"保存失败的具体字段未确认（需内容 JSON 跑 `PublishedWorldContentSchema`）；
3. `isDirty` 深拷贝误判（"后端补默认值导致误判已修改"）为他方结论，我未读该实现；
4. 地点为空时发布是报错还是自动补默认，未验证。

## 十一、相关文档索引

- `FIX-WORKORDER-01.md`：修复工作单（17 项，含证据/改法/验收）
- `PROJECT-DIAGNOSIS-COMBINED.md`：全景诊断（含小安结论逐条核对）
- `DIRECTOR-OBLIGATORY-BEATS-01.md`：必发队列（设计+代码+测试）
- `SCENE-EXPERIENCE-REVIEW-01.md`：场景体验分析与建议
- `RECORDS-NOTES-HANDOFF.md`：备忘录/人生记录归属拆分
- `WALKTHROUGH-312c3f8.md`：312c3f8 走查报告
