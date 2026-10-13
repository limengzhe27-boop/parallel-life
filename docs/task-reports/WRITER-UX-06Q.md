# WRITER-UX-06Q：编剧视图只读方案

2026-10-13；Agent codex-writer-ux-06q-01a0c7c8-20261013；root唯一集成。状态：只读方案待确认，未实施UI。主目录短锁登记；独立photo-compose-02 / codex/writer-ux06-q-review，审查root当前f7125df。Notes05保持冻结。

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
