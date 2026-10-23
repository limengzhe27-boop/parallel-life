# 44-200-STICKER-UI

状态：已集成验收（root，2026-10-24）。root-sticker-ui200 实现；root 在 main 完成生产浏览器与刷新复验。独立 `.local/worktrees/sticker-ui200` / `codex/sticker-ui200`；基线6ef53179，依赖catalog744ac85e（本树cherry-pick58cbc5e3）。

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

## 本地浏览器补验（2026-10-23）

Ego空间432，独立树3307，临时development-only合成fixture复用真实MessagesApp/PhoneAppsProvider；未加载env、0 API请求、0模型、0生产。空间已finish，本地服务已停止，临时route已删除。

- 手机390×844：图文同时显示，纯图透明；面板20图，发送“我裂开了”后产生1条用户图消息，已有“保留草稿”不变。
- PC1440×900：窄幅居中、图片面板正常，无横向溢出。
- 短屏390×500：Emoji切换与插入成功，draft“还没发送的草稿😊”。
- 主动将fixture图src改为不存在路径，真实onError显示“[赞 · 图片未加载]”，其他文字、已发图和草稿均保留。
- 发现图片加载前无高度可能导致滚动落点偏移，补固定160px显示盒+contain（不裁剪/不拉伸），手机发送后imageBottom729.75 < logBottom747.75，完整可见。缩略图立即加载，正文仍可懒加载且不阻塞文字。
- 截图已逐张实际查看：assets/44-200-sticker-ui/{mobile-panel,mobile-sent-final,desktop-panel,desktop-failure}.png。

此为浏览器界面及回调fixture验收，**不是数据库保存、刷新恢复或真实NPC选图验收**。后者仍由root。

## root 生产补验（2026-10-24）

生产 `81afd18c`，正式域名，Ego 空间 438；只读打开现有 `渣男体验`，不发送、不调用模型。

- 李之之私聊面板：真实 390×844 手机视口与 1440×1000 PC 视口均正常打开；DOM 计数 **80** 个 `发送表情：*` 按钮、**80** 张图片 `complete && naturalWidth>0`，**0** 张加载失败。
- 截图逐张查看：`.local/44-207-sticker-mobile.png`、`.local/44-207-sticker-desktop.png`。手机 4 列、PC 居中窄幅，均无横向溢出；面板内部滚动，未把 80 张压扁。
- 微信会话列表预览已显示 `[加油]`（李之之 sticker-only 消息），与 `notification-projection` 的 `[表情]` 摘要一致。
- 重新加载世界、重新进入李之之私聊后，历史文字“嘿，今天感觉怎么样？”与 `jiayou` 纯表情仍为两条独立消息；世界 version 前后均为 **280**，没有因这次只读复验新增提交或模型调用。
- `tests/sticker-ui200.test.ts` 4/4，新增 80 个按钮/80 张图片断言；`npm run check` **3992/3992**。

仍未在本轮重跑的真实网络中断发送、失败后重试、群聊表情入口：发送失败/unknown/重试状态由 `tests/chat-send-error.test.ts` 覆盖，未冒充真实网络故障旅程；群聊契约仍不承载 stickerId。
