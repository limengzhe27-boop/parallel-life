# PUBLISHER-REVIEW-02Q：以最终稿核对实际内容

2026-10-13；执行 Agent `codex-publisher-review-02q-01a0c7c8-20261013`；唯一集成人 `01a0c73b-a93c-7ca3-ac44-29f189d2612e`。状态：待验收，源码与报告冻结交root。

## 范围与基线

主表已按登记短锁新增独立子行。复用 `/Users/limengzhe/.codex/worktrees/photo-compose-02/人生剧本`，新分支 `codex/publisher-review-02q` 精确从 `31dbcfc2d61daaa6e93caf7275d325f0e182aba3` 开始，前批分支和提交完整保留。父任务SOURCE-COVERAGE-02仍由root协调；B改后端未知字段警示，本人不触及。

仅以下5文件：

1. `src/features/publisher/publisher-import-dialog.tsx`：AI整理/纯解析两条路径共用最终updatedContent预览。notes标题改“模型整理说明（待核对）”，extracted改“模型认为已提取”；填入后的当前编辑记录同步诚实标题。无基线/版本/权限/双勾/UNKNOWN/请求次数/费用说明/应用逻辑变更。
2. `src/features/publisher/publisher-import-dialog.module.css`：可折叠分组与中文内容卡，桌面字段和值两列、480以下单列；长文本保换行、最小宽度为0/任意长词换行；44px summary与焦点样式，复用原生dialog及body滚动。
3. 新 `src/features/publisher/publisher-review-view.ts`：纯只读React视图及数据呈现函数，只接受最终content，不接受notes/sources。按世界主角、人物、关系、过去经历/约定、开场消息、地点、单向路线、剧情阶段、未来候选分组。完整展示身份/背景/性格/外貌/动机/语气/边界；关系显示实际双方和最终原句；事实区区分参与者、可见范围和开场知情引用，冲突明确核对；消息显示真实发送者/正文/时间；地点方向/分钟、阶段顺序/前置、候选条件/执行方式/排除和后续候选按实际值展示。UTC时间按现有作者UTC+08习惯显示，保秒；异常日期原样提示不修复。重复/失效引用不取第一个；缺失、格式错误与空数组均如实呈现。完整原始JSON另可展开。
4. 新 `tests/publisher-review-view.test.ts`：16项纯逻辑/SSR及隔离组件handler测试。
5. 本报告；主目录仅镜像本报告和本人任务行。

实现过程中一条修改dialog的本地Python命令因编码声明报错，未写入；已重新完成接线并由类型/入口测试确认。本次无依赖包/公共契约/API/SQL/配置/手机备忘录变更。

## 诚实边界

标题是“将填入的实际内容”，发生在采用/保存之前。提醒原稿可查、尚无逐项来源定位、不能保证无遗漏，特别核对年龄、关系和约定；不推断年龄、不用notes给空字段补值、不伪造来源锚点/验证标记/覆盖率、不把候选当已发生。未填写不代表原稿没提及。

这不是来源事实映射协议，也不自动检测所有遗漏、关系增义或多文件冲突。没有新增逐条确认、编辑路由或保存后来源历史；两项既有勾选依旧由作者主动操作。只读预览没有保存、采用或修改回调；实际填入仍是原有回调与基线守卫。

## 已做验证

- 16项新测试 + 原AI UI21项 + 中文issues6项，**43/43通过、0skip**。
- 覆盖完整长背景末尾不截断；年龄只出现在notes时实际人物预览不补年龄；关系相识原句不改共事；参与人不同于知情人；world可见不等于所有人开场已知；知情越界冲突；重复/未知引用；消息时间与秒/非法日期不修正；路线单向及不同分钟；阶段前置/候选被拒后分支；malformed/未知资料保JSON；HTML转义；深冻结输入不变；AI/纯解析实际入口共用相同组件；无默认勾选/自动采用。
- `npm run typecheck`通过；本次4个源码/测试文件Prettier检查通过；`git diff --check`通过。
- 新测试的模拟只用于组件处理和传参，SSR是React生成HTML；没有真实浏览器、模型或Repository验证，不把合成输出当模型结果。
- 根据root最新分工，**root独占完整npm run check/真实数据库与手机PC/生产验收**；本轮Q不运行会连接旧DB端口的完整check，不启DB或服务。此前1858/4失败等数字属于前批，不挪用于此批。
- **0真实模型、0数据库操作、0浏览器、0产品端口、0生产写入/部署**。旧批次closed，未消费新的任何额度。

## root接续

合并精确独立SHA后，用root已经准备的明确local replay检查实际字段与模型notes不一致的显示；正式可用既有合成作品的纯解析0付费0保存验收390/PC与短屏。不要为预览新建伪模型记录或世界。root统一完整check、必要实际界面、部署READY/公网确认后才把主表标完成。源覆盖协议及多题材真实模型质量仍由父任务后续处理，本轮不宣称解决。

最终构建：`npm run build` exit0。日志 `/private/tmp/publisher-review-02q-tests.log` 与 `/private/tmp/publisher-review-02q-build.log`。本次工作未上线；已知正式基线为31dbcfc，实际新版本由root集成记录。
