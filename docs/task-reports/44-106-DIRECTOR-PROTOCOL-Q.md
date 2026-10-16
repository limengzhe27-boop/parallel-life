# 44-106-DIRECTOR-PROTOCOL-Q

负责人 codex-ma44-106-director-q；集成人指派，待验收。独立 director-protocol106-q / codex/director-protocol106-q，精确基线0af65a48。仅修改director-agent-model.ts、对应tests/director-agent-model.test.ts和本报告；主目录本人登记/报告镜像。

## 变更

提示词版本升至director-runtime-v7-explicit-output。将伪JSON类型模板换成明确字段说明和JSON.stringify产生的合法完整quiet示例。audit在所有模式必须包含非空reason和来源数组；无来源允许[]，不允许空对象。枚举择一、可选字段省略、逐候选selected/deferred完整覆盖及nativeTurn限制明确表达。示例只用于无候选且确实选择quiet的格式，不表示必须quiet；空candidates仍可按合法作者素材、资格与当前状态考虑机会。

Output schema、parseDirectorDecision、权限/来源/候选覆盖/quiet判断全部保持原样。未自动补audit、纠错、加重试或强迫产出机会；模型adapter仍返回原响应供严格验证。未改运行时、SQL、server、公共接线、生产环境或存档。

## 验证与限制

对应纯专项20/20通过（新增2项）：实际system内容中的示例可JSON解析且通过无候选quiet校验；同示例不能忽略真实候选；audit缺省/空对象/空理由/虚构来源/多余字段继续拒绝；adapter原样返回坏响应不会伪造成功。最终typecheck通过，精确Prettier/diff检查通过。没有数据库/队列/权限行为变更，不重复PG或全库check/build，集成人按本批统一执行完整检查。

0真实模型、0生产写、0浏览器/公网验收；纯测试不能证明真实模型格式稳定性。本补丁不恢复此前付费失败，不授权重试，也不把后续无候选advance当导演成功。后续由集成人处理显式失败恢复、集成、部署READY与获单独授权的真实验收；渣男体验仍未发布。
