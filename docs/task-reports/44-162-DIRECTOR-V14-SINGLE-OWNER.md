# 44-162 Director v14 单来源归属

protocol162-tests；基线9a90b907；只改director-model-protocol.ts、协议聚焦测试及本报告；root负责模型输入、真实验收、领域/SQL与部署。

## 原首次进入失败

C的原paid v13为六人全部重复选择info1、info2；两项实际是开场标题和Markdown场景行。used.has跨人物去重保护正确拒绝，不能删除保护放行。原响应及失败状态保持原解释，不修复、重解或重买，也不宣称C开场通过。

## 结构变化

新增directorOpeningOwnerCatalog(snapshot)，仅供v14新请求。先把明确格式元数据与正文分开：首个非空行显式“开场事件：...”是标题；独立Markdown标记的场景/地点/Scene行是场景元数据。其余正文按行/句/段机械切分，仍为原sourceExcerpt连续子串；无标记普通正文保持，不使用故事词或角色名做语义解析。旧v13/12/11原目录编号不变。

v14 openingContext.informationOwners以本轮每项infoRef为必填唯一键，值为actorRef或null及reason。一个源只有一个owner，结构上不再允许六人各自选择同一项。可空归属，不强制选人或发言。actorRef只允许当前具有本人protected identity来源的人物；代码继续绑定本人lifeContext优先或本人其它首有效模块片段，编译原internal opening_context_v1引文结构。空归属整体仍defer。

v13、v12、v11、v10均保留原解码分支与原付费解释。不改领域、SQL、事实权限或内核执行结果。JSON schema共享owner定义，大小维持24KB以内。

必要验证67项聚焦协议及tsc通过。新增：原C六actor重复形状在v14 schema/decoder不可能，单源单owner及原文绑定、全null合法、metadata排除/普通未标记正文保持、缺失或外来source/无identity人物拒绝；旧v13仍保留标题原编号和原重复拒绝。0模型/生产，首次自然演绎由root独立受限实测，尚不作通过结论。
