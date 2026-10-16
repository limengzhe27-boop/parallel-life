# 任务交付报告：WORLD-PUBLISH-01D-PEOPLE-UI

- **任务 ID**：`WORLD-PUBLISH-01D-PEOPLE-UI`
- **执行 Agent**：`xiaoan-people-ui-20261012`
- **开发分支**：`codex/world-publish-people-ui`（基于基线 `836c12b684845ba07e14c81a42290468b88f85d3`）
- **独立工作树**：`.local/worktrees/world-publish-people-ui`
- **交付状态**：待验收（Pending Integration Verification）

---

## 1. 交付背景与界面对齐

本任务参照领导提供的浅色后台截图与产品需求，实现了“如果 内容后台”（Publisher Workbench）的桌面与移动端响应式页面，优先跑通编剧与运营人员“编辑人物与世界 → 草稿比对与未保存提示 → 关联引用安全检查 → 试演/发布诚实接通”的关键流程。

### 核心界面实现
1. **左侧世界列表栏与新建入口**：
   - 顶部品牌标识：“如果 内容后台 · 世界创作与发布管理”；
   - “我的世界”列表，支持查看草稿版本号、发布状态标识及选中高亮切换；
   - 底部固定“+ 新建世界”交互模态框，支持设定新作品标题与开场初始化。
2. **顶部作品操作区**：
   - 面包屑导航与作品主标题；
   - 草稿状态标签（如“草稿 r3”、“已发布 v1”）；
   - 操作按钮组：“保存草稿”（根据 dirty 状态与权限控制）、“检查”（触发规则一致性检查）、“试演”（沙盒测试入口）、“发布”（上架入口）。
3. **主导航三 Tab**：
   - `世界设定`：作品基本信息（标题、Hook、详细说明、体验注意）、主角设定（公开身份、开场现实处境）、开场设定与故事时间、故事舞台（地点与隐藏背景）。
   - `人物`：中间人物列表 + 右侧五区精细表单。
   - `剧情`：已发生客观历史事实、剧情候选节点（待满足条件触发的可选事件，非必经任务）。
4. **人物编辑五区表单（重点交付）**：
   - **区 1：名字与身份**：人物姓名、身份与年龄、外貌与形象说明、头像更换占位、稳定标识（`key` 保持不可变，重命名不改变内部引用键）。
   - **区 2：与主角的初始关系**：开场双方既有认知关系（如“从小一起长大的邻家朋友，无血缘关系”）。
   - **区 3：性格与说话方式**：语言风格与口吻约束、可折叠深度经历与成长背景。
   - **区 4：在乎什么、眼前想法**：双重内在动机解析与无损往返存储（长期核心价值观 vs 开场最先想达成的想法）。
   - **区 5：关系、知情范围与底线**：已知信息差设定（初始知情事实引用）与行为禁忌底线。

---

## 2. 关键业务机制与边界防护

1. **人物标识稳定与同名防串**：
   - 修改人物显示名称不会修改底层唯一 `key`；
   - 新增人物通过 `generateActorKey` 严格生成符合 `/^[a-z][a-z0-9_]{0,31}$/` 的唯一安全键。
2. **删除人物前强校验关联引用**：
   - `checkActorDeletionSafety` 遍历检查人际关系（`relationships`）、初始对话（`phone.messages`）、日历约定（`phone.invitations`）、历史事实（`history`）和剧情候选节点（`candidates`）；
   - 若存在引用，弹出二次确认模态窗，逐条列出受影响引用内容，避免误删导致剧情断层；无引用时方可安全移除。
3. **草稿保留与脏状态防护**：
   - `isDraftDirty` 严格比对已加载草稿与当前工作草稿（含标题与内容深度 JSON 比较）；
   - 切换作品前校验未保存草稿并弹窗提醒确认；
   - 网络异常或校验失败时保留本地草稿内容，不回退、不丢失输入；
   - 无编辑变更或保存成功前，不假装显示“已保存”。
4. **诚实状态与权限反馈**：
   - 当 `onTrial` 或 `onPublish` 暂未提供真实回调时，按钮明确渲染为“试演 (未接通)”与“发布 (未接通)”，并辅以明确 Tooltip 说明，坚决不用 setTimeout 或假数据冒充成功；
   - 检查未通过时，顶部横幅清晰列出规范问题详情（路径与错误码）及缺失能力项。
5. **开发预览安全边界**：
   - 预览路由 `src/app/ui-preview/publisher/page.tsx` 严格限制：当 `process.env.NODE_ENV !== 'development'` 时直接执行 `notFound()`，确保生产环境绝对不可访问。

---

## 3. 交付文件清单

