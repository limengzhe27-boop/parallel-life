# HOME-EIGHT-10 — 八入口单屏首页

- 执行者：`/root/scene_input_experience` / `home-eight-10-20261027`
- 基线：`82512596`；独立工作树 `.local/worktrees/home-eight-10`，分支 `codex/home-eight-10`。
- 状态：待 root 集成与实际手机/PC 布局验收；无模型、原档、端口、生产写入。

## 实现

1. `home-app-layout.ts` 只定义呈现顺序：桌面第一排日历/相册/备忘录，第二排记录/身份；底栏微信/现场/地图。身份仍打开原 timeline panel，记录仍打开原 records App；不改 navigation 或 controller。
2. `PhoneShell` 统一拥有八个入口，自定义首页和默认首页共用，避免自定义首页漏图标。原通知角标继续按 App 绑定；现场图标只走原场景入口。
3. `PhoneDesktop` 由大日历、相册、任务卡收成返回/切换人生、当前世界身份、时间、真实未读摘要。记录、身份、相册和日历 App 的内容未删除。删除旧 widget 渲染和样式，减少约六百行。
4. 首页专属容器禁用滚动并使用有界两排图标，底栏三列；44–58px 图标、至少66px入口高度、12px标签；短屏压缩间距。App 内原滚动规则保持。

## 必要验证

- `node --experimental-strip-types --test tests/home-eight10.test.ts tests/notes-records-ui.test.ts tests/phone-visual-ui.test.ts`：21/21 通过。
- `npm run typecheck`：0 错误。
- `git diff --check`：通过。
- SSR 明确证明自定义/默认首页均只有八入口、顺序3+2/3、不额外引入朋友圈。
- 只替换旧 notes-records-ui 的首页大卡单项断言；Records App 其余16项内容/隐私/导航断言保留。
- `scene-home08.test.ts` 已完整交 root：root 修改现场直入时一起更新其中旧六入口断言，本任务未碰该文件。

## 集成后验收接续

root 统一构建启动，在320×568、390×844与PC窄幅手机中检查单屏无横纵滚动、八入口可点、身份/记录正常、App内部继续滚动。SSR 不作为像素布局验收证据。未在执行者工作树重复build。
