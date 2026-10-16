# UI-MOBILE-KEYBOARD-02B

## 集成复验接续

I 最终已集成3354ec7为aef1d47，并在同一Ego142私聊聚焦复验：height220/offset90 shell [90,310]，input [240.5,282.5]，within=true，快捷按钮 display:none；删除mock并blur模拟收键盘，同页shell恢复 [0,844]。保留下方首次失败作为追溯。此为Chromium模拟，不能代替iPhone微信真机验收。源码范围已释放，等待I完整批次check/build/READY与公网验证；B不再改CSS，不新增浏览器或调用。

I 的 Ego142 极短屏 height220/offset90 聚焦复验：shell [90,310]、input [290.5,332.5]，快捷按钮仍 display:flex，不能通过。静态确认 messages.tsx 的快捷容器写有 inline display:flex，普通 CSS display:none 被覆盖。本次仅给既有键盘收起规则添加 !important 覆盖已存在 inline 布局；gesture 未写 inline，不改其规则。I 继续最终短屏/同页恢复复验，B不新建已结束的浏览器空间，0模型/生产写。

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

## 正式发布验收 · 2026-10-12

业务8c1b1b2，production 49udqtqr4/dpl_BZefRTayTxqx2kRHDA6gQkbzUgZK Ready，正式域名已切换；843check/331边界/type0/build0，41生产迁移一致无SQL。公网/api/health与possibilities200、19SVG200、dev preview404；390/1440实际7卡均同结构及体验说明、可见封面loaded/无横溢出。两本地paused官方夹具去重及6头像、Phone/outer220-offset90输入可见同页恢复844已过；非真机微信/审美满意/真实模型链验收。0模型图及生产世界创建，PG55452/HTTP3265等已停，Ego142 finish。

公网首次脚本误用/api/v1/health得到404，按实际/api/health复验200；浏览器首次等待不存在的data-life-card属性超时，读取实际article确认7张卡片结构/说明一致。上述是验收脚本定位错误，不抹掉记录、不算业务故障。公网已有资料仅只读，不披露内容，未发送消息、进入新世界或调用模型。

用户仍需验收真实微信键盘展开/收起与新视觉；个人分支保留自己的封面，真实上传头像/自定义壁纸优先。插画不冒充新照片，旧世界历史不回填。旧真实模型限量账本已关闭，SCENE-MODEL-STABILITY-01等原任务未完成。
