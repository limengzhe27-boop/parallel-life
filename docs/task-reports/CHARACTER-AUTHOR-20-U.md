# CHARACTER-AUTHOR-20-U · 人物页独立生成入口

负责人：`author_ui20`。独立工作树：`/Users/limengzhe/.codex/worktrees/character-author20-u/人生剧本`。基线：正式 `origin/main` 的 `8367add`。本批只改人物微信试聊局部组件、样式和专属测试。

## 交付

- 保留「AI 补历史聊天」和「AI 补朋友圈」两个独立入口；移除「一起补齐」。点击后直接调用对应 `onGenerate('history' | 'moments')`，界面不打开导入或核对弹窗。
- `generatingFocus` 标明当前等待的项目；等待期间两个生成按钮均不可重复点击，并显示对应的进度词。`generationMessage` 与 `generationError` 分别显示完成或失败反馈，均由真实调用方提供，不伪造已生成内容。
- 空态说明两项可以分别补充，现有内容由后端保留；实际人物微信试聊入口与独立存档未改变。

## 验证和交接

- 专属 3 项 UI 测试覆盖独立回调、无合并按钮、等待防重复、完成与失败反馈及私密字段不展示。相关人物预览/真实手机旧回归共 14 项通过，TypeScript 通过。
- 完整 `npm run check` 边界与类型通过，单测 2290 通过、4 项因独立树没有匹配的本地 PostgreSQL 凭据而报 `28P01`；这 4 项是数据库权限专项，与本组件无关。独立生产构建通过。根集成人需在其数据库环境补跑全检。
- 本组件只提供直接动作与真实状态槽位；根集成人需将 `generatingFocus`、`generationMessage`、`generationError` 接到实际按需生成请求，并核验原有记录保留。未调用模型、未创建试演、未发布或部署。
