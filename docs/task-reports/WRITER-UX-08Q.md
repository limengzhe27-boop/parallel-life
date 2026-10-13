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

## 追加只读审查：作者可见信息与模板来源（2026-10-13）

root接入本提交为f562604后明确要求只读复核。核对本人10120d7与root集成树的workbench/review-view/plot/space/opening五个组件，起始读取时git diff上述文件为空；root仍在继续集成，以下定位以本次读取源码为准。本轮只追加报告，未再改业务源码、测试或公共文件。

### 结论与残留

1. **未发现这五个组件把工程字段名、JSON整稿、错误path/code或内部ID直接作为界面说明输出。** review-view不再JSON.stringify整稿；缺失、重复或未命名引用只给人话提示，不附key；未知枚举落入固定提醒。DOM的key、input id、select value继续承载内部关联，属于不面向作者显示的绑定值，不能为去文案而删除。
2. workbench导入记录约709–719行：diagnostics只显示filename和固定“有内容需要核对，请回到导入区查看原文与整理结果”，不渲染item.message、code或reason。unmapped以“尚未整理的原文”显示item.content，原稿仍可展开。该记录通过onApply存入局部markdownReview，不是保存API新增返回的诊断，也不证明原文已验证。错误横幅不再输出error.code/message；检查问题由issueLabel固定人话映射。plot-model的错误先经过有限中文messages映射，再由issueText移除路径并改写通用提示，没有把任意后端错误message直接展示。
3. **仍有工程化措辞，建议集成人收口（非内部ID泄露）：** workbench约621/644行按钮title含“后端接口接通”，已接通试演title含“手机沙盒”，623/654还有“未接通”；可以改为“试演/发布暂不可用”和“在手机中试演当前草稿”。review-view84/126行还有“相应引用/知情引用”；plot118/123/859、workbench109/302/1156/1666附近仍有“引用”术语。建议改成“是否知道这件事”“对应人物/地点/剧情”，保留知情与可见范围不同的语义。
4. workbench约444行“请查看详细限制并调整”对应原工程详情已删除，建议改为“请到待确认问题核对并调整”，避免悬空指引。原列表格式/原稿时间需核对等提示虽不是字段名，仍可酌情换成更自然表述。本轮按root只读要求没有改这些文字。
5. 边界：作者输入、原始文稿、文件名、事实正文、无效日期原值仍如实显示并由React转义。若它们本身写有JSON或字段样文本，页面不会主动清洗作者文字。本审查的“未发现泄露”指应用自己生成的工程说明，不保证任意用户原文不含技术内容；不能为了绝对禁词而删改用户故事。

### “熟客的新订单”可确认与不可确认的来源

- 集成树public/templates/world-script.md:43的准确标题是“（二）熟客的一笔新订单”，44行是熟客愿意下单、但有交付时间要求的示例正文。不是本轮硬编码进workbench或review-view的默认剧情。
- publisher-import-dialog约728行提供该文件的下载链接；publisher-importer:404从传入Markdown的二级标题与正文提取candidate，861–869行写入对应title/editorialIntent，初始prerequisites与mutuallyExclusiveNodeKeys均为空、intent为仅剧情说明。该路径不凭空把此模板标题注入任意新作品。
- tests/publisher-importer.test.ts:448–472现有测试读取真实模板，断言两个候选及第二个正文含“熟客愿意下单”；本轮只读了测试，没有重新运行，不冒称新增验证通过。workbench新建内容约400行candidates为空。
- 因此只能确认“项目下载模板包含此示例，导入该模板可得到相应候选”。**没有读取截图对应作品保存数据、实际上传原稿、操作回执或来源记录，不能断定截图条目确实来自模板，不能认定为用户原稿或模型自动补充，也不能据此宣称作者设置了互斥/排除/替代规则。** 主登记目录旧主副本未检出该模板不推翻集成树证据，两者版本不同。

### 验证及接续

本轮为源码只读追踪和差异核对，0新增测试/构建、0浏览器/截图读取、0真实模型/数据库/生产操作。上一轮65专项/type结果仍是实现批次证据，不被升级为本轮浏览器或线上验收。工程措辞残留及模板来源边界已回传root；root负责是否调整、全批check/build/真实库与双端READY验收。08Q保持待验收，代码继续冻结。
