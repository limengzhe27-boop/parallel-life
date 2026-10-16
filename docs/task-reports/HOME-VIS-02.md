# HOME-VIS-02 · 统一 iPhone 视觉体系、图标/层级/玻璃对比与分支授权壁纸

2026-10-11，执行人/集成人 codex-homevis02-i-01a11a84-20261011。
基于主干基线 7dc1fb0，使用独立工作树 `.local/worktrees/home-vis-02`。

## 需求与设计实现

本任务完成 iPhone 拟态系统核心主屏幕与视觉体系的统一收敛与精致升级（HOME-VIS-02）：
1. **统一 iPhone 视觉体系与玻璃材质对比**：
   - 首页身份卡片（`.identity`）与故事时间条（`.storyTime`）采用高质感 iOS 毛玻璃材质（`rgba(255, 255, 255, 0.14)`、`backdrop-filter: blur(20px)` 与微微发光的反光外边框 `border: 1px solid rgba(255, 255, 255, 0.22)`），字体与字重层次清晰；
   - 日历小组件与相册小组件（`.widgets > button`）加入微光反光边框与动态悬浮立体投影；
   - 首页眼下事项卡（`.record`）采用深色高透毛玻璃质感（`rgba(23, 35, 42, 0.76)`、`backdrop-filter: blur(24px)`），与浅色小组件形成鲜明呼吸感层级对比；
   - 现场（`scenes`）与身份轨迹（`timeline`）工具图标补全专属拟态渐变背景与微光反光边框，触感交互反馈完备；
   - 锁屏通知（`.notification`）升级为超精致浅色毛玻璃卡片（`rgba(255, 255, 255, 0.78)`、`backdrop-filter: blur(24px)`），时钟时间（`.lockClock`）提升对比度与立体阴影，解锁条（`.unlock`）及灵动底指示条提升通透质感。
2. **Dock 栏 5-App 严谨布局与零死图标（No dead icons）**：
   - 彻底解决由于 4 列网格导致第 5 个应用（地图 `map`）意外掉入第二行的问题，将 `.dock` 统一重构为 5 列网格（`grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px;`）；
   - 补齐 `.map` 专属清爽淡青绿地图色彩背景（`background: linear-gradient(145deg, #eef7ed, #d6ebd9); color: #27522e;`）；
   - Dock 栏包含 5 大核心功能 App：微信（`messages`）、日历（`calendar`）、相册（`photos`）、备忘录（`notes`）、地图（`map`），均有完整功能与页面支持，严禁摆设任何假功能、无响应图标或占位死图标。
3. **分支专属授权壁纸映射与隐私隔离**：
   - 创建 `src/features/phone/wallpaper.ts`，实现 `resolveDefaultWallpaper(title)`：
     - 县城/摩托/车间分支默认映射至经授权的原创插画 `/art/open-door.webp`；
     - 独生女/女儿/草地/归来分支默认映射至经授权的原创插画 `/art/meadow-door.webp`；
     - 其他分支及默认回退至通用授权摄影壁纸 `/art/first-window.webp`；
     - 严格遵守用户真实照片隐私隔离原则，绝不使用用户或朋友真实私密照片充当虚构壁纸，同时保留本地 `localStorage` 自定义覆盖能力。
4. **双端及紧凑屏自适应**：
   - 390×844（标准 iPhone）：比例协调，Dock 居中饱满，毛玻璃阴影细腻；
   - 390×500（紧凑屏幕/键盘唤起/测试容器）：自适应缩放 Dock 应用图标（44px/38px）、自适应调整日历字体大小（防止超大字体溢出），隐藏冗余副标题，保持页面干净不溢出；
   - 1440×1000（电脑端桌面）：iPhone 模拟机身居中保持 420px 精致视口，与外层页面和谐共存。

## 变更文件范围

- `src/features/phone/wallpaper.ts`：新增分支授权壁纸映射函数 `resolveDefaultWallpaper` 与授权壁纸常量列表。
- `src/features/phone/world-phone-app.tsx`：引入并使用 `resolveDefaultWallpaper`，保持分支壁纸响应式更新与本地持久化覆盖。
- `src/features/phone/phone.module.css`：
  - 重构 `.dock` 为 5 列网格毛玻璃底栏；
  - 增加 `.map` 应用图标渐变色样式；
  - 升级 `.notification` 毛玻璃边框与材质；
  - 增强 `.lockClock`、`.unlock` 与底部手势指示条的立体对比度；
  - 在 `@container (max-height: 600px)`、`@container (max-height: 520px)` 与 `@container (max-width: 350px)` 中细化图标、日历数字与外边距比例。
- `src/features/phone/phone-desktop.tsx`：为工具按钮图标应用专属分类样式（`.scenes` 与 `.timeline`）。
- `src/features/phone/phone-desktop.module.css`：
  - 升级 `.identity` 与 `.storyTime` 为精致 iOS 毛玻璃质感；
  - 升级 `.widgets > button` 浮动阴影与交互；
  - 升级 `.record` 为深色通透毛玻璃；
  - 补充 `.scenes` 图标专属深绿雅致渐变背景与高光反光边框。
- `tests/phone-visual-ui.test.ts`：新增视觉与壁纸自动化测试，验证分支映射准确性与 Dock 栏 5-App 零死图标完整性。

## 验证证据

1. **架构边界检查 (`npm run check:boundaries`)**：
   - 315 个文件全部通过，无违规模块边界。
2. **TypeScript 类型检查 (`npm run typecheck`)**：
   - 零类型错误。
3. **单元测试 (`npm test`)**：
   - 671/671 全部通过（包含新增 `tests/phone-visual-ui.test.ts`）。
4. **真实数据库集成测试 (`npm run test:db`)**：
   - 209/209 全部通过。
5. **生产环境构建 (`npm run build`)**：
   - Next.js 16.3.5 生产构建顺利通过，所有静态与动态路由生成完毕。
