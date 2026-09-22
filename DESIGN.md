# 如果 · Parallel Life 设计提案

状态：用户已同意按此方向推进。以最后一张四屏参考为主要视觉依据；首阶段访谈、档案、照片/人物及曲线界面已实现；虚拟手机与后续产品界面继续按此规范开发。

## 1. Visual Theme & Atmosphere

深海蓝、真实人像、生活感、安静、亲密、清晰。外层是认识自己的空间，内层是一部正在发生生活的手机。标题有适量中文衬线气质，操作区保持熟悉易用。

交互档位 L1：精致状态反馈、轻量入场、应用切换过渡；不引入滚动劫持、3D 场景或复杂动效库。以输入、阅读与即时反馈为主。

## 2. Color Palette & Roles

```css
:root {
  --bg: #071522; --bg-rgb: 7,21,34;
  --surface: #10263a; --surface-alt: #163149; --surface-hover: #1b3d59;
  --border: #2b455b; --border-hover: #6e9fc8;
  --text: #f3f5f6; --text-secondary: #c0cedb; --text-tertiary: #9aafc2;
  --accent: #3989ff; --accent-hover: #67a4ff; --accent-rgb: 57,137,255;
  --success: #74ce9a; --error: #ff9d9d; --warning: #edc58b;
  --paper: #f4f3ef; --ink: #20282e; --bubble: #d6efc7;
  --shadow-rgb: 0,0,0; --transparent: transparent;
}
```

所有组件颜色引用变量。外层深蓝，消息内页浅灰白，便签暖白；真实照片是主要色彩来源。曲线用蓝色表达平行人生、灰色表达现实基线，配文字和线型区分。

## 3. Typography Rules

```css
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600&display=swap');
:root {
  --font-body: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-title: 'Noto Serif SC', 'Songti SC', serif;
}
body { font-family: var(--font-body); font-size:16px; line-height:1.75; letter-spacing:.02em; }
h1,h2 { font-family:var(--font-title); font-weight:500; }
```

|用途|手机 / PC|字重|行高|
|---|---|---|---|
|主标题|32 / 44px|500|1.7|
|页面标题|24 / 28px|500|1.7|
|组件标题|18 / 20px|600|1.7|
|正文与消息|16 / 16px|400|1.75|
|按钮与标签|15 / 15px|500|1.7|

字体加载失败时使用明确的中文系统回退。标题、正文不使用渐变字或投影；禁止花体正文和只配英文字体的回退方案。

## 4. Component Stylings

```css
.button,.card-action,.nav-item,.link,.tag-action {
  font:inherit; min-height:44px; border:1px solid var(--border);
  color:var(--text); background:var(--surface); border-radius:14px;
  cursor:pointer; transition:background .18s,border-color .18s,transform .18s;
}
.button { padding:12px 20px; background:var(--accent); border-color:var(--accent); }
.card-action { padding:20px; text-align:left; }
.nav-item { padding:10px 14px; border-color:var(--transparent); }
.link { background:var(--transparent); color:var(--accent-hover); border-color:var(--transparent); }
.tag-action { padding:8px 12px; border-radius:99px; }
:is(.button,.card-action,.nav-item,.link,.tag-action):hover { background:var(--surface-hover); border-color:var(--border-hover); }
.button:hover { background:var(--accent-hover); }
.link:hover { text-decoration:underline; text-underline-offset:4px; }
:is(.button,.card-action,.nav-item,.link,.tag-action):active { transform:translateY(1px); }
:is(button,a,input,textarea,[tabindex]):focus-visible { outline:2px solid var(--accent-hover); outline-offset:3px; }
:is(.button,.card-action,.nav-item,.link,.tag-action):disabled,
[aria-disabled='true'] { opacity:.45; cursor:not-allowed; transform:none; }
[aria-selected='true'],[aria-current='page'] { border-color:var(--accent); background:var(--surface-alt); }
.field { width:100%; padding:12px 16px; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:14px; font:inherit; }
.field:hover { border-color:var(--border-hover); }
.field:disabled { opacity:.45; cursor:not-allowed; }
.field[aria-invalid='true'] { border-color:var(--error); }
.chat-page { background:var(--paper); color:var(--ink); }
.bubble-self { background:var(--bubble); color:var(--ink); border-radius:14px 4px 14px 14px; }
```

核心组件：对话与可编辑档案、事件曲线、照片上传、人生推荐卡、应用图标、通知横幅、聊天气泡、朋友圈、日期相册、日历事件、便签、导演面板、人生切换器、时间控件。每个组件覆盖空白、加载、成功、失败和恢复。手机应用图标使用 SVG；通知可直达对应消息。相册真实展示已生成素材，未生成时使用明确加载状态。

