# 剧情编辑器 · 专属设计

2026-10-12，WORLD-PUBLISH-02-PLOT-UI。沿用 DESIGN.md 与 WORLD_PUBLISH_ADMIN_MVP.md 已批准的浅色后台、L1、中文表单；根要求直接实施，不另改共享设计。不代表运行时、截图或上线验收。

## 1. Visual Theme & Atmosphere

清楚、可填写、尊重不确定性。三个分区：已发生事实 → 剧情阶段 → 可选事件。每区说明“这是什么”，再提供列表选择和字段。用户先新增，逐项填写；不要求手写整个 JSON。示例折叠展示，不自动写入用户稿。

## 2. Color Palette & Roles

CSS Module 根类局部变量继承浅色规范：背景 #f5f7fb、表面 #ffffff、主字 #172033、辅助 #566276、边框 #d8dee9、主蓝 #245fe5、hover #194fc8、浅蓝 #e8efff、错误 #a32632、提示 #8a5418、提示底 #fff2d8、透明 transparent。只在变量定义使用颜色值，所有组件通过 var 引用。中文状态同步说明，不能以颜色替代。

## 3. Typography Rules

中文 Noto Sans SC/PingFang SC/微软雅黑在前，系统字体在后；不新加载字体。分区标题18px/600，正文/输入16px，说明15px，行高1.7、字距0.02em。字段持续 label，帮助与错误邻近；没有渐变文字或文字投影。

## 4. Component Stylings

真实 button/input/select/textarea，触摸目标44px。default/hover/active/focus-visible/disabled完整，focus蓝色2px环。多项引用用复选框及中文显示名，内部保存稳定key；同名用key辅辨。已缺失引用保留并标记，不清洗掉原稿。不可编辑时所有修改入口禁用；展示帮助仍可展开。

## 5. Layout Principles

组件沿宿主宽度，max-width960px/min-width0。每区条目以原生details展开编辑，桌面普通短字段两列，长正文和依赖配置整行。三分区垂直排列便于连续理解，内容可折叠。移动列表横向换行、字段单列。无独立外壳、侧栏或保存按钮。

## 6. Depth & Elevation

白色卡片轻边框、12px圆角，18–20px内边距。组间20px。选择态浅蓝，不加重阴影。删除失败显示原位置与引用路径，保留数据。类型切换或移除窗口等破坏性动作要求显式确认，不自动做关联删除。

## 7. Animation & Interaction

L1/CSS only，初始淡入160ms，按钮/边框120ms。reduced-motion关闭动画与位移。受控content/disabled/onChange，选择和提示可局部state；无网络、计时假成功或自动保存。新项可暂不完整，提示保存草稿后由后台检查；不替根宣布发布就绪。

## 8. Do’s and Don’ts

历史事实时间不得晚于世界起点；可见范围不等于实际人物知情。阶段顺序与前置用现合同，不猜自动触发。可选事件非必经、非正史。offer_message/offer_invitation是可执行意图类别，实际能力以服务端支持与试演为准；editorial_only仅作者备注。稳定key不可随改标题变更。字段补丁保留未动原文、extensions和其他分区。删除被引用条目阻止并说明。不给未来推测自动赋 established_fact，不合成用户真实资料，不改公共协议/运行时/媒体。

## 9. Responsive Behavior

390短长屏：100%宽、16px表单、单列、按钮自然换行，长key与说明overflow-wrap:anywhere，min-width0，无固定高度导致底部不可达。>=760px列表/编辑两栏，详情字段可两列；1440宿主中最大960。浏览器/生产资源本轮未授权，先做SSR/回调/CSS静态检查，实际390/PC由根挂载后验收。
