# 内部世界发布后台 · 设计规范

2026-10-12；WORLD-PUBLISH-01D-DESIGN。根已接受01D-PLAN的页面方向；本文件将其细化为下一轮UI可用的设计规格，**尚未实现的后台**不能按本文件截图或功能宣称上线。只服务内部编辑/审核/发布人员。字段/API/员工身份与发布权限由根统一批准；B的内容合同未获根批准前不写前端代码。

消费者仍为窄幅聊聊/分支/我的与既有世界手机。宽屏只用于内部工作台，不更改共享DESIGN.md、PhoneShell或消费者导航。本文CSS均为文档中的局部样式规格，不是运行源码。

## 1. Visual Theme & Atmosphere

深蓝、清楚、可对照、有依据。工作台以确认内容、修复问题和审阅版本为中心，阅读长稿时保持安静，保存与发布状态始终容易找到。

沿用VIS-01深海蓝/蓝色操作与Noto Sans SC；复用现有Button、Icon、Modal、Notice的语义和交互，后台以专属类/CSS Module适配密度和宽度。主标题不加渐变或投影，正文无装饰。只读稿件有边界和来源，不能借灰色字体把“未支持”藏起来。

交互档位 **L1，CSS only**，沿现有DESIGN已采用的轻过渡；无新动画依赖、不做滚动劫持/视差/3D。根已认可结构，本轮不重复请求结构或档位确认。

## 2. Color Palette & Roles

变量限定后台根元素，不能改`:root`或通过body覆盖世界手机。以下值来自当前outer-ui.css和globals.css；右侧PhoneShell维持其自己的样式范围。

```css
.publish-admin {
  --admin-bg: #081426;
  --admin-bg-rgb: 8, 20, 38;
  --admin-surface: #10233d;
  --admin-surface-rgb: 16, 35, 61;
  --admin-alt: #152b46;
  --admin-hover: #1c3655;
  --admin-border: #294363;
  --admin-border-hover: #5b97ff;
  --admin-text: #f3f7ff;
  --admin-secondary: #b1c2d9;
  --admin-muted: #91a8c4;
  --admin-accent: #347bfa;
  --admin-accent-rgb: 52, 123, 250;
  --admin-accent-hover: #5b97ff;
  --admin-action-ink: #081426;
  --admin-focus: #9cc6ff;
  --admin-success: #95d5bb;
  --admin-error: #ffb4ab;
  --admin-warning: #edc58b;
  --admin-shadow-rgb: 3, 10, 22;
  --admin-clear: transparent;
  background: var(--admin-bg);
  color: var(--admin-text);
  color-scheme: dark;
}
```

文本与状态都使用变量。状态同时有文字/图标，不能只靠红绿区分。主操作沿用蓝色底，本文选择深色字：`#081426`在`#347bfa`对比度4.71:1；同蓝底白字为3.92:1，因此后台15px按钮使用深色字。链接用较亮的既有蓝`#5b97ff`，在surface上5.50:1；辅助字`#91a8c4`在surface上6.47:1。数字是静态色值计算，实际浏览器叠加/禁用态仍需验收。

## 3. Typography Rules

复用现有字体请求，不加新字体依赖。项目globals.css已导入如下URL；后续后台不可重复导入该请求：

`https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600&display=swap`

```css
.publish-admin {
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
  line-height: 1.75;
  letter-spacing: 0.02em;
}
.publish-admin h1 { font-size: 24px; font-weight: 600; line-height: 1.7; }
.publish-admin h2 { font-size: 20px; font-weight: 600; line-height: 1.7; }
.publish-admin h3 { font-size: 17px; font-weight: 600; line-height: 1.7; }
.publish-admin .admin-body { font-size: 16px; line-height: 1.8; }
.publish-admin .admin-meta { font-size: 13px; color: var(--admin-muted); }
.publish-admin .admin-id { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
```

正文/表单/按钮至少15px，长原稿16px；13px仅修订、时间和来源元数据，不用于错误原因或必读说明。标题按层级排布，不用展示型超大字。表单有持续可见label，不能用placeholder代替；长标题/中文与ID用overflow-wrap换行，不能截断错误原因、字段名或主操作文字。数字版本标明属于草稿、内容协议、素材或上架版。

