# 44-139 导演交接协议与人物下一步集成

2026-10-18；唯一集成人codex-root-handoff139；沿用unified-engine137/codex/unified-engine137，自c2f01993。小安44-140冻结ad547b04由root取为d9fd063f。原有真实模型138额度已闭账；本轮尚未调用商业模型。

## 实际失败与修改

138真实导演两次invalid_output：作者机会遗漏authoredEventKey、把actorId填到selectedCandidateIds。v9已有明确提示与引用目录，仅再添加提示无充分依据。因此将模型传输简化为带版本标记director-wire-v1，由唯一解析入口转成原有内核DirectorDecision；没有第二套引擎。

- candidate / actor / place / source / event分开命名空间，本次不可变attempt snapshot生成目录；人物引用不可作为候选，未知引用拒绝，不猜、不补默认人物、不静默丢错。
- 每个候选只选select或defer一次；可选typed nudge。nudge的actor和依据由该候选本已授权的全部非作者来源精确绑定，不增加权限，不下发导演私有原稿或任意对白。
- 作者机会必须显式选择eventRef，由代码同时绑定nodeKey与作者sourceId，消除重复抄写key/hash；只在资格可考虑且未占用时有引用。非作者机会必须显式emergent并提供非作者来源；不绕过原作者资格、边界、来源、CAS与人物独立参与规则。
- 模型原始response先原样持久化，再解码与原有canonical校验；无自动纠错模型、重试或强迫机会。存储的旧canonical响应仍按原严格解析，旧invalid不自动救活；unknown及晚到结果规则不变。
- 已知导演无效输出映射INVALID_AI_OUTPUT/422/nonretryable，文案明确未写入故事；明确重试仍无效时返回实际director failed状态，不能泛化为连接失败或宣称推进成功。

人物旧v16“明确承诺”示例直接要求actionIds/nextAction/triggers/missingConditions全空，是空计划的直接来源。v17移除该处方：同次提出真实支持的action及nextAction，或有来源的重考/等待条件；未支持执行则blocked且明确missingConditions，不能plan.record冒充实体行为。为人物输入加入仅本人授权计划的代码分类planNextSteps，使缺下一步/缺能力/等待可被区分。已有旧空计划只能在后续真实相关输入下完善，不凭空插时间触发。

44-140扩展原collector：普通无action且有完整来源和明确满足triggers的计划，也可在原调度中重考；不再限episodeFollowUps。同依据稳定ID不随摘要改写、revision、无关世界版本或时钟变化而新建付费身份；原episode路径与unknown阻断保持。小安负责collector/domain/tests，root负责model/HTTP/集成部署，未冲突改公共文件。

## 验证与限制

- 集成check3299/3299，类型与边界通过；build成功。针对本轮变更的68项专项通过。
- root真实本地PG55587，director-semantic-wake 19/19：新增wire响应从真实advance→原Director持久化→独立NPC考虑→原事务事件active，恰好一次导演与一次NPC受控适配器调用，无整体outcome伪造；原恢复、过期、unknown保护等保持。
- 小安独立PG55600的计划原入口连续旅程1项与34纯测试通过；合并后相应纯测试已由root check覆盖。该数据库旅程证明按显式条件一次本人重考与去重，不冒充已做实体工作。
- 只读生产迁移checksum复核：本批无SQL迁移；生产91项已应用，未改真实玩家数据。

以上数据库使用明确受控模型，仅证明协议与真实接线；不能代替商业模型自然选择/对白/演绎质量。修复后真实模型仍待新授权，不复用138余额；旧空trigger计划不会自动完成或自动重买。无物料库存/购物等真实能力的计划仍应明确等待/blocked，不能宣称“任意自然语言行为均可执行”。6个历史unknown旧档、安全关系确认与广义目标完成边界仍在原清单。

## 正式部署与接续

业务a42484de9640645fb15db81b0a915823a9870a0c，dpl_BhJrnRjsvwt8YKe4vyqngBzBP4PW READY；正式Nu别名精确匹配SHA。公网health/workbench/published200，匿名works401。登录读取原138合成试演：world v3/2人物/6消息保留，clock.paused=true；原director仍failed/known_failure/retry，未自动重试或篡改历史结果。0新增草稿/存档，0商业模型，0真实玩家存档修改。

小安140已审阅合入，代码交付完成；139真实模型复验仍待新授权，不能以本地受控模型通过替代。用户已收到最多6调用/沿用原档的独立授权问题，未答复前不发送模型请求。后续若批准，先建独立计费账本与快照；不将138的7次余额复用。

本地独占PG55587已核对工作树路径并优雅停止，无监听；小安PG55600也已停止。无新UI源码，不扩展重复手机/PC视觉验收。

141商业模型复验补充：新6次授权用5次并已闭账，导演wire一次通过；人物事件选择省略、unassessed被消费及相关计划下一步仍空，整体仍未通过。请以44-141报告为最新实际结果，不将本报告受控PG成功当作自然演绎成功。
