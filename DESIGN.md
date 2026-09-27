# 当前实施规范 · VIS-01（2026-09-28）

用户已批准视觉改版，以下优先于历史规范。详见 docs/design/VISUAL_REDESIGN_20260928.md。

- 外层深海蓝 #081426，表面 #10233d，蓝色操作按钮 #347bfa；白色与蓝灰文字。
- 保留「聊聊／分支／我的」，不增加首次资料表单。开场场景仅在空对话出现，开始聊天后以消息为主。
- 分支统一 228px 封面卡片；已有照片标为「你的照片」，缺失时使用明确标注「意境插画」的项目素材，不冒充生成的场景。
- 我的以照片和经历为主，保留真实的上传、删除、编辑接口。
- 手机全屏；电脑 430px 居中。世界手机样式保持独立，本批不修改。
- 回退信息：docs/design/VISUAL_ROLLBACK_20260928.md。

---

# 当前实施规范 · 外层 V4（2026-09-22）

本段优先于下方历史规范。用户确认按 docs/design/FIGMA_MOBILE_V4.md 开发产品外层，世界 iPhone 手机保持当前实现，本轮不改。

- 固定聊聊／分支／我的。聊天顶部仅「如果」，中间为对话；取消首次资料表单，Agent 按需询问。
- 外层深色 #10171c、表面 #202830、暖杏 #e7bea6、主文字 #edf0ef。变量与样式在 outer-ui.css，仅作用于 app-workspace/discovery-page，不能改变世界手机主题。
- PC 居中430px，手机使用可用视口全宽高；不伪造系统状态栏。
- 所有分支统一82px高度，350px宽度对应390px屏幕；身份、状态、箭头。长标题省略但可访问名称完整。不伪造未读数，没有接口的筛选与归档不摆假按钮。
- 我的：头像、基本资料、兴趣与愿望、重要的人、人生经历；编辑和确认保持真实接口。资料折叠避免首屏大表单。
- 人生提案保留可展开详情和原创建/修改流程。暂无分支显示简短去聊聊入口。
- Figma读取额度受限，本轮采用已保存的本人原创设计源与截图；现有图标优先复用。

---

# 如果 · 手机 App 设计规范 v2

2026-09-22。最新结构以 docs/INFORMATION_ARCHITECTURE.md 为准：固定底部「聊聊 / 如果 / 我的」三导航，分别承载个人对话、不同人生分支和现实档案。用户已要求按新版方案修改：参考 Zeta 的窄幅 App 形式，全程手机布局。原 PC 双栏、宽屏推荐及外侧辅助面板规则废止。当前实现风格为暖白、紫色与珊瑚橙，待用户视觉审阅；功能测试不能替代审阅。

## 1. Visual Theme & Atmosphere

关键词：生活感、轻松、亲近、想象、照片、纸感。以一个小而完整的 App 承载体验。通用开场插画是一扇通向海边的门；它不代表用户生成的人生。已有真实人物照片保持用户身份，不拿图库冒充。

参考 https://zeta-ai.io/en 的桌面窄幅视口、图像与短文案、底部导航；不复制公共角色商城或未经查看的聊天流程。L1 轻量过渡，CSS only。

## 2. Color Palette & Roles

运行时色板在 src/app/phone-first.css，覆盖旧基础组件变量：

```css
:root {
 --bg:#fbf9f5; --bg-rgb:251,249,245; --surface:#ffffff;
 --surface-alt:#f2eee7; --surface-hover:#eee8df;
 --border:#e5dfd6; --border-hover:#ab99db;
 --text:#24222c; --text-secondary:#64606c; --text-tertiary:#77717d;
 --accent:#7050cb; --accent-hover:#5936b0; --accent-rgb:112,80,203;
 --stage:#151419; --white:#ffffff; --coral:#dc7757;
 --lilac:#eae2fa; --mint:#e3eee5; --peach:#f6e5d5;
 --success:#28785d; --error:#b14343; --warning:#986314;
 --shadow-rgb:0,0,0; --transparent:transparent;
}
```

外部近黑；内容暖白；主操作紫色；橙色小装饰；紫/绿/杏色区分推荐但不表达虚构评分。文字对比优先于低透明度装饰。所有组件使用变量。

## 3. Typography Rules

沿用中文字体及系统回退，避免增加新字体请求：

```css
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600&display=swap');
:root {
 --font-body:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;
 --font-title:'Noto Serif SC','Songti SC',serif;
}
```