## 4. Component Stylings

控件语义复用现有组件；下列admin类只对后台宿主生效，实际className由下一轮CSS Module确定。静态阅读卡片无点击时不造hover/focus；可打开的作品行、节点、问题定位必须有真实按钮/链接及可见focus。普通标签是只读说明；可筛选标签才是按钮。

```css
.publish-admin .admin-button {
  min-height: 44px; min-width: 44px; padding: 10px 16px;
  border: 1px solid var(--admin-accent); border-radius: 10px;
  background: var(--admin-accent); color: var(--admin-action-ink);
  font: inherit; font-weight: 600; cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.publish-admin .admin-button.secondary {
  background: var(--admin-alt); color: var(--admin-text);
  border-color: var(--admin-border);
}
.publish-admin .admin-button.danger {
  background: var(--admin-surface); color: var(--admin-error);
  border-color: var(--admin-error);
}
.publish-admin .admin-button:hover:not(:disabled) { background: var(--admin-accent-hover); }
.publish-admin .admin-button.secondary:hover:not(:disabled),
.publish-admin .admin-button.danger:hover:not(:disabled) { background: var(--admin-hover); }
.publish-admin .admin-button:active:not(:disabled) {
  box-shadow: inset 0 0 0 2px rgba(var(--admin-shadow-rgb), 0.25);
}
.publish-admin .admin-button:disabled {
  background: var(--admin-alt); color: var(--admin-muted);
  border-color: var(--admin-border); cursor: not-allowed;
}
.publish-admin .admin-control {
  width: 100%; min-width: 0; min-height: 44px; padding: 10px 12px;
  border: 1px solid var(--admin-border); border-radius: 10px;
  background: var(--admin-bg); color: var(--admin-text); font: inherit;
}
.publish-admin textarea.admin-control { min-height: 144px; resize: vertical; }
.publish-admin .admin-control:hover:not(:disabled) { border-color: var(--admin-border-hover); }
.publish-admin .admin-control:active:not(:disabled) { border-color: var(--admin-focus); }
.publish-admin .admin-control[aria-invalid='true'] { border-color: var(--admin-error); }
.publish-admin .admin-control:disabled {
  background: var(--admin-alt); color: var(--admin-muted); cursor: not-allowed;
}
.publish-admin .admin-control[readonly] { background: var(--admin-surface); }
.publish-admin .admin-card {
  min-width: 0; padding: 20px; border: 1px solid var(--admin-border);
  border-radius: 14px; background: var(--admin-surface);
}
.publish-admin .admin-row-button, .publish-admin .admin-nav-button {
  display: block; width: 100%; min-height: 44px; padding: 12px;
  text-align: left; font: inherit; color: var(--admin-secondary);
  background: var(--admin-clear); border: 1px solid var(--admin-clear);
  border-radius: 10px; cursor: pointer;
}
.publish-admin .admin-row-button:hover:not(:disabled),
.publish-admin .admin-nav-button:hover:not(:disabled) { background: var(--admin-hover); }
.publish-admin .admin-row-button:active:not(:disabled),
.publish-admin .admin-nav-button:active:not(:disabled) { background: var(--admin-alt); }
.publish-admin .admin-nav-button[aria-current='page'],
.publish-admin .admin-row-button[aria-pressed='true'] {
  background: var(--admin-alt); color: var(--admin-text); border-color: var(--admin-border-hover);
}
.publish-admin .admin-row-button:disabled, .publish-admin .admin-nav-button:disabled {
  color: var(--admin-muted); background: var(--admin-surface); cursor: not-allowed;
}
.publish-admin .admin-link { color: var(--admin-accent-hover); text-underline-offset: 4px; }
.publish-admin .admin-link:hover { color: var(--admin-focus); text-decoration-thickness: 2px; }
.publish-admin .admin-link:active { color: var(--admin-text); }
.publish-admin .admin-link[aria-disabled='true'] {
  color: var(--admin-muted); text-decoration: none; cursor: not-allowed;
}
.publish-admin .admin-badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px;
  border: 1px solid var(--admin-border); border-radius: 6px;
  color: var(--admin-secondary); background: var(--admin-alt); font-size: 13px;
}
.publish-admin .admin-badge.error { color: var(--admin-error); }
.publish-admin .admin-badge.warning { color: var(--admin-warning); }
.publish-admin .admin-badge.success { color: var(--admin-success); }
.publish-admin .admin-inline-error { color: var(--admin-error); margin: 8px 0 0; }
.publish-admin .admin-support-note { color: var(--admin-warning); margin: 8px 0 0; }
.publish-admin :is(.admin-button, .admin-control, .admin-row-button, .admin-nav-button, .admin-link):focus-visible {
  outline: 2px solid var(--admin-focus); outline-offset: 3px;
}
```

