# 44-197 消息横幅贴近手机状态栏、微信顶栏去除重复搜索图标

日期：2026-10-23
负责人：`dsh-banner197-20261023`

## 用户反馈

- 消息横幅现在出现在屏幕中上部，不在手机顶部。
- 期望：横幅占用微信顶栏 / 搜索区域，紧贴手机状态栏时间下方。
- 微信顶栏“微信 (N) 🔍 ⊕”中的 🔍 去掉，列表内搜索框保留。

## 改动

1. `src/features/phone/phone-shell.tsx`
   - 把 `StatusBar` 和消息横幅一起包进 `statusLayer`。
   - 横幅改为相对状态栏层定位，不再依赖固定的 152px 顶部偏移。
2. `src/features/phone/phone.module.css`
   - 新增 `.statusLayer { position: relative; flex-shrink: 0; }`。
   - `.banner` 的 `top` 改为 `calc(100% + 8px)`，即状态栏底部下方 8px。
   - 删除原先按“顶栏 + 搜索栏”累计的 152px / 176px 偏移和 notice 专用偏移。
   - 短屏状态栏变为 50px 时，横幅自动跟随，不需要单独写 50px 规则。
3. `src/features/phone/apps/messages.tsx`
   - 删除微信顶栏的搜索按钮（🔍）及其无效的 `wechat-search-input` 聚焦代码。
   - 保留“⊕ 更多功能”和聊天 / 通讯录列表内的真实搜索框。
4. `tests/phone-notification-banner.test.ts`
   - 覆盖状态栏层结构与横幅 `calc(100% + 8px)` 定位。
   - 覆盖微信顶栏保留 ⊕、移除 🔍 和无效搜索聚焦代码。

## 验证

- 定向测试：`node --experimental-strip-types --test tests/phone-notification-banner.test.ts`，2/2 通过。
- `npm run typecheck`：通过。
- `npm run check`：**3950/3950** 通过。
- `npm run build`：通过，31 个页面生成成功。
- 本地手机宽度 390px：
  - 390×844，带预览说明条：状态栏底部 90，横幅顶部 98，间距 8px。
  - 390×844，移除说明条：状态栏底部 58，横幅顶部 66，间距 8px。
  - 390×500 短屏：状态栏高度 50，状态栏底部 82，横幅顶部 90，间距 8px。
- 本地桌面 1440×1000：手机宽 460，状态栏底部 90，横幅顶部 98，间距 8px。
- 截图：
  - [390×844 带说明条](assets/44-197-banner-390.png)
  - [390×844 无说明条](assets/44-197-banner-no-notice-390.png)
  - [390×500 短屏](assets/44-197-banner-390x500.png)
  - [1440×1000 桌面](assets/44-197-banner-pc-1440.png)

## 公网部署

- 业务提交 `05584764`，Vercel `parallel-world` 部署
  `dpl_8QNknTWHcujKv2zxBGFKvYBFtZu9` READY。
- `https://parallel-world-eosin.vercel.app/api/health` 返回 200。
- 公网 CSS chunk `22c1f93f47bb7e6d.css` 已包含
  `.banner{...top:calc(100% + 8px)...}` 和 `statusLayer`，旧的 152px / 176px
  偏移已消失。
- 公网 JS chunk `7480-5d2d34b8f11c33a8.js` 的微信顶栏只剩“更多功能”/⊕，
  不含 `wechat-search-input`；列表内搜索框代码保留。
- 本次未调用真实模型、未写生产世界、未新增 SQL。

## 边界

- 只调整横幅位置和微信顶栏图标，不改变横幅到达、6 秒消失、点击打开、锁屏通知逻辑。
- 横幅的显示仍由真实新通知触发；本次没有为了截图伪造生产消息。
