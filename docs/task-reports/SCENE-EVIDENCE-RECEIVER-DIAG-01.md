# SCENE-EVIDENCE-RECEIVER-DIAG-01 · 固定接收人拒绝条件诊断

2026-10-12；根 codex-main-live-chain-20261012；xiaoan-accept。

实际v14说明failed9035ms，只有复合Receiver not actually addressed/present错误。无法确认是缺接收人、关联/在场不匹配、输入未点名还是观察未点名。没有捕获原输出，不猜具体子因；本轮保守16/18已闭账，不调用模型重试。

仅将scene-step-progress原五项OR拆成原顺序的固定条件码：not_found / not_related / not_present / input_not_named / observation_not_named。成功与拒绝边界、领域提案、接收者、原文、事务规则完全保持，不自动填唯一人物或改引文。保留原错误前缀，后缀只输出白名单枚举，不含模型返回值、姓名、ID、图片或私档。此前Player not present等更早错误不能被本诊断覆盖。

独立6项测试通过：五个拒绝条件、原合法说明成功及更早拒绝顺序；输入对象不变、诊断没有原文/人物值。原PG及完整检查待清单源整合后一起验证。尚未发布；后续真实调用只能观察到其自身具体条件，不能用新诊断推断此前实际失败的原始输出。

## 候选验证

B只读核查原五项条件与顺序、原早期错误不被遮盖、只固定枚举插值通过；不是供应商根因定位。根最终1122check/type0/332边界/build0、254实际PG项中249pass/5明确opt-in skip/0fail通过，专项8/8，0新增付费/图/生产业务写。待同清单候选READY/public，之后仅限定诊断已上线；本批旧失败的具体原始返回仍未知，整链仍待验。

## 正式发布与只读验收

根最终业务39085f7/itpqc4wwb/dpl_J4iPUFY2p1JDx8BDw4zxtzEc8vPF READY，正式别名已切换；1122check/build0、真实PG249pass/5明确模型skip、专项8/8，41迁移无SQL变化；正式paused真实已存1/4旧时间保持，公网8组/跨owner隔离通过。根完整线上手机壳390×844、390×500、PC1440内420无横溢出、只读无checkbox、展开可选/短屏末尾可达，0新模型/世界业务写，Ego146结束并恢复本次Cookie。仅有限R17清单/诊断技术交付，真实母03说明仍failed/closed16of18，不能称全NPC链成功。

证据仅保存在忽略目录：notes-step-ready.json、notes-step-public-proof.json、notes-step-public-regression.log、notes-step-public-ui.json。手机截图/private/tmp/notes-step-public-390.png、notes-step-public-short.png及notes-step-public-pc.png为正式合成测试世界，不含用户个人资料。完整壳真实客户端读取与hydration已观察；不是iPhone真机微信键盘验收。仅正常会话连接允许POST，全部世界修改拦截，blocked0；已结束浏览器并只恢复本次暂用Cookie。
