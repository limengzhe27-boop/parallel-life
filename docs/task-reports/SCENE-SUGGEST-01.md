# SCENE-SUGGEST-01 · 现场行动灵感推荐与剧情推进破局交付报告

负责人：codex-map-realistic-01；
提交哈希：`95caedb`（已推送至 `origin/main`）；
分支：`codex/map-realistic-01`；
在线生产域名：`https://parallel-life-nu.vercel.app`。

---

## 1. 背景与目标

针对用户提出的“让用户可以在我们项目中玩起来、破除空白输入框不知道该说什么”的核心痛点：
在现场界面（Scene Panel）中，根据当前现场关注的重要事项（Matters）与上下文，动态生成具有不同戏剧倾向的行动建议气泡（Action Prompt Bubbles），实现一键填入与操作指引。

---

## 2. 具体实现清单

### (1) 动态生成情境行动建议 (`src/features/phone/scenes/scene-panel.tsx`)
- 提取现场未完成目标事项（如 `交付已修缮的R17`、`林悦家晚饭` 等）：
  - **有明确目标时**，派发 3 种戏剧冲突倾向的建议：
    1. **正面推进**：`推进「事项名称」：主动说明来意与最新情况`
    2. **试探底线**：`试探对方对「事项名称」的真实态度`
    3. **迂回观察**：`暂时按下不表，先闲聊观察周围动静`
  - **无特定事项或自由场景时**，派发破局通用灵感：
    - `诚恳打个招呼，观察现场气氛`
    - `直奔主题，提出眼下最紧要的问题`
    - `保持沉默，静观其变`

### (2) 交互与自适应样式 (`src/features/phone/scenes/scenes.module.css`)
- 输入框上方新增横向可滑动的 `.suggestionRow`，避免占用过多垂直视口；
- 建议胶囊 `.suggestionPill` 采用高透卡片与微光悬停动效；
- 点击后自动填充至 `textarea`，并同步更新会话暂存草稿（`sessionStorage`），用户可直接点击“发送”或在填入文本基础上进行二次修改。

---

## 3. 验证与工程证据

1. **模块与边界检查**：
   - `npm run check:boundaries`：398 个模块文件 100% 通过；
2. **TypeScript 检查**：
   - `npm run typecheck`：tsc --noEmit 零错误通过；
3. **回归与单元测试**：
   - `node --test tests/phone-map.test.ts`：18 项单测全部绿灯通过；
4. **生产打包构建**：
   - `npm run build`：Next.js 生产 Webpack 构建成功，24 个静态与动态路由生成无报错；
5. **代码提交与推送**：
   - 提交 `95caedb`，已推送并合入 `origin/main`；
   - 生产域名 `https://parallel-life-nu.vercel.app/api/health` 与 `/possibilities` 状态 200 OK。