复用Button的disabled、pending标签与实际命令互锁；`aria-disabled`不阻止事件，未来实现必须同步取消链接行为，不能仅靠颜色。只读文本与禁用表单不同：只读资料仍可选择复制。存档/节点卡无素材时显示“未选择封面/缺人物形象”等诚实文字和选择入口，不做纯色图片占位，更不拿白板当封面。

素材缩略图只用实际有权限的图片，不生图；名称、用途、来源、可见性和引用对象同时可读。预览失败保留已绑定素材ID与失败提示；不能把占位图片标成授权人像。解除绑定/删除先展示引用影响；图片预览按钮和关闭按钮至少44px。

## 5. Layout Principles

外壳只用于内部后台，不能复用消费者430px容器作为PC编辑区。最大工作区1680px居中，1440视口两侧24px，顶栏内容高度最低72px；窄屏最低64px且允许标题换行。间距梯度4/8/12/16/20/24/32px；字段内8、字段组20、分区24。长表格仅原稿局部容器横滚，整个页面不得横向溢出。

```css
.publish-admin .admin-topbar {
  position: sticky; top: 0; z-index: 20; min-height: 72px;
  padding: 12px 24px; background: var(--admin-bg);
  border-bottom: 1px solid var(--admin-border);
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
}
.publish-admin .admin-workspace {
  max-width: 1680px; margin-inline: auto; padding: 24px;
  display: grid; grid-template-columns: 208px minmax(0, 1fr) 416px; gap: 24px;
}
.publish-admin :is(.admin-navigation, .admin-editor, .admin-inspector) { min-width: 0; }
.publish-admin .admin-editor { display: grid; align-content: start; gap: 24px; }
.publish-admin .admin-inspector { align-self: start; }
.publish-admin .admin-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.publish-admin .admin-form-grid .full-width { grid-column: 1 / -1; }
.publish-admin .admin-source-table { max-width: 100%; overflow-x: auto; }
.publish-admin .admin-preview-frame { width: min(100%, 390px); margin-inline: auto; }
.publish-admin .admin-text { overflow-wrap: anywhere; }
```

1440px工作区内净宽1392px：左208、两个24间隙、右416，中编辑720。1200px净宽1152px，中编辑480；再窄将右区收为独立预览/检查面板。预览宿主只有内边距和安全标题，内部直接复用已授权的PhoneShell与安全开局投影；不制造新的iPhone顶栏/应用/导航。宽屏不把全文与手机塞在同一滚动条里无限延长，页面原生滚动，预览内部维持现有滚动逻辑。

### 作品列表

顶栏“内部作品”，右侧真实新建入口；次行搜索和全部/草稿/已上架/已下架筛选（只有对应API支持才出现）。PC使用有表头的列表：作品名称与简介、草稿修订、上架版本/状态、修改人/时间、对应修订检查概况、继续编辑。搜索结果、首次无作品和读取失败分开；失败保留重新读取，不把失败当空目录。

作品名称可打开编辑，其他按钮不嵌进整行按钮；每行稳定workId。390变纵向作品卡，字段标签保留，不以隐藏列丢失发布状态。实际总数未知不写假数字，尚未支持搜索时不放无效搜索框。

### 作品工作区示意（布局示意，不是已实现截图）

