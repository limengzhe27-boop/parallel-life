# LIB-04A · 独立创作助手 Planner

状态：待验收。负责人 `codex-f-01a0c7c8-lib04a-20261003`，由集成人明确分配；基线 `f3e457e`，分支 `codex/lib04a`，独立工作树 `/Users/limengzhe/Desktop/projects/demo/人生剧本/.local/worktrees/lib04a`。主目录主表已按短锁登记。

## 文件与能力

- `src/modules/settings/infrastructure/authoring-planner.ts`：导出 `AuthoringPlanner`、`AuthoringInputSchema`、`AuthoringOutputSchema` 和对应类型。`propose({brief,currentSetting?}, signal?)` 仅一次调用 TextModel，返回 `{reply,question,proposal}`；question 是单个可空文本，proposal 是经现有 LifeSettingContentSchema 校验的完整设定或 null。提示词要求身份不清楚时只补问一个影响开场的问题，足够时提出身份/欲望/困境/人物/开场完整方案。
- 严格输入拒绝 owner/Profile/访谈/世界等额外字段；严格输出拒绝发布权限、额外顶层字段与非法设定引用。没有持久化、工具执行或发布能力，不读取用户现实数据。输入创作文本依然可能含作者自己写入的私人内容，结构白名单不等于自动脱敏。
- 提案 sources 只能原样保留当前设定中的来源元组，不能从 brief 或模型知识补链接。source_claim 条目也只能保留当前已有原文，避免借合法链接新增未经支持的断言；来源存在不表示已核实。当前非原创人物类型和 inspiration 必须保留，不能被模型改标原创或抹去虚构说明。首次从自然语言识别历史/公众人物以及文字是否真的表达虚构仍需真实模型评测，不能把结构规则称为语义保证。
- 模型失败原样向上传递；格式/来源违规报 `INVALID_RESPONSE`，不自动重试、不返回固定故事。AbortSignal 在调用前及模型返回后检查，适配器忽略取消而晚到的结果也不会交付。
- `tests/setting-authoring.test.ts`：六项单测覆盖独立上下文/补问、完整合法提案且不改输入、越权额外字段及非法引用、来源和资料断言白名单、保留真实借鉴虚构标记、错误/取消不重试。

## 验证与交付边界

六项单元测试通过；工作树全项目 TypeScript 检查（不生成增量文件）通过；两个代码文件格式化与差异格式检查通过。测试模型均为显式桩，仅验证 Planner 的边界和错误行为；没有真实模型调用，没有 PostgreSQL 验证，没有构建或部署。这是 Planner 组件，不是生产 Repository、持久创作对话、API 或创作界面。

下一位集成人：集成独立提交后构造 TextModel 并接应用层。真实模型至少验证身份不明时补问、给定身份后产出合法完整设定、历史人物借鉴保留虚构标记、诱导新增来源/权限被拒，以及失败时界面诚实可恢复；再按主任务范围接持久化、API/UI、整体验证和部署。建议来源元组/资料声明需要改写时走单独作者确认流程，不在 Planner 内自动宣称核实。交付后停候，不另领任务。
