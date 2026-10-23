# 44-200-STICKER-UI

状态：待集成验收。root-sticker-ui200；独立 `.local/worktrees/sticker-ui200` / `codex/sticker-ui200`；基线6ef53179，依赖catalog744ac85e（本树cherry-pick58cbc5e3）。

## 实现
- 私聊现有表情按钮打开图片表情/Emoji面板。图片目录复用SELECTABLE_STICKERS，真实缩略图、名称、44px触控及短屏滚动。
- 图片点击直接复用run + actions.sendMessage发送 `[[sticker:id]]`；保留输入框原草稿，使用原command/retry/optimistic链，不走上传或生图。
- 文字与stickerId共存时同时渲染；合法旧完整marker隐藏为纯图；纯图无空文字气泡。图像contain不裁切，失败显示名称标签；图加载不阻塞文字。
- 没有新增运行时字段、SQL、模型调用或情绪判断；未改群聊/调度/协议。

## 文件
- src/features/phone/apps/messages.tsx：原入口接入发送及渲染。
- sticker-content.ts：旧marker与caption投影。
- sticker-ui.tsx / sticker-ui.module.css：可复用图像/面板。
- tests/sticker-ui200.test.ts：SSR与内容语义验证。

## 必要验证
- typecheck通过。
- boundaries721文件通过。
- 新UI3项 + 原stickers3项：6/6通过。
- 仅静态渲染/内容验证，不冒充真实浏览器点击、持久化或真实模型验收。root统一check/build/手机PC/原存档端到端；本子任务不重复执行全量构建或部署。

## 剩余边界
- 60候选素材未进生产目录；当前功能显示catalog现有20图，由素材任务独立报告许可。
- 群聊目前GroupChat只渲染text，当前群契约未承载stickerId；本批只接通已有私聊，不宣称群聊同能力。
- 服务端marker语义/保存、刷新、重试、通知由root统一验收。本任务不新增第二套持久化实现。
- 浏览器真实交互（失败图片、手机/PC短屏、点击发送）未由本子任务执行。
