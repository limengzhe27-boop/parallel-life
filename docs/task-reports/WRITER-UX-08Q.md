# WRITER-UX-08Q：作者界面收拢

2026-10-13；Agent codex-writer-ux-08q-01a0c7c8-20261013；待验收。独立photo-compose-02/codex/writer-ux08-q，基线本人07Q提交95101ba。主表已按短锁登记。root唯一集成，import/source/schedule组件及其测试由root独占；人物UI实际内嵌workbench，无独立actor-editor，B只做后端。

## 已实现

- 页面高度约束到动态视口，左侧品牌/底部新建不随作品列表滚走；作品列表内部滚动，右侧独立滚动。手机导航压缩为横向作品列表与固定新建入口。此为CSS实现，实际尺寸/键盘/双端浏览器由root验收。
- 删除原始JSON编辑器及其专用临时输入状态、概览JSON详情、错误code/path/内部编号/技术详情。检查仍逐项以人话呈现，截断与未知能力仍明确提醒；人物删除引用仍阻断并以所属内容类型提示。没有删除后台规则或旧稿数据。
- 故事背景保留统一填写入口，另写展示简介改为可选折叠，旧description与publicSetting不合并、不覆盖。地点先显示名称与单行说明，点击展开完整编辑，旧长描述完整保留；新增未命名地点默认展开，描述不设必填。
- 剧情“其他走向”默认折叠，展开先读现有规则的人话摘要，再展开修改；互斥、排除、拒绝/跳过/过期后可考虑的剧情用真实名称表示，不假称源于原稿，不自动添加或删除规则。空window/alternatives对象和空timeNote显示未设置；真正不完整值保留待核对。
- 阶段顺序向作者显示第1至32阶段，写入仍转换为原有0至31，关系守卫未变。日期概览改为北京时间标签。
- 按root明确指派，在workbench onApply新增可选第三参options.keepOpen；剩余批次由root导入组件决定，true保留弹窗，默认false保持原行为。保存/发布/回执/版本/hash/权限检查未改变。

## 精确改动文件

src/features/publisher/下：publisher-workbench.tsx、publisher-workbench.module.css、publisher-review-view.ts、publisher-plot-editor.tsx、publisher-space-editor.tsx。

tests/下：publisher-workbench.test.ts、publisher-review-view.test.ts、publisher-plot-ui.test.ts、新publisher-space-editor-ui.test.ts。

本报告docs/task-reports/WRITER-UX-08Q.md，主目录仅本人领取行和报告镜像。登记允许的opening-editor与plot样式实际无需改动。没有改root/B文件、公共接口、API、Repository或迁移。

## 验证与限制

- 5组专项65/65通过、0跳过：workbench、review-view、plot-ui、opening-editor、space-editor-ui。
- 新覆盖：空规则与只读摘要、已存关联不变、阶段显示/存储转换、隐藏工程数据但原对象保留、地点长文保留/只读回调不写、无自动保存，以及keepOpen与原默认关闭两种导入行为。
- 第一轮54/57，三项旧断言要求显示内部引用/扩展JSON或旧文案；按新需求改为人话提示且断言原数据不变，最终65/65通过。
- npm run typecheck通过；9个修改源码/测试文件Prettier检查通过；git diff --check通过。
- 上述是组件/交互/SSR合成验证，没有真实模型、数据库、浏览器、生产或部署操作；未以测试桩冒充真实Repository。无新增领域算法。Q未跑全量check/build，root集成全批后统一运行并完成真实库、手机/PC及READY公网验收。

## 集成人接续

仅接本次独立UI提交，07Q已在root接入，不重复接依赖。root导入回调类型/apply接第三参keepOpen后联测多文件连续填稿、旧baseline失效和双确认；root独占的导入/来源/排期去工程信息不在Q覆盖范围。

重点浏览器验收：多作品长列表滚动时新建按钮可见；右侧长表单滚动不移动左底部；390px与1440px无横向溢出；地点长文可读可改且保留；展开所有Q详情仍无工程JSON/编号/错误路径；已有剧情走向可查可改、空态不误报；保存回读与发布阻断不放松。未有READY公网证据前保持待验收，不另领任务、不自行部署。
