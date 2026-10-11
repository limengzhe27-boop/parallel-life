# SCENE-EVIDENCE-RECEIVER-DIAG-01 · 固定接收人拒绝条件诊断

2026-10-12；根 codex-main-live-chain-20261012；xiaoan-accept。

实际v14说明failed9035ms，只有复合Receiver not actually addressed/present错误。无法确认是缺接收人、关联/在场不匹配、输入未点名还是观察未点名。没有捕获原输出，不猜具体子因；本轮保守16/18已闭账，不调用模型重试。

仅将scene-step-progress原五项OR拆成原顺序的固定条件码：not_found / not_related / not_present / input_not_named / observation_not_named。成功与拒绝边界、领域提案、接收者、原文、事务规则完全保持，不自动填唯一人物或改引文。保留原错误前缀，后缀只输出白名单枚举，不含模型返回值、姓名、ID、图片或私档。此前Player not present等更早错误不能被本诊断覆盖。

独立6项测试通过：五个拒绝条件、原合法说明成功及更早拒绝顺序；输入对象不变、诊断没有原文/人物值。原PG及完整检查待清单源整合后一起验证。尚未发布；后续真实调用只能观察到其自身具体条件，不能用新诊断推断此前实际失败的原始输出。

## 候选验证

B只读核查原五项条件与顺序、原早期错误不被遮盖、只固定枚举插值通过；不是供应商根因定位。根最终1122check/type0/332边界/build0、254实际PG项中249pass/5明确opt-in skip/0fail通过，专项8/8，0新增付费/图/生产业务写。待同清单候选READY/public，之后仅限定诊断已上线；本批旧失败的具体原始返回仍未知，整链仍待验。