```text
┌ 内部作品 / 作品标题       草稿 r7 · 已保存       保存草稿 ┐
│ 左分区        │ 中央编辑                          │ 右面板 │
│ 概览          │ 本区标题 · 来源/支持提示           │ 玩家预览│
│ 世界与主角    │ 字段组 / 已确认正稿 / 冲突定位     │ r7     │
│ 角色          │                                  │ 或检查 │
│ 剧情候选      │ 原稿资料（按需打开）               │ 缺项   │
│ 初始手机      │                                  │ 定位   │
│ 素材          │                                  │        │
│ 检查与发布    │ 精确修订与审阅结果                 │        │
└───────────────┴──────────────────────────────────┴────────┘
```

“保存草稿”为编辑页主操作。发布只出现在“检查与发布”审阅区，不和保存并列造成误点。顶部显示草稿修订和独立上架版，不把“已保存”涂成“已上架”。左导航选中分区蓝边+文字，有当前页语义；有问题的分区只显示服务器实际问题数，未知不造角标。

### 编辑区与右面板

|页面分区|中央字段组织与操作|右面板/可见性|
|---|---|---|
|概览|标题/公开简介/体验说明、真实封面选用、草稿和上架版本摘要；来源资料入口|安全目录卡片；当前待发布范围与缺项，不用假封面|
|世界与主角|先世界时代/地点/起点时间，再身份/处境/目标；最后已有历史/当前承诺，来源可展开|主角开局可知摘要；未来计划不写在历史列表|
|角色|人物列表进入稳定ID详情；公开档案、隐藏人格、已有历史及初始知情、未来可能四页签；同角色共用保存范围|仅公开档案预览；隐藏人格区明确内部可见，不能直接复制到预览|
|剧情候选|节点列表可按人物线切换；详情依次为矛盾/参与者、前置与排除、自然引入、玩家可能行动、证据/后果、冷却失效|此区右侧默认检查而非未来手机待办；“仅可能，尚未发生”持续可见|
|初始手机|历史聊天/当前来信、日历、便签、相册子区；每条显示时间、人物和素材实际引用|已保存开局PhoneShell预览，微信/日历/相册/便签；不开通未接入的应用动作|
|素材|私有研究附件与可发布素材分区；用途/角色地点绑定/授权、缩略图、缺项及引用影响|真实素材大图及说明。白板/关系图归研究区，不可当授权人像|
|检查与发布|修订/素材清单、检查问题定位、私有试演任务与证据、发布审阅/状态历史；已上架版只读|安全公开内容和本修订检查；幕后诊断独立内部区域，不出现在玩家手机|

右面板两个页签“玩家预览/检查”。预览取服务端安全投影，显示“已保存修订 r7”，不是先下载完整源稿再在DOM里藏秘密。未保存时提示“预览仍为 r7，保存后更新”，不自动创建world。检查按相同修订/素材/协议显示，改稿后标“检查需更新”；点击问题定位真实字段，滚动后聚焦label或输入框，不导致丢稿。

“原稿资料”按需展开独立抽屉：原Markdown/表格/节点/附件保原格式，有来源版本和目标字段映射；映射未确认、相互冲突有文字说明。资料抽屉不默认常开，不替主编辑区增加永久第四栏。原稿/正稿分别保存，不以导入完成作为内容已确认。

## 6. Depth & Elevation

|层级|处理|用途|
|---|---|---|
|基础|bg与surface实色、1px边框，无阴影|编辑卡、导航、列表与只读稿|
|浮层|0 12px 32px rgba(admin-shadow-rgb,0.32)|原稿抽屉、素材预览、冲突差异面板|
|阻断确认|现有Modal dialog顶层，深色backdrop，8px外边距起|离开未保存、引用删除影响、审阅发布/下架|

浮层CSS沿专属作用域引用变量：`box-shadow: 0 12px 32px rgba(var(--admin-shadow-rgb), 0.32)`。不使用大面积模糊或文字发光。Modal复用dialog及现有取消处理，外部状态必须决定能否关闭；保存/发布中不得靠Esc或遮罩绕过互锁。焦点回到打开入口，必要时可见错误区。

## 7. Animation & Interaction

L1仅状态色120ms和浮层单次淡入160ms；不重放表单入场，不让输入失焦。导航选择立即切换内容，保留编辑状态与对应滚动位置；切页不触发模型、试演或发布。图像加载仅实际图片加载状态，不做虚构生成动画。

