# 世界发布后台 · 首版实施设计

2026-10-12。用户要求加快人物与成功发布；以领导提供的浅色三栏截图为参考。补充并在本次首版替代旧后台设计的深色配色，消费者手机样式不变。已有结构和L1方向直接实施，不重复问确认。此规范不是已实现截图。

## 1. Visual Theme & Atmosphere

浅色、清楚、紧凑。左栏选世界，中间选人物，右侧编辑。顶部固定作品标题、状态、保存、检查、试演与发布。主要Tab为世界设定、人物、剧情；素材与开场手机作为对应分区展开。原稿核对/高级版本管理暂不占首屏。

## 2. Color Palette & Roles

所有变量仅定义在后台CSS Module根类，不改全局和手机。

```css
.workbench {
  --pub-bg: #f5f7fb;
  --pub-surface: #ffffff;
  --pub-text: #172033;
  --pub-secondary: #566276;
  --pub-border: #d8dee9;
  --pub-accent: #245fe5;
  --pub-accent-hover: #194fc8;
  --pub-accent-soft: #e8efff;
  --pub-error: #a32632;
  --pub-success: #22654d;
  --pub-warning: #8a5418;
  --pub-warning-bg: #fff2d8;
  --pub-ring: #245fe5;
  --pub-shadow-rgb: 23, 32, 51;
  --pub-clear: transparent;
  color: var(--pub-text);
  background: var(--pub-bg);
  color-scheme: light;
}
```

状态必须有中文文字，不能仅依赖颜色。蓝色主按钮白字，错误靠近操作；未接功能明确说明，禁用不能假成功。

## 3. Typography Rules

沿已有Noto Sans SC/PingFang SC/微软雅黑；已有字体URL是 https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600&display=swap ，不要重复导入。标题24px/600，分区18px/600，正文和表单16px，辅助14px；行高1.7、字距0.02em。表单有持续label，不用placeholder当唯一说明。移动输入至少16px避免iOS自动放大。

## 4. Component Stylings

按钮/Tab/人物行/输入框有default、hover、active、focus-visible、disabled态，使用上述变量；最小高度44px，圆角8px。主按钮accent→hover，active轻微下压，focus-visible 2px ring+2px offset；禁用保可读secondary和文字原因。输入surface、border，hover加强边框，focus-visible ring，aria-invalid用error且有邻近说明；readonly与disabled分别标明。人物行默认surface、hover bg、active accent-soft、当前accent-soft和aria-current；真实按钮才有hover。无素材头像用姓名首字的明确默认头像，不冒充人物照片。

## 5. Layout Principles

1440桌面：作品栏220px、人物列表260px、编辑器余宽且min-width0；主体padding24、gap20。编辑正文max-width920，姓名/身份可双列，长文字单列。顶部按钮自然换行。世界/剧情页复用作品栏，人物二级列表只在人物Tab显示。先完成一个工作台与人物编辑，不另做复杂仪表盘。

## 6. Depth & Elevation

surface卡片1px border；常规不用大投影，弹层最多0 8px 24px rgba(shadow-rgb,0.10)。信息分组用间距与轻边框，不用多个嵌套浮层。保存和发布状态持续可见，不用成功弹窗遮住内容。

## 7. Animation & Interaction

L1，CSS only，无新依赖。hover/focus过渡120ms，初次面板入场opacity与translateY(4px)最多160ms；prefers-reduced-motion关闭入场/位移动画。无滚动劫持/视差/3D。后台业务交互通过真实controller回调，缺回调时禁用且说明，不能用setTimeout制造已保存。

## 8. Do's and Don'ts

- 用业务字段组织五区：名字与身份、与主角初始关系、性格与说话方式、诉求、关系与知情/边界。
- 身份、经历、动机和语气未知时留空，不编造原稿。
- 完整L1–L5可折叠核对，幕后与公开分别标记。
- 改名只改显示名，不改稳定人物key；删除前列被引用位置，不静默删整条剧情。
- 不将未来事件变成已知事实/已完成任务。
- 不复制截图示例年龄、关系作为这份剧本正史。
- 不改全局CSS、手机壳、旧玩家页或公共数据合同。
- 不使用假保存、假试演、假发布或假素材/到账。
- 不把所有原稿都塞入一个巨大输入框或所有NPC上下文。
- 不为高级版本面板延误首次发布；后台仍保最小快照和冲突检查。
- 不在客户端放密钥、数据库地址、后台角色配置或密码验证值。
- 所有颜色走局部变量，不随意加图标库或字体请求。

## 9. Responsive Behavior

>=1200三栏；768–1199作品栏缩到180，人物列表可横排选择；<=767作品选择折叠为选择控件/抽屉、人物横排，编辑单列，16px padding。390×844/390×500与1440均实查：无横溢出，按钮换行、长文本可编辑、最后字段/错误/保存可达，键盘焦点不丢失。触摸目标44px。视口与滚动局部化，不把消费者页面推挤。

验收以真正保存/刷新恢复、失败草稿保留、版本冲突、权限/公开隐藏分界为准。独立dev-only预览只能用于UI检查，生产404；它不是正式后台或付费试演。
