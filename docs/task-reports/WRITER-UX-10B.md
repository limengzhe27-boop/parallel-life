# WRITER-UX-10B 剧情条件与流程图投影

状态：待集成验收。负责人 `codex-writer-plot-10b-01a11a84-20261013`，独立树 `publication-story-02/人生剧本`、分支 `codex/writer-ux10-b`，基线 `ca49787a89288c2ab1dd5162b4d1e037526378dd`。root 唯一集成人，图 UI 归 root，总体设定归 Q。

## 最终契约

`buildStoryGraph(content: Record<string, unknown>): StoryGraph` 位于 `src/features/publisher/publisher-story-graph-model.ts`。

- `StoryGraph = {nodes, edges, stages, warnings: string[]}`。
- `StoryGraphNode = {key, title, stageKey?, stageLabel, intentLabel, conditions: string[], editable: boolean}`，仅事件，不混阶段占位节点。
- `StoryGraphEdge = {key, from, to, label, kind: 'prerequisite' | 'alternative' | 'exclusion' | 'stage'}`。
- `StoryGraphStage = {key, label, order: number}`，读取真实阶段排序供 UI 分列；不从数组相邻或相同阶段推断先后。
- 本轮不合成 stage 边：已保存的阶段前置以每个事件的条件文字解释，不把前阶段结束误表示成所有事件都必须成功。孤立事件正常，无须自动补连线。
- 缺失/重号事件仍可查看，但使用仅显示标识且 editable=false；不猜对应事件。缺失/异常关联用人话 warnings 保留，不展示原始内部标识。

## 语义与行为

已核对 `publication-story-repository.ts` 的真实状态映射及 `evaluateStory`：

- 来信 committed 是来信已发出；邀约 accept 与 attend 均映射 committed。因此控件/解释显示“邀约已接受或已赴约（当前不区分这两种结果）”，绝不统称任务完成。仅备注不能执行，有该结果条件时明确待调整。
- 邀约 cancel 映射 declined；miss 映射 expired。选择和摘要明确拒绝/取消、过期/错过，不声称可分别判断当前不区分的状态。
- 多条前置为 AND；一条允许结果列表为 OR。替代入边任一满足即可，但仍与目标全部自身前置相交；图和表单明确这一点。条件满足不保证立即发生。
- mutuallyExclusiveNodeKeys 是保存方向上的另一事件 committed 导致当前排除；不擅自对称化。excludeIfResolved 同样按真实源事件结果绘制。
- 人物、地点、事件、事实使用中文内容名；日期以北京时间描述；公开标识不出现在可见文字。导演建议和 timeNote 不转换为硬条件或动态延时。
- plot model 共用 `plotOutcomeLabel`、`plotOutcomeChoices`、`plotConditionText` 等解释函数，供图与条件选择同时使用。
- 编辑器接入 root 的 `PublisherStoryGraph`。图传回合法且唯一的事件 key 时，打开准确详情、滚动到事件并把焦点交给摘要；不会修改/保存草稿，disabled、未知或重复 key 均不执行定位写入。
- 所有现有编辑器写入仍走原受控 patch/clone；未知数据、稳定 key、条件结果和 unrelated 内容保持原样。

## 验证

- 59/59 联合纯专项通过，0 skip：原 publisher-plot-model tests、publisher-plot-ui tests、新 publisher-story-graph-model tests。
- 覆盖 AND/OR、真实来信/邀约语义、替代与排除方向、阶段不造事件边、孤立/环、缺失/重复关联、未知类型及 __proto__ 防崩溃、私有无关内容不渲染、导入条件不变、精确编辑定位和 disabled 防护。
- React SSR 使用 root 已提供图组件真实渲染；旧直接 walk 将含 hooks 图组件视叶，定位测试直接调用 onSelect，模拟 document 只验证定位逻辑，不冒充浏览器验收。
- typecheck 退出 0，模块边界检查 422 文件通过（含临时借用 root 图组件与样式），Prettier/diff 检查通过。
- root 两图文件仅复制到本树验证，不包含本提交；验证后删除借用副本。交付只含四个本人源文件、旧 UI 测试、新图模型测试及本报告，共七文件。
- 0 模型、0 DB、0 端口、0 浏览器、0 生产操作。完整 check/build、真实保存重读、390/1440、部署 READY 和公网验收由 root 统一完成。本阶段不称已上线。

## 集成接续

1. root 图组件依赖最终接口无变更，导入 `buildStoryGraph`。conditions 第一项为组合规则提示，不应将数组长度称作精确独立条件数；卡面可选第二项实质条件或直接显示“查看条件”。
2. 根验收点击图→查看条件→编辑事件定位与主工作台滚动，并验证修改后保存/重载流程图一致。
3. 图仅投影当前草稿已有数据，不判断实际运行时已发生、可立即触发或必然成功；真实支持/检查/试演/发布门槛不变。本次没有运行时、SQL、公共内容契约或新条件修改。
