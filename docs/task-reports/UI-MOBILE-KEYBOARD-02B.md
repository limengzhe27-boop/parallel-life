# UI-MOBILE-KEYBOARD-02B

负责人 codex-ui-keyboard02b-01a11a84-20261012；nar-03 工作树，codex/ui-keyboard-02b，基线 4b4dd99。集成人 I。状态：待集成验收，尚未部署。

## 诊断与范围

截图为 iOS 微信键盘打开，聊天顶部被移走、输入下方露出 stage 黑底。源码 AppViewport 仅使用 visualViewport.height，不处理 offsetTop，也不监听其 scroll。世界外壳在文档流内，无法跟随键盘引起的可见区域平移。这是明确缺口；具体微信机型效果仍需真机确认。

AppViewport 统一维护 height/top，监听 resize 和 visualViewport.scroll；手机 ≤600px 时三种主框架固定到可见区 top。内部列表仍滚动，不 scrollTo、不额外扣键盘高度。缩放时不覆盖原几何，保留用户 pinch zoom。CSS 仅 viewport 与键盘空间范围。现有手机输入已有防缩放 16px 规则，本次未修改字号。

独立浏览器发现极短 220px 可见区中快捷按钮/假手势条挤出输入，补充 ≤520px 容器且聊天聚焦时隐藏两者，以及压缩消息内边距。最终两项 CSS 补充需 I 集成浏览器复验；不把此前结果冒称最终真机通过。

## 验证

- 新 viewport 纯测 5/5：height+offset、不双扣、恢复、极短屏、非法瞬时测量、pinch 不误判。
- npm run check：831 项，827 通过、4 既有数据库测试失败（本任务未启动 55471 PostgreSQL，sandbox EPERM）。边界检查与类型检查通过；不记完整 check 绿。无 SQL/权限/队列修改。
- Ego 143，独立 HTTP 3267，开发合成 world 预览，无真实用户/模型写入。390×844 shell [0,844]；聚焦输入计算字号16px。模拟 height360/offsetTop180 后 shell [180,540]，输入 [457,499]，文档 scrollY0。模拟 height220/offset90 后 shell [90,310]，输入 bottom348.5，触发上述后续 CSS 修复。
- 重新载入恢复 shell [0,844]/top0；PC1440×1000 shell420×880/y18/static，桌面原布局保留。重新载入恢复不是同页真机键盘关闭验收。Ego空间已 finish，3267停止；最终 CSS 短屏及同页收键盘由 I 统一复验。
- npm run build 成功，exit 0。

0 付费模型、0 生图、0 数据库/生产写、0 部署；旧18预算closed，不沿用余量。Ego提示有可选更新，未执行升级。源码冻结交 I，统一集成/生产READY与公网验收才算交付；真机微信仍待用户验证。