## 5. Layout Principles

手机：全屏应用，直接进入认识我的流程，不额外套手机边框。主要操作置于底部安全区。档案从聊天顶部入口展开，避免过多面板竞争。

PC 认识阶段：左侧约 560px 对话，右侧约 420px 实时档案与人生轨迹。推荐阶段用大幅人生卡，保留生成依据。

PC 人生阶段：居中 390–430px 手机，左侧轻量人生导航和当前日期，右侧仅在用户打开时呈现日程、轨迹或导演。壁纸的低对比延展承担空间氛围；默认不堆统计面板。点击相册照片可使用桌面宽幅查看器。

```css
.workspace { max-width:1440px; margin:auto; padding:32px; }
.interview-layout { display:grid; grid-template-columns:minmax(0,560px) minmax(0,420px); justify-content:center; gap:48px; }
.life-layout { display:grid; grid-template-columns:minmax(160px,1fr) minmax(390px,430px) minmax(240px,1fr); gap:32px; align-items:center; }
.phone { width:100%; max-width:430px; margin:auto; overflow:hidden; border-radius:36px; border:1px solid var(--border); }
```

间距梯度 4/8/12/16/24/32/48/64px。手机页边距 20px，卡片内边距 16–20px。聊天阅读内容不超过 680px。

## 6. Depth & Elevation

|层级|处理|使用|
|---|---|---|
|平面|无阴影|聊天列表、日历、便签|
|轻层|1px 边框|档案、人生推荐|
|浮层|柔和阴影|通知、菜单|
|主体|较深阴影|PC 手机和照片查看器|

```css
.floating { box-shadow:0 8px 24px rgba(var(--shadow-rgb),.18); }
.phone { box-shadow:0 28px 80px rgba(var(--shadow-rgb),.35); }
```

## 7. Animation & Interaction

L1，CSS only，无额外运行依赖。应用进入 220ms；消息入场 180ms；点击反馈 120ms；模型生成阶段展示实际完成状态，不伪造百分比。保留原生滚动，不使用视差或 pin。

```css
@keyframes enter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
.page-enter { animation:enter .22s ease-out both; }
.message-enter { animation:enter .18s ease-out both; }
.app-icon { transition:transform .12s ease,opacity .12s ease; }
.app-icon:hover { transform:translateY(-2px); }
.app-icon:active { transform:scale(.96); }
.scroll-region { overflow-y:auto; overscroll-behavior:contain; }
@media (prefers-reduced-motion:reduce) {
  *,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; }
}
```

输入框发送状态不覆盖草稿；进入应用保留列表滚动位置；返回和浏览器后退语义一致。实时消息使用非打断式读屏提示，不逐字符播报。

## 8. Do's and Don'ts

Do：
- 让照片和个人经历贯穿现实档案与平行人生。
- 用具体消息、生活细节和关系变化表达故事。
- 每个推荐展示用户能理解的生成依据。
- 保留编辑、返回、重试和继续入口。
- 让日程、聊天与相册共享同一个事件。

Don't：
- 不预设用户必然成为导演。
- 不把产品做成数据仪表盘。
- 不在手机屏幕外再套多层装饰边框。
- 不拿随机图库人像冒充用户的平行照片。
- 不将未知经历或心理推测写成事实。
- 不用假进度、假通知和预设回复冒充 AI 成功。
- 不把个人访谈自动共享给其他玩家或世界角色。
- 不展示内部模型、调度日志和技术参数作为主要产品流程。

## 9. Responsive Behavior

|设备|宽度|布局|
|---|---|---|
|Desktop|≥1200px|访谈双栏；人生手机居中、辅助面板按需展开|
|Tablet|768–1199px|主内容居中、辅助内容抽屉|
|Mobile|<768px|全屏单栏；无外框；底部安全区|

```css
@media(max-width:1199px) {
  .life-layout { display:block; }
  .auxiliary { display:none; }
  .interview-layout { gap:24px; grid-template-columns:1fr 1fr; }
}
@media(max-width:767px) {
  .workspace { padding:0; }
  .interview-layout,.life-layout { display:block; }
  .phone { max-width:none; min-height:100dvh; border:0; border-radius:0; box-shadow:none; }
  .composer { padding-bottom:max(12px,env(safe-area-inset-bottom)); }
  .profile-aside { display:none; }
}
```

触摸区域至少 44×44px；辅助内容在窄屏由带名称的入口打开，不能只隐藏不提供访问。虚拟键盘出现时保持输入框与发送按钮可见，照片查看器支持返回及 Esc。验收覆盖 390×844、768×1024、1440×900。
