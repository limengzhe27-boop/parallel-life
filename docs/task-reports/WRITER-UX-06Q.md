# WRITER-UX-06Q：编剧视图只读方案

2026-10-13；Agent codex-writer-ux-06q-01a0c7c8-20261013；root唯一集成。状态：实现待验收；下方保留先前只读方案，最新交付见末节。主目录短锁登记；独立photo-compose-02 / codex/writer-ux06-q-review，审查root当前f7125df。Notes05保持冻结。

## 当前证据

- publisher-workbench.tsx:122默认打开actors，编剧先面对人物表单；顶部settings/actors/plot三入口。
- workbench约717起的settings把作品介绍、主角、舞台、封面、JSON导入、世界绝对起点和地图/开场编辑并置。精确运行起点是既有约束，不能仅隐藏而声称可不填。
- workbench约687的检查提示只列前五issues，其余只有数量；真正阻断还包含missingCapabilities、试演/媒体门槛和版本/hash一致性。重排不能放松发布disabled条件。
- plot-editor约344每条summary与legend直接展示稳定key；候选集中展示具体动作、前置条件、阶段/时间/互斥/替代，作者时间说明明确不替代运行条件。B负责相对时间规则审查。
- import-dialog约722起已保留原文、模型成本/未知恢复、纯解析诊断、实际updatedContent与有限来源风险分类；review-view:386的十组真实最终稿及完整JSON可复用，不需要重做语义核对。
- 导入JSON差异目前每组已折叠。重点是降低主流程字段密度、先让作者看到实际故事内容，而非再次发明来源匹配或新摘要模型。

## 最小可逆布局

1. 故事概览：默认入口。只读呈现当前编辑稿实际故事简介、主角处境、主要人物、开场与发展方向，缺项明确显示。复用已有review数据；不调用新模型生成“故事”，不从模型notes补缺失设定。必要编辑保留现有表单。
2. 人物：先姓名/身份、与主角关系、背景/性格/动机；知情与底线可展开。已有异常、缺引用与删除影响不能隐藏。
3. 剧情发展：按已发生的事→阶段→可能发生的事组织；候选始终是可能性。内部key、精确运行时间、互斥和原始数据收高级；无效key/未知结构/不可编辑条目仍在正文提示，保原对象与扩展。
4. 待确认问题：全量列出真实检查issues、缺失运行能力以及试演/媒体门槛；上方持续显示阻断提示与入口。不把未检查、旧版本结果或不支持字段包装为就绪。

保存→检查→试演→发布仍用原回调与权限/version/hash/媒体守卫；顶部保留未保存状态。权限不足原因保持就近可见，账号/版本详情可收高级。

导入保留作者原文+实际整理稿，已有重点风险优先，模型说明及JSON差异收进说明/高级；两个真实确认框不删除，不自动勾选。不将当前原稿之外的未确认推测写成事实。

## 建议实现范围，尚未领取源码

建议root冻结后给Q：

- publisher-workbench.tsx / publisher-workbench.module.css：默认概览、四入口、完整问题列表、设置可逆收拢。
- publisher-plot-editor.tsx：只分组/标签/高级details，时间规则等B冻结接口。
- publisher-import-dialog.tsx：仅排列和折叠；所有请求/结果接收/确认守卫不改。
- publisher-review-view.ts：仅展示模式/标题，使同一实际内容视图可用于当前草稿。
- 对应tests/publisher-workbench.test.ts、publisher-plot-ui.test.ts、publisher-ai-prep-ui.test.ts、publisher-review-view.test.ts及本报告。

可进一步收窄为workbench/css+plot-editor，先不动import/review；root决定精确分工后在主表登记再写。不会占用B时间模型/解析器/领域规则、公共契约或共享配置，不重写表单存储逻辑。

## 验证和接续

本轮仅阅读源码、登记和写报告，0业务代码修改、0模型/世界/DB/浏览器、未跑测试或构建；不存在上线交付或真实PostgreSQL证据。方案已回传root，等相对时间审查和明确文件范围/基线后实施。后续应验证全量阻断可见、未知扩展保留、草稿编辑不丢值、导入双勾和发布守卫不变、手机PC可读；root统一check/build/READY公网，验收前不标已完成。


## 06Q冻结范围实现交付

root批准后已按主目录短锁把本行改为进行中并登记精确6文件：publisher-workbench.tsx/.module.css、publisher-review-view.ts、tests/publisher-workbench.test.ts、publisher-review-view.test.ts、本报告。基线f7125df+本人只读报告a90b067，未修改plot/opening/import或B规则，未修改公共契约。

- 四入口：故事概览（默认）、人物、剧情发展、待确认问题；换作品重回概览。概览直接读取当前draftContent，包括未保存内容，不借模型notes补事实。
- 复用既有实际内容预览，新增可选draft展示模式，默认proposal接口兼容；两模式默认展开世界与主角，人物等完整内容仍可展开。首屏声明缩一句，详细核对方法折叠；全量原始JSON及未知扩展仍可查看，不改数据。
- 世界业务表单放在可逆“编辑故事介绍与世界设置”折叠，原字段/回调保留；精确开场时间进一步折叠。日期缺失/无法识别时顶层明显提醒，补齐按钮切回概览并打开设置，空日期细项打开。不假称已经支持无需运行起点或自动相对时间。
- 顶层持续提示未检查/旧检查/实际问题数量，待确认入口完整列出check.issues、missingCapabilities和试演/素材状态。issuesTruncated显式说明后台还有未列出项。旧work/version/hash或未保存稿绝不显示当前检查通过。
- 版本和权限详情收在待确认的高级折叠，顶栏保留草稿/上架/下架及未保存状态。真正权限不足原因仍在原操作入口。
- 人物知情、事实编辑和底线保持原文与原权限；原保存、检查、试演、发布和导入动作未替换。发布onClick与disabled完整表达式逐字忽略空白比对f7125df一致。

### 实际验证

30/30专项、0skip：publisher-workbench.test.ts + publisher-review-view.test.ts。覆盖四入口/默认实际概览、保留人物五区与共享事实编辑/禁止重复key编辑/只读busy限制、全量8个issue与2运行限制/试演媒体显示、服务端截断、旧hash不冒称就绪、原权限work/version/hash/trial/media发布门槛、空/非法日期可补齐、未保存实际稿和未知扩展不丢、核对方法折叠及两模式默认故事展开、原AI/纯解析最终稿预览边界。

Typecheck最终退出0；范围内格式检查与git diff --check通过。最初测试修改脚本因缩进定位失败未写入，旧23项出现18pass/5默认人物旧断言失败；修正脚本并更新明确入口后29项过。新增fixture extensions类型声明错误已修；补核对方法测试后30项全过/type0。保留事实/权限安全断言而非移除。

测试是SSR和测试专用初始tab选择，不是真浏览器/供应商/数据库证据。0新模型/世界/图片/DB/API调用；未跑完整check/build或推送部署，root按分工统一验收。没有真实PostgreSQL验证，本轮仅重排现有UI，不新增Repository或领域运行能力。

### 集成接续

root只取本实现提交（前只读报告可不另取，本提交包含报告改动）；与B的plot/opening及root import相互无源码重叠。完整check/build，390/1440检查四入口、详细编辑折叠、补齐日期按钮、全量阻断与旧check、实际稿长文、人物知情、导入双勾和原save/trial/publish流程。生产迁移核对/READY/公网验证后才标完成。Notes05已由root通知489061c READY并验收，本轮不回写其代码或状态。