| 文件路径 | 职责与变更说明 |
|---|---|
| `src/features/publisher/publisher-editor.ts` | 纯领域编辑逻辑：五区人物表单映射、双重动机解析/组装、唯一 key 生成、删除安全检查、脏状态检测、世界设定与剧情数据提取 |
| `src/features/publisher/publisher-workbench.module.css` | 浅色后台设计规范样式：三栏弹性布局、响应式断点（1440px 桌面 / 390px 移动）、无障碍 44px 点击区域 |
| `src/features/publisher/publisher-workbench.tsx` | 后台核心组件：遵循 `PublisherWorkbenchProps` 契约，支持三 Tab、人物五区表单、未保存提醒、安全删除模态框 |
| `src/app/ui-preview/publisher/page.tsx` | 本地开发预览入口：严格生产 404 防护 |
| `src/app/ui-preview/publisher/preview-app.tsx` | 预览容器：装载青青、老周、林白语等真实示例数据，模拟保存、检查与试演交互 |
| `tests/publisher-editor.test.ts` | 领域层专属单元测试（8 项测试）：表单解析、双重动机、标识不可变性、删除安全引用检测、脏状态比对 |
| `tests/publisher-workbench.test.ts` | 组件专属单元测试（4 项测试）：三栏渲染、五区表单、只读权限禁用、检查未通过问题清单、未接通状态 |
| `docs/task-reports/WORLD-PUBLISH-01D-PEOPLE-UI.md` | 本交付报告 |

---

## 4. 验证结果与证据记录

### 4.1 架构边界与类型检查
- **边界检查**：
  ```bash
  npm run check:boundaries
  # Output: Module boundary checks passed (346 files).
  ```
- **TypeScript 严格类型检查**：
  ```bash
  npm run typecheck
  # Output: tsc --noEmit passed with 0 errors.
  ```

### 4.2 专属单元测试
- **测试命令**：
  ```bash
  node --experimental-strip-types --test tests/publisher-editor.test.ts tests/publisher-workbench.test.ts
  ```
- **测试结果**：12 项测试全部通过，耗时约 657ms。
  - ✔ `parseActorEditor accurately extracts the 5 form sections`
  - ✔ `splitMotivation and joinMotivation handle dual formats and raw text lossless`
  - ✔ `updateActorInContent preserves immutable actor key and saves unedited fields`
  - ✔ `generateActorKey produces safe unique keys conforming to /^[a-z][a-z0-9_]{0,31}$/`
  - ✔ `checkActorDeletionSafety flags all references across relationships, messages, invitations, history, candidates`
  - ✔ `parseWorldSettings and updateWorldSettingsInContent preserve original untouched properties`
  - ✔ `parsePlotData extracts history events and candidate plot points`
  - ✔ `isDraftDirty detects changes in title and draft content`
  - ✔ `PublisherWorkbench renders complete light-theme 3-column UI`
  - ✔ `PublisherWorkbench honestly indicates unhooked callbacks when onTrial or onPublish omitted`
  - ✔ `PublisherWorkbench disables edit controls when session.canEdit is false`
  - ✔ `PublisherWorkbench displays check failure issues accurately`

### 4.3 生产构建验证
- **构建命令**：`npm run build`
- **构建耗时**：16.3s 成功构建；
- **路由扫描**：包含 `/ui-preview/publisher` 动态路由，所有 23 个静态页面与动态路由均正常生成。

### 4.4 跨端响应式与真机视口实测（通过 ego-browser 自动化实测并留存截图）
实测端口：本地独立端口 `3278`（测试前验证端口空闲，实测后已释放）。
留存截图位置：
1. **电脑端 1440px 视口**：
   - 路径：`scratch/publisher-workbench-desktop-1440.png`
   - 表现：三栏经典布局清晰展现，左栏世界列表、中栏人物导航、右栏五区表单布局稳定。
2. **世界设定 Tab 视口**：
   - 路径：`scratch/publisher-workbench-settings-tab.png`
   - 表现：作品基本信息、主角设定、故事时间与舞台表单完整呈现。
3. **剧情 Tab 视口**：
   - 路径：`scratch/publisher-workbench-plot-tab.png`
   - 表现：已发生客观历史与剧情候选节点清晰排列，左下角新建世界入口固定对齐。
4. **人物删除引用拦截弹窗**：
   - 路径：`scratch/publisher-workbench-safe-deletion-dialog.png`
   - 表现：点击删除被引用人物（青青）时，拦截模态框准确罗列 3 处关联引用并提供明确指引。
5. **手机端 390x844px 视口（长屏）**：
   - 路径：`scratch/publisher-workbench-mobile-390-tall.png`
   - 表现：自适应垂直流动排列，左侧世界列表与人物列表均折叠为平滑横向滚动胶囊，触控区域均 ≥ 44px。
6. **手机端 390x667px 视口（短屏）**：
   - 路径：`scratch/publisher-workbench-mobile-390-short.png`
   - 表现：短屏无任何溢出或重叠，表单各输入区响应正常。

---

## 5. 待接通项与后续集成说明

- **真实服务端回调接通**：当前组件严格面向 `src/contracts/publisher-workbench.ts`，待根 Agent / 后端 Agent 在接入正式认证路由后，将 `onSaveDraft`、`onCheck`、`onTrial`、`onPublish` 挂接至实际 API（如 `/api/v1/setting-drafts` 等）；
- **版本历史与差异对比**：按照任务要求，版本历史、差异对比和回滚界面后置，当前界面已保留草稿版本元数据，后续可平滑扩展。
