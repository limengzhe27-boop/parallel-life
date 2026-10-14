# WRITER-LIBRARY-28-E · 单一事件库

- 负责人：`/root/history_media_ui`
- 工作树：`/Users/limengzhe/.codex/worktrees/history-media-ui/人生剧本`
- 基线：`90ec127`
- 状态：待集成人验收；本工作树不推送或部署。

## 交付

剧情页只呈现一份事件库，移除下方重复的“精细安排”事件编辑入口。每张事件卡直接显示导入的标题、完整正文与场景。发生前提、涉及人物、开场指定及旧安排均在卡片内默认收起；前提可按事实、前序事件、指定结果、地点或原稿明确时间添加。编辑事件正文时兼容现有 `script`/`editorialIntent` 双字段，其他原字段包括前提、阶段、互斥、结果替代、人物、开场引用均原样保留。没有将可选事件自动设为必发，也没有预设某个剧本。

修改文件：

- `src/features/publisher/publisher-plot-editor.tsx`
- `src/features/publisher/publisher-script-library-editor.tsx`
- `src/features/publisher/publisher-script-library.module.css`
- `tests/publisher-plot-ui.test.ts`

## 验证与接续

- `npm run typecheck` 通过。
- 7 项聚焦 UI 测试通过：单入口与完整导入、默认折叠、修改无数据损失、添加前提、开场共用候选、只读与损坏数据保护、长文本与转义。
- `npm run check`：2383/2387 通过；4 项失败均为工作树本地数据库 `pl_admin`/`pl_app` 认证失败，分别发生在 `character-image-flow` 和 `rls-tenant-isolation`，非本轮业务断言。
- `npm run build` 在最终小屏样式修改后通过。
- 本地开发预览 `/ui-preview/publisher` 在桌面和 390px 实看；事件标题、导入正文、添加按钮无遮挡，390px 标题不再被按钮挤断。截图：`/tmp/writer-library28-desktop.png`、`/tmp/writer-library28-mobile-final.png`（临时证据）。预览为夹具，不替代真实保存/试演/发布验收。
- 无模型、真实数据库、生产数据和公共契约变更。

集成人下一步：合并提交后复跑构建和真实保存/发布路径；旧阶段、独立条件、互斥/时间安排仍保存在草稿中，本轮只把已存在的复杂安排作为可读摘要展示，若要继续图形化编辑须另立任务。场景图与地点入口由并行任务处理。

## 过程

- 2026-10-15：核对上下两处都映射同一 `candidates`，确定重复入口；收拢为单入口并将事件选填内容移入卡片。
- 2026-10-15：补齐边界保护、聚焦回归测试、构建与桌面/390px 界面检查，交集成人待验收。