```css
@keyframes admin-fade-in { from { opacity: 0; } to { opacity: 1; } }
.publish-admin .admin-overlay-content { animation: admin-fade-in 160ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .publish-admin .admin-overlay-content { animation: none; }
  .publish-admin :is(.admin-button, .admin-control) { transition: none; }
}
```

保存为显式动作。提交期间按钮文字“正在保存…”，禁第二次不同command；成功用轻量role=status显示服务器修订/时间，失败用字段或页内alert，不每次保存弹遮挡对话框。自动保存不是本轮默认能力；浏览器内存不能显示“已保存”。不默认把完整内部源稿存到明文localStorage。

### 保存、检查、试演、发行四状态线

|状态|具体呈现/操作|必须保留的区别|
|---|---|---|
|已保存/未保存|顶栏“草稿 r7 · 已保存”或“有未保存改动”；保存失败就近说明并保留输入|服务器修订为准；已保存不代表检查通过或已上架|
|版本冲突|页内提示+“查看差异”，面板左本地编辑/右最新保存；逐项应用后在新基线上保存|原输入不丢；不能自动覆盖、偷偷改expectedVersion或复用同command提交不同内容|
|缺项|字段下明确“缺少人物形象”等，本区和检查列表同步定位|可保存草稿与允许发布分别由API/检查决定，不由UI自定跳过|
|未支持|字段旁“已保留为作者资料，当前不会参与运行”；检查解释首段是否需要该能力|仅作者意图/已保存/可运行是三个概念；不会造启用开关或假进度|
|素材缺失/失败|保实际绑定ID、来源/用途，提示不可预览/不可发布及重新选用入口|研究图、私有图、发布图不混用；失效图不回落为有效人像|
|检查中/过期|对应r7的问题加载；改稿后“检查需更新”及显式重新检查|不拿r6的通过说明r7可发布；检查不建world或调用模型|
|试演中/失败/unknown|真实task进度或状态，失败原文、继续/核对同次操作；标对应修订|世界可进入不等于首段玩法通过；unknown不自动重付|
|发布处理中/失败/unknown|审阅页显示正在处理或原错误，先核回执及上架指针；失败保留此前上架版|服务器明确成功才显示上架；刷新不会产生第二个版本|
|已上架|“上架版本 v2”，发布时间/操作人/内容摘要只读；新草稿可独立修改|旧发布版本不可写；新版发布不改玩家旧档|
|已下架|“已下架 · 已有玩家仍可继续”；有权限才展示选择已批准版本恢复|下架停止新实例化，不删除版本/存档，恢复不隐式发布新草稿|
|权限不足/撤回|页内原因，按服务端许可只读；写入/发布不可操作|隐藏入口不算权限校验，不改用guest重提命令|

发布审核布局依次为“确定修订与范围→公开内容→素材与未纳入内容→同修订检查/试演依据→正式提交”。有发布接口与权限才出现可用动作；未接入时显示能力缺口，不做可点击假发布。下架确认说明对新进入和旧存档的不同影响，选择恢复的准确已批准版本。

## 8. Do's and Don'ts

实施必须：

- 保持稳定作品/角色/节点/素材ID，改名不换身份，不按同名人物串图。
- 公开/隐藏、历史/认知/未来分别编辑并由服务端控制读取。
- 玩家预览绑定安全投影和精确修订；已修改未保存、检查过期明确显示。
- 带真实回执保存和版本冲突；各类unknown先核原操作，不能自动重复费用或发版。
- 缺项、未支持和失败用可读文字及定位，长信息可完整阅读。
- 未来字段从根批准的协议/能力列表扩展，默认未知不造事实，JSONB可存不等于可运行。
- 手机与PC都检查键盘、焦点、输入保存、滚动、返回与素材权限。

禁止：