|用途|字号|处理|
|---|---|---|
|开场标题|28–30px|衬线，行高 1.5；控制短句|
|推荐标题|20px|无衬线 600，行高 1.5，允许完整换行|
|对话|15px|行高 1.8，输入与阅读优先|
|详情|13–15px|行高 1.85；不截掉来源或选择含义|
|导航|11–12px|图标与短文字同时出现|

不使用英文大眉题、渐变字、正文投影；标题与按钮为用户表达动作，隐藏版本/Worker 等工程术语。

## 4. Component Stylings

公共 Button/Icon/Modal 保持兼容。新的样式覆盖限定在 phone-first.css；世界模块用 CSS Module，不复制公共 CSS。所有状态如下：

```css
.button { min-height:44px; border-radius:12px; transition:background .18s,transform .12s; }
.button.primary { background:var(--accent); color:var(--white); }
.button.primary:hover { background:var(--accent-hover); }
.button.secondary { background:var(--surface); border:1px solid var(--border); color:var(--text); }
.button.ghost:hover { background:var(--lilac); color:var(--accent); }
:is(button,a):active { transform:translateY(1px); }
:is(button,a,input,textarea,summary):focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
:is(button,input,textarea):disabled { opacity:.45; cursor:not-allowed; }
.field { background:var(--surface); color:var(--text); border:1px solid var(--border); }
.field:hover { border-color:var(--border-hover); }
.field[aria-invalid=true] { border-color:var(--error); }
```

聊天：白色对方气泡，淡紫本人气泡；头像小而清楚。推荐：短标题和摘要，生活片段及依据/取舍可展开，全文始终可访问。资料选择保持复选框和明确保存回执。标签不是可点控件时不加误导 hover。

## 5. Layout Principles

所有阶段 PC 居中 max-width 480px，手机占满实际屏宽；可用高度由视口决定，内部内容滚动。顶栏与底栏不随正文滚走。禁止双栏档案、三列推荐和手机外导演面板。

外层 App 固定底部三个 Tab：聊聊、如果、我的。档案为独立整页，底栏始终可达；个人对话中的资料整理同步到我的。如果集中展示所有人生分支，从这里进入世界或创建详情。世界阶段以四个 App 和人生管理入口承担导航。弹层居中且宽度不超过 App；档案为手机内全屏页，编辑弹窗在其上。间距 4/8/12/16/20/24；页边 16–22px。

## 6. Depth & Elevation

普通列表/对话无阴影，卡片靠背景区别；只给整个 App 极弱外部阴影。弹层暗化背景，保留内容焦点。未来世界 Dock/通知可采用轻玻璃，普通档案不玻璃化。

## 7. Animation & Interaction

L1 CSS 180–220ms 入场，120ms 按压，无滚动劫持/视差/3D依赖。沿用已有 page-enter/message-enter；生成中显示真实状态，不做假百分比。

```css
@keyframes enter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
.page-enter { animation:enter .22s ease-out both; }
@media(prefers-reduced-motion:reduce) {
 *,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; }
}
```

底部输入及主操作可达，浏览器返回与关闭一致，原生 dialog 负责焦点约束。读屏只宣读状态变化，不反复播报整个对话。

## 8. Do's and Don'ts

- 从用户本人和真实经历开始。
- 用照片/原创插画建立画面，标清通用插画与真实生成的区别。
- 让每屏主动作清楚，详情可展开。
- 保留照片授权、真实保存、重试和恢复。
- 所有点击目标至少 44px，键盘也能操作。
- 不把 App 做成桌面仪表盘。
- 不通过套边框来代替重排页面。
- 不堆蓝色线框、大英文标语和长说明。
- 不截断重要信息而不给全文入口。
- 不拿通用插画假装用户的平行照片。
- 不拿预设人物/通知冒充世界生成成功。
- 不为沉浸感隐藏私密资料范围或失败。
- 不在 App 外堆资料、导演和时间侧栏。

## 9. Responsive Behavior

|设备|布局|
|---|---|
|宽度 >480px|居中 480px App，全高，两侧安静背景|
|宽度 ≤480px|全宽全高，无额外设备外框|
|高度 ≤620px|收紧顶栏和输入占用，内容仍独立滚动，不缩小文字或触摸目标|

视口验收 390×844、390×500、768×1024、1440×900；软键盘需要另外验证，模拟短屏不等于真实手机键盘验收。图片加载失败必须有可读替代描述，字体网络失败使用系统中文字体。

最新入口修正：取消聊天前的独立欢迎页。姓名/生日在个人对话首屏选填；我的提供姓名或昵称、生日、出生时间、所在城市、职业、家乡的可编辑资料卡。手机使用可用视口全宽全高，电脑居中最大480px，不强制固定长宽比例。