- 不改消费者PhoneShell、锁屏、四应用或底部导航来实现后台。
- 不把内部稿、隐藏人格、未来结局或白板工作照片送到玩家预览或全部NPC。
- 不把节点画成强制顺序任务或用作者概率替玩家答应、签字、赴约。
- 不以浏览器内存、假图片/进度、预设回复或绿色徽标冒充真实保存/试演/发布。
- 不拿旧试演给新修订背书，不在保存/切页/预览时自动创建或发布world。
- 不回写旧发布版本或玩家历史，不用新同名人物补旧故事。
- 不在共享DESIGN/outer-ui.css/Button接口上并行修改，不擅自追加业务字段。
- 不加公共投稿、玩家世界内导演编辑入口、假发布按钮或未支持应用控件。
- 不加新字体/图标/动画依赖，不生图、不用纯色块当图片，不全页横滚。

## 9. Responsive Behavior

|范围|布局|操作规则|
|---|---|---|
|≥1200px|208px左导航、中编辑、416px右预览/检查；最大1680|内容有完整标签，手机预览390px以内；1440实际验收|
|768–1199px|180px导航+单编辑；右区改“预览/检查”独立面板|同时最多编辑和一个辅助面板，返回保稿与焦点|
|<768px|单分区编辑，顶部分区选择；预览/检查/原稿进入独立面板|没有永久左栏/右栏；作品列表变纵向卡，390与短视口500必须验收|

```css
@media (max-width: 1199px) {
  .publish-admin .admin-workspace { grid-template-columns: 180px minmax(0, 1fr); }
  .publish-admin .admin-inspector { grid-column: 1 / -1; }
}
@media (max-width: 767px) {
  .publish-admin .admin-topbar { min-height: 64px; padding: 12px 16px; gap: 8px; }
  .publish-admin .admin-workspace { display: block; padding: 16px; }
  .publish-admin .admin-navigation { margin-bottom: 16px; }
  .publish-admin .admin-editor { gap: 20px; }
  .publish-admin .admin-form-grid { grid-template-columns: minmax(0, 1fr); }
  .publish-admin .admin-card { padding: 16px; }
  .publish-admin .admin-preview-frame { width: 100%; }
}
```

样式片段给列宽和尺寸；面板打开/关闭及移动分区必须由实际UI状态实现，不能靠CSS隐藏仍下载的秘密或把所有面板堆在一页。非全局表格需要独立横滚的提示/标签；固定操作区不得盖输入，保存优先置顶栏及表单末端，避免窄屏浮底条占键盘空间。长稿可读原生滚动，不缩小手机预览把文字变不可读。

### 下一轮实际验收（本轮未执行）

1. 1440和390×844、390×500：作品列表、角色四区、候选详情、初始手机、素材、检查/发布均无全页横溢；触控最少44×44。
2. 宽屏三列算术符合1200阈值，平板/手机独立面板；PhoneShell预览与消费者界面均未被后台样式污染。
3. 有未保存改动切分区/关闭面板/返回保输入与滚动；刷新恢复服务器已保存修订；不能把刷新前内存标已保存。
4. 实际两个内部编辑会话冲突不覆盖，错误可定位、合并在新基线提交；权限撤回后旧页签写入也被拒绝。
5. 缺项/未支持/素材失败、检查过期、试演失败/unknown、发布失败/unknown与下架分别可操作恢复且不造成功。
6. 网络安全预览不含隐藏人格/未来节点，不仅DOM未展示；目录/API普通玩家不读取内部稿。
7. 新版与下架不修改旧玩家world，两个玩家独立；真实任务与command回执验证，READY与公网由根最终验收。

### 实现交接

本文件只冻结提议的视觉/布局和状态呈现，不冻结B的字段、错误结构或任何公共API。根批准新内容协议、安全投影/能力清单及员工身份/保存/素材/检查/试演/发布接口后，另登记01D实际目录和文件范围，才能实现对应页面。未来字段在有真实保存/读取/运行支持证据后加入；没有接口的动作只说明尚未接入。

来源：[已认可页面与操作规划](/Users/limengzhe/Desktop/projects/demo/人生剧本/docs/task-reports/WORLD-PUBLISH-01D-PLAN.md)、[后台主方案](/Users/limengzhe/Desktop/projects/demo/人生剧本/docs/WORLD_PUBLISHING_MVP_PLAN.md)、[供稿缺项](/Users/limengzhe/Desktop/projects/demo/人生剧本/docs/script-library/urban-relationship/INTAKE.md)。
